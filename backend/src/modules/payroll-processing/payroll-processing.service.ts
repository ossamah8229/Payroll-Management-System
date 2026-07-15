import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type { Employee } from '@prisma/client';
import type { CreatePayrollCycleInput, SessionUser } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { materializeScheduledAdvanceDeductions } from '../advances/advances.service';
import {
  reserveBackupPackageVersion,
  assembleBackupPackageFiles,
  writeBackupPackageFilesToStorage,
  commitBackupPackageReady,
  failBackupPackageGeneration,
} from '../backup-packages/backup-packages.service';

/**
 * Payroll Processing — owns the `PayrollCycle` lifecycle (docs/architecture/database/payroll-cycle.md
 * §10). Phase 3 Checkpoint 1 scope: cycle *creation* only (bootstrap and carry-forward). Phase 5
 * Checkpoint 1 added Finalize Cycle (`finalizePayrollCycle`, below) — the explicit `DRAFT` →
 * `RELEASED` transition. Phase 5 Checkpoint 3 adds the month-end rollover workflow
 * (`archiveAndCreateNextPayrollCycle`, below) — archive the outgoing cycle, generate its fresh
 * Backup Package, and create the next Draft, all as one atomic unit — and, as part of that,
 * restricts `createPayrollCycle` to bootstrapping the very first cycle ever (see that function's
 * own doc comment).
 *
 * **Phase 4 Checkpoint 5 (Advances) addition:** this module now also owns
 * `ScheduledPayrollPeriod` (docs/architecture/database/payroll-cycle.md §10a) — the only module that
 * ever creates, resolves, or mutates a row in that table. Advances only ever holds a foreign key
 * into it and calls `findOrCreateScheduledPayrollPeriod` below rather than touching the table
 * directly. **Deliberately no generic Outstanding-Payroll-Obligation provider/hook registry** (an
 * approved architecture decision, superseding the fuller framework `docs/architecture/workflows/
 * outstanding-obligations.md` describes as a future possibility) — both `createPayrollCycle` and
 * `archiveAndCreateNextPayrollCycle` call Advances' own `materializeScheduledAdvanceDeductions`
 * directly. Should Phase 6 (Balance Adjustments/Corrections) become a genuine second consumer
 * needing the same seam, that is the point to generalize this into a real registry, not before.
 */

const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * The canonical, single find-or-create for a `ScheduledPayrollPeriod` row (docs/architecture/
 * database/payroll-cycle.md §10a) — the only function anywhere in the codebase that creates one.
 * Advances calls this rather than writing to the table directly (the ownership boundary the schema
 * doc itself specifies). The unique `(year, month)` constraint is the concurrency backstop: on a
 * race, the loser's `create` throws a unique-constraint violation, which is caught and resolved by
 * re-reading the winner's row.
 */
export async function findOrCreateScheduledPayrollPeriod(
  year: number,
  month: number,
  client: PrismaTransactionClient = prisma,
) {
  const existing = await client.scheduledPayrollPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) {
    return existing;
  }

  try {
    return await client.scheduledPayrollPeriod.create({ data: { year, month } });
  } catch {
    // Lost a concurrent find-or-create race — the winner's row now exists; use it.
    return client.scheduledPayrollPeriod.findUniqueOrThrow({ where: { year_month: { year, month } } });
  }
}

/**
 * Resolves an EXISTING `ScheduledPayrollPeriod` pending row for `(year, month)` against a cycle
 * that now exists for it — the one-time `payrollCycleId` NULL → NOT NULL transition. Deliberately
 * does not create a new row if none is pending (unlike `findOrCreateScheduledPayrollPeriod`): if
 * nothing was ever scheduled against this exact period before this cycle existed, there is nothing
 * to resolve, and ordinary cycle creation proceeds unaffected. Shared by `createPayrollCycle` and
 * `archiveAndCreateNextPayrollCycle` — previously inlined in the former only.
 */
async function resolvePendingScheduledPayrollPeriod(
  tx: PrismaTransactionClient,
  year: number,
  month: number,
  cycleId: string,
) {
  const pendingPeriod = await tx.scheduledPayrollPeriod.findFirst({
    where: { year, month, payrollCycleId: null },
  });
  if (!pendingPeriod) {
    return null;
  }
  return tx.scheduledPayrollPeriod.update({
    where: { id: pendingPeriod.id },
    data: { payrollCycleId: cycleId, resolvedAt: new Date() },
  });
}

interface BootstrapPayrollEntriesParams {
  tx: PrismaTransactionClient;
  cycleId: string;
  sourceCycleId: string | null;
  activeEmployees: Employee[];
  /** Phase 5 Checkpoint 3 — departed employees carried forward solely because they have an
   * Outstanding Payroll Obligation due this period (today: an ACTIVE Advance — see
   * `docs/architecture/workflows/outstanding-obligations.md`'s direct-call convention). Empty for
   * `createPayrollCycle`'s first-cycle-only path, where there is no prior cycle for anyone to have
   * departed from. */
  departedObligationEmployees: Employee[];
}

interface BootstrapPayrollEntriesResult {
  employeeIdToEntryId: Map<string, string>;
  entryCount: number;
  departedObligationEntryCount: number;
}

/**
 * The shared Payroll Entry bootstrap/carry-forward primitive — the one implementation of "seed a
 * new cycle's entries," called from both `createPayrollCycle` (first cycle only) and
 * `archiveAndCreateNextPayrollCycle` (every subsequent cycle, via rollover). Always runs inside the
 * caller's own transaction, using the caller-already-known, real `cycleId` (no placeholder-then-
 * patch step needed, unlike this function's pre-Checkpoint-3 inline ancestor, since both callers
 * now create the `PayrollCycle` row before calling this).
 *
 * **Reads `sourceCycleId`'s own entries from inside this transaction, deliberately** — not from an
 * earlier, pre-transaction snapshot. A held, unreleased entry in the outgoing cycle stays editable
 * even after that cycle is `RELEASED` (Checkpoint 1's own approved rule,
 * docs/architecture/workflows/payroll-lifecycle.md §4), so reading it as late as possible, as part
 * of the same transaction that archives that cycle, is what guarantees the new cycle's carry-forward
 * values reflect the outgoing cycle's true final state, not a stale pre-rollover snapshot.
 *
 * **The Payroll Bootstrap Rule (frozen business rule, confirmed 2026-07-07 — do not re-litigate):**
 * for a continuing employee (one with an entry in the source cycle), payroll-specific values —
 * `grossPay`, the new single work line's `cycleDays`/`otRate`, `leaveRate`,
 * `eobiApplicable`/`eobiAmount`, and any other payroll calculation parameter — are always carried
 * forward from that prior entry, never copied from `Employee`'s own record. Payroll values
 * represent payroll history and stay stable across cycles until intentionally changed in Payroll
 * Entry itself (Employee.grossPay is documented, §9, as a "template value only" — reverting to it
 * would silently discard a deliberate adjustment). Conversely, `designation`, `bankId`,
 * `branchCode`, `accountNumber`, `iban`, the new line's `unitId` (Primary Project Unit),
 * and `siteId` always refresh from `Employee`'s CURRENT record, never the prior entry's. Attendance
 * (`days`/`otHours`) always resets to zero. A genuinely new employee (no prior entry) seeds entirely
 * fresh from `Employee`'s own defaults. `employeeNameSnapshot`/`fatherNameSnapshot` deliberately
 * follow the carry-forward rule, not the designation/banking refresh rule (Phase 4 Checkpoint 6.1).
 *
 * **Departed-obligation entries (Phase 5 Checkpoint 3) deliberately do not follow the ordinary
 * carry-forward rule for payroll figures** — they carry no ordinary pay at all: `grossPay`,
 * `eobiAmount` are zeroed, `eobiApplicable` is false, no OT rate, attendance (`days`) stays at its
 * default zero (no work is expected), and the entry is created `hold = true` so it can never be
 * mistaken for, or accidentally paid as, ordinary salary. `cycleDays` still takes the schema's
 * ordinary default (30) — it is the cycle's own day-count basis, DB-constrained to 1–31, not an
 * attendance figure. Identity/banking snapshots still populate normally (refresh from
 * `Employee`'s current record, same as any other entry) — the entry exists solely to carry whatever
 * obligation the materialization step the caller runs afterward (Advances) applies to it.
 */
async function bootstrapPayrollEntries(params: BootstrapPayrollEntriesParams): Promise<BootstrapPayrollEntriesResult> {
  const { tx, cycleId, sourceCycleId, activeEmployees, departedObligationEmployees } = params;

  const sourceEntryByEmployeeId = new Map<
    string,
    Prisma.PayrollEntryGetPayload<{ include: { workLines: true } }>
  >();
  if (sourceCycleId) {
    const sourceEntries = await tx.payrollEntry.findMany({
      where: { cycleId: sourceCycleId },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    for (const entry of sourceEntries) {
      sourceEntryByEmployeeId.set(entry.employeeId, entry);
    }
  }

  const entryRows: Prisma.PayrollEntryCreateManyInput[] = [];
  const workLineRows: Prisma.PayrollEntryWorkLineCreateManyInput[] = [];
  // Which newly-created entry belongs to which employee, so the Advance materialization step below
  // can target the right row without a second lookup (Phase 4 Checkpoint 5) — now covering
  // departed-obligation employees too (Phase 5 Checkpoint 3), closing
  // `materializeScheduledAdvanceDeductions`'s own former accepted gap.
  const employeeIdToEntryId = new Map<string, string>();
  let sortOrder = 0;

  for (const employee of activeEmployees) {
    const sourceEntry = sourceEntryByEmployeeId.get(employee.id);
    const primaryLine = sourceEntry?.workLines[0]; // already ordered by sortOrder asc
    const entryId = randomUUID();
    employeeIdToEntryId.set(employee.id, entryId);

    entryRows.push({
      id: entryId,
      cycleId,
      employeeId: employee.id,
      siteId: employee.siteId,
      employeeNameSnapshot: sourceEntry?.employeeNameSnapshot ?? employee.name,
      fatherNameSnapshot: sourceEntry?.fatherNameSnapshot ?? employee.fatherName,
      designation: employee.designation,
      bankId: employee.bankId,
      branchCode: employee.branchCode,
      accountNumber: employee.accountNumber,
      iban: employee.iban,
      grossPay: sourceEntry?.grossPay ?? employee.grossPay,
      eobiAmount: sourceEntry?.eobiAmount ?? employee.defaultEobiAmount,
      eobiApplicable: sourceEntry?.eobiApplicable ?? employee.defaultEobiApplicable,
      leaveRate: sourceEntry?.leaveRate ?? null,
      // Checkpoint 6 fix (2026-07-10): every bootstrapped entry previously defaulted to
      // sortOrder=0 (the schema's column default), which every OTHER entry-creation path avoids
      // (createPayrollEntry assigns `maxSortOrder + 1`). At the 10,000-employee floor,
      // `ORDER BY sortOrder ASC LIMIT/OFFSET` pagination over rows tied on the same value is
      // unstable — each entry now gets its own distinct position, matching iteration order.
      sortOrder: sortOrder++,
    });

    workLineRows.push({
      id: randomUUID(),
      payrollEntryId: entryId,
      siteId: employee.siteId,
      unitId: employee.unitId,
      cycleDays: primaryLine?.cycleDays ?? 30,
      otRate: primaryLine?.otRate ?? null,
    });
  }

  for (const employee of departedObligationEmployees) {
    const sourceEntry = sourceEntryByEmployeeId.get(employee.id);
    const entryId = randomUUID();
    employeeIdToEntryId.set(employee.id, entryId);

    entryRows.push({
      id: entryId,
      cycleId,
      employeeId: employee.id,
      siteId: employee.siteId,
      employeeNameSnapshot: sourceEntry?.employeeNameSnapshot ?? employee.name,
      fatherNameSnapshot: sourceEntry?.fatherNameSnapshot ?? employee.fatherName,
      designation: employee.designation,
      bankId: employee.bankId,
      branchCode: employee.branchCode,
      accountNumber: employee.accountNumber,
      iban: employee.iban,
      grossPay: '0',
      eobiAmount: '0',
      eobiApplicable: false,
      leaveRate: null,
      hold: true,
      sortOrder: sortOrder++,
    });

    workLineRows.push({
      id: randomUUID(),
      payrollEntryId: entryId,
      siteId: employee.siteId,
      unitId: employee.unitId,
      // cycleDays is the cycle's own day-count basis (DB-constrained to 1-31), not attendance —
      // attendance is `days`, which already defaults to 0 and is left untouched ("no work
      // performed" is expressed there, not here). Schema default, same as any other fresh line.
      cycleDays: 30,
      otRate: null,
    });
  }

  for (const batch of chunk(entryRows, CHUNK_SIZE)) {
    await tx.payrollEntry.createMany({ data: batch });
  }
  for (const batch of chunk(workLineRows, CHUNK_SIZE)) {
    await tx.payrollEntryWorkLine.createMany({ data: batch });
  }

  return {
    employeeIdToEntryId,
    entryCount: entryRows.length,
    departedObligationEntryCount: departedObligationEmployees.length,
  };
}

export async function listPayrollCycles() {
  return prisma.payrollCycle.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
}

export async function getPayrollCycle(id: string) {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  return cycle;
}

/**
 * Creates a `PayrollCycle` — **restricted, as of Phase 5 Checkpoint 3, to bootstrapping the very
 * first cycle ever** (no `PayrollCycle` row of any status exists yet). Every subsequent cycle is
 * created via rollover (`archiveAndCreateNextPayrollCycle`, below) instead — never silently from
 * this route, so starting a new cycle can never accidentally archive history as an undocumented
 * side effect of what looks like an ordinary create call (the approved 2026-07-15 architecture
 * decision). Once any cycle exists, this function rejects with a typed conflict pointing the caller
 * at the rollover endpoint, whether or not that existing cycle happens to still be `DRAFT`.
 *
 * **The Payroll Bootstrap Rule and every other carry-forward/refresh/reset field rule** are owned
 * by `bootstrapPayrollEntries`, above — this function no longer contains that logic inline; both
 * this function and `archiveAndCreateNextPayrollCycle` call the same shared implementation.
 *
 * **Timeless, phase-independent invariant, still enforced here (§10):** only one `PayrollCycle` may
 * ever be in `DRAFT` status at a time.
 */
export async function createPayrollCycle(
  currentUser: SessionUser,
  input: CreatePayrollCycleInput,
  requestMeta: RequestMeta,
) {
  const existingDraft = await prisma.payrollCycle.findFirst({ where: { status: 'DRAFT' } });
  if (existingDraft) {
    throw conflict(
      'A Draft payroll cycle already exists — only one cycle is ever in Draft state at a time',
    );
  }

  const anyCycleExists = await prisma.payrollCycle.findFirst();
  if (anyCycleExists) {
    throw conflict(
      'A payroll cycle already exists — use POST /api/v1/payroll-cycles/:cycleId/archive-and-create-next to start the next cycle',
    );
  }

  const activeEmployees = await prisma.employee.findMany({ where: { dateOfLeaving: null } });

  const cycle = await prisma.$transaction(
    async (tx) => {
      const created = await tx.payrollCycle.create({
        data: {
          year: input.year,
          month: input.month,
          sourceCycleId: null,
          createdBy: currentUser.id,
        },
      });

      const bootstrap = await bootstrapPayrollEntries({
        tx,
        cycleId: created.id,
        sourceCycleId: null,
        activeEmployees,
        departedObligationEmployees: [],
      });

      // Phase 4 Checkpoint 5 (Advances) — resolution step, owned exclusively by Payroll Processing
      // (docs/architecture/database/payroll-cycle.md §10a): if anything ever scheduled a deduction
      // against this exact (year, month) before this cycle existed, resolve that
      // `ScheduledPayrollPeriod` row now.
      const resolvedPeriod = await resolvePendingScheduledPayrollPeriod(tx, input.year, input.month, created.id);
      if (resolvedPeriod) {
        // Deliberately a direct call into Advances' own module, not a generic provider/hook
        // registry (approved architecture decision) — see this file's own header comment.
        await materializeScheduledAdvanceDeductions(
          {
            cycleId: created.id,
            cycleYear: input.year,
            cycleMonth: input.month,
            resolvedPeriodId: resolvedPeriod.id,
            employeeIdToEntryId: bootstrap.employeeIdToEntryId,
            actorUserId: currentUser.id,
            requestMeta,
          },
          tx,
        );
      }

      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_cycle.created',
          entityType: 'PayrollCycle',
          entityId: created.id,
          metadata: {
            year: created.year,
            month: created.month,
            sourceCycleId: created.sourceCycleId,
            entryCount: bootstrap.entryCount,
          },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );

      return created;
    },
    { timeout: 30_000 },
  );

  return cycle;
}

/**
 * Finalize Cycle (Phase 5 Checkpoint 1, docs/architecture/workflows/payroll-lifecycle.md §4) — the
 * explicit `DRAFT` → `RELEASED` transition. Master-User-only, reuses `PAYROLL_CYCLE_MANAGE` (the
 * same permission cycle *creation* already uses — both are system-lifecycle actions, not routine
 * data entry).
 *
 * **The finalization precondition, strictly enforced, with no override:** the cycle cannot
 * finalize while any `PayrollEntry` in it has `released = false AND hold = false` — every entry
 * must be either released (via per-Unit release, `payroll-release.service.ts`) or explicitly held.
 * There is deliberately no override parameter anywhere in this function's signature or the route
 * that calls it — a cycle with unreleased, non-held stragglers simply cannot be finalized until
 * they are released or held.
 *
 * **What this function deliberately does NOT do:** it never touches `PayrollEntry.released` — held,
 * unreleased entries stay held and unreleased after finalization. It never archives the cycle,
 * generates a Backup Package, or creates a new cycle — that is rollover's job
 * (`archiveAndCreateNextPayrollCycle`, below), a later, separate, explicit action.
 *
 * **Concurrency:** the precondition count and the `DRAFT` → `RELEASED` write both happen inside one
 * transaction. The status flip itself is an atomic conditional `updateMany` scoped to
 * `status: 'DRAFT'` (not a read-then-write `update`) — two concurrent finalize transactions
 * serialize on this row: whichever commits first flips the status, and the loser's own `updateMany`
 * then matches zero rows once it re-evaluates the `WHERE` clause, so it cleanly reports a conflict
 * rather than either double-finalizing or writing a second audit row.
 */
export async function finalizePayrollCycle(currentUser: SessionUser, cycleId: string, requestMeta: RequestMeta) {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  if (cycle.status !== 'DRAFT') {
    throw badRequest('Only a Draft payroll cycle can be finalized');
  }

  return prisma.$transaction(
    async (tx) => {
      const [entryCount, releasedCount, heldCount, blockingCount] = await Promise.all([
        tx.payrollEntry.count({ where: { cycleId } }),
        tx.payrollEntry.count({ where: { cycleId, released: true } }),
        tx.payrollEntry.count({ where: { cycleId, hold: true } }),
        tx.payrollEntry.count({ where: { cycleId, released: false, hold: false } }),
      ]);

      if (blockingCount > 0) {
        throw badRequest(
          `Cannot finalize this cycle — ${blockingCount} payroll ${blockingCount === 1 ? 'entry is' : 'entries are'} neither released nor held`,
        );
      }

      const guarded = await tx.payrollCycle.updateMany({
        where: { id: cycleId, status: 'DRAFT' },
        data: { status: 'RELEASED', releasedAt: new Date(), releasedBy: currentUser.id },
      });
      if (guarded.count === 0) {
        throw conflict('This payroll cycle has already been finalized');
      }

      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_cycle.released',
          entityType: 'PayrollCycle',
          entityId: cycleId,
          metadata: { cycleId, year: cycle.year, month: cycle.month, entryCount, releasedCount, heldCount },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );

      return tx.payrollCycle.findUniqueOrThrow({ where: { id: cycleId } });
    },
    { timeout: 30_000 },
  );
}

/**
 * The month-end rollover workflow (Phase 5 Checkpoint 3, docs/architecture/workflows/
 * payroll-lifecycle.md §4's "New Cycle Creation" section) — archives one `RELEASED` outgoing cycle,
 * generates its fresh Backup Package, and creates the next Draft cycle, all as one atomic unit:
 *
 * ```
 * Existing cycle: RELEASED
 *         ↓
 * Generate Backup Package
 *         ↓
 * Archive outgoing cycle
 *         ↓
 * Resolve the new Scheduled Payroll Period
 *         ↓
 * Create the next Draft Payroll Cycle
 *         ↓
 * Bootstrap entries and materialize current obligations
 * ```
 *
 * **Why a dedicated action, not folded into `createPayrollCycle` (approved architecture decision,
 * 2026-07-15):** `createPayrollCycle` is now restricted to the very-first-cycle bootstrap only,
 * precisely so starting a new cycle is never an undocumented side effect — every rollover names its
 * outgoing cycle explicitly (`POST /api/v1/payroll-cycles/:cycleId/archive-and-create-next`).
 *
 * **The next period is always derived, never caller-supplied** — exactly one calendar month after
 * the outgoing cycle's own `(year, month)`, December rolling the year. There is no "skip a month" or
 * "pick an arbitrary period" override.
 *
 * **Backup Package freshness (approved architecture decision):** rollover always generates a brand
 * new Backup Package version immediately before archiving — it never reuses an earlier `READY`
 * package, manual or otherwise. This is forced by Checkpoint 1's own approved rule that a held,
 * unreleased `PayrollEntry` stays editable even after its cycle is `RELEASED` — an earlier package
 * cannot be proven to still reflect the cycle's final pre-archive state, so this attempt's own fresh
 * assembly is the only one ever trusted to gate the archive.
 *
 * **Cross-system transaction boundary:** storage writes (which cannot participate in a Postgres
 * transaction) happen before the transaction opens; everything that can be transactional — the
 * backup's `READY` commit, the outgoing cycle's archive, the new Draft cycle, its bootstrapped
 * entries, and Advance materialization — commits together in one transaction, or none of it does
 * (docs/architecture/system-conventions.md §2). A failure anywhere after the version is reserved
 * runs the identical best-effort cleanup `generateBackupPackage` itself uses
 * (`failBackupPackageGeneration`) and never leaves the outgoing cycle archived without its
 * corresponding new Draft — the two either both commit or neither does, by construction (they are
 * literally the same transaction).
 *
 * **Departed-employee obligation carry-forward (Advances only, direct call, no registry — the
 * approved Phase 5 boundary, docs/architecture/workflows/outstanding-obligations.md):** the new
 * cycle's entries are the union of every currently active employee and every departed employee with
 * an `ACTIVE` Advance due this exact period — the one concrete gap this checkpoint closes in
 * `materializeScheduledAdvanceDeductions`'s own former accepted limitation. No other departed
 * employee ever receives an entry.
 *
 * **Concurrency:** the archive transition is an atomic conditional `updateMany` scoped to
 * `status: 'RELEASED'`, the same guard pattern `finalizePayrollCycle` already uses — a losing
 * concurrent rollover attempt against the same outgoing cycle matches zero rows, throws a clean
 * conflict, and rolls its entire transaction back (no Draft created, no backup left `READY`). Backup
 * version reservation is separately race-safe (the existing `(cycleId, version)` unique constraint).
 * The next cycle's `(year, month)` uniqueness is a further, redundant backstop.
 */
export async function archiveAndCreateNextPayrollCycle(
  currentUser: SessionUser,
  outgoingCycleId: string,
  requestMeta: RequestMeta,
) {
  const outgoingCycle = await prisma.payrollCycle.findUnique({ where: { id: outgoingCycleId } });
  if (!outgoingCycle) {
    throw notFound('Payroll cycle not found');
  }
  if (outgoingCycle.status === 'DRAFT') {
    throw badRequest('A Draft payroll cycle must be finalized before it can be rolled over');
  }
  if (outgoingCycle.status === 'ARCHIVED') {
    throw badRequest('This payroll cycle has already been archived');
  }

  // Defensive re-validation of the invariant this checkpoint establishes: at most one cycle is ever
  // RELEASED at a time, since every rollover archives its predecessor atomically. If this ever
  // finds a second RELEASED cycle, something upstream of this function violated that invariant —
  // reject rather than guess which one is "the" current cycle.
  const otherReleasedCount = await prisma.payrollCycle.count({
    where: { status: 'RELEASED', id: { not: outgoingCycleId } },
  });
  if (otherReleasedCount > 0) {
    throw conflict('More than one Released payroll cycle exists — cannot determine a single cycle to roll over');
  }

  const nextYear = outgoingCycle.month === 12 ? outgoingCycle.year + 1 : outgoingCycle.year;
  const nextMonth = outgoingCycle.month === 12 ? 1 : outgoingCycle.month + 1;

  const duplicateNextCycle = await prisma.payrollCycle.findUnique({
    where: { year_month: { year: nextYear, month: nextMonth } },
  });
  if (duplicateNextCycle) {
    throw conflict(`A payroll cycle for ${nextMonth}/${nextYear} already exists`);
  }

  const activeEmployees = await prisma.employee.findMany({ where: { dateOfLeaving: null } });

  // The next period may already exist as an unresolved `ScheduledPayrollPeriod` row — most
  // commonly because the outgoing cycle's own Advance materialization already pointed a
  // not-yet-paid-off advance's `currentScheduledPeriodId` at it. If no such row exists, nothing was
  // ever scheduled against this period, so there are trivially zero departed-obligation employees
  // to include.
  const existingNextPeriod = await prisma.scheduledPayrollPeriod.findUnique({
    where: { year_month: { year: nextYear, month: nextMonth } },
  });
  const departedObligationEmployees = existingNextPeriod
    ? await prisma.employee.findMany({
        where: {
          dateOfLeaving: { not: null },
          advances: { some: { status: 'ACTIVE', currentScheduledPeriodId: existingNextPeriod.id } },
        },
      })
    : [];

  const reservation = await reserveBackupPackageVersion(outgoingCycleId, currentUser);
  const { reserved, nextVersion } = reservation;

  const writtenKeys: string[] = [];
  try {
    const assembled = await assembleBackupPackageFiles(currentUser, outgoingCycle, reservation);
    await writeBackupPackageFilesToStorage(assembled, writtenKeys);

    const result = await prisma.$transaction(
      async (tx) => {
        const guardedArchive = await tx.payrollCycle.updateMany({
          where: { id: outgoingCycleId, status: 'RELEASED' },
          data: {
            status: 'ARCHIVED',
            archivedAt: new Date(),
            archivedBy: currentUser.id,
            archivedWithBackupPackageId: reserved.id,
          },
        });
        if (guardedArchive.count === 0) {
          throw conflict('This payroll cycle has already been archived');
        }

        await commitBackupPackageReady(tx, {
          backupPackageId: reserved.id,
          cycleId: outgoingCycleId,
          version: nextVersion,
          assembled,
          currentUser,
          requestMeta,
        });

        let newCycle: Prisma.PayrollCycleGetPayload<Record<string, never>>;
        try {
          newCycle = await tx.payrollCycle.create({
            data: {
              year: nextYear,
              month: nextMonth,
              sourceCycleId: outgoingCycleId,
              createdBy: currentUser.id,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw conflict(`A payroll cycle for ${nextMonth}/${nextYear} already exists`);
          }
          throw error;
        }

        const resolvedPeriod = await resolvePendingScheduledPayrollPeriod(tx, nextYear, nextMonth, newCycle.id);

        const bootstrap = await bootstrapPayrollEntries({
          tx,
          cycleId: newCycle.id,
          sourceCycleId: outgoingCycleId,
          activeEmployees,
          departedObligationEmployees,
        });

        let advancesMaterialized = 0;
        if (resolvedPeriod) {
          advancesMaterialized = await materializeScheduledAdvanceDeductions(
            {
              cycleId: newCycle.id,
              cycleYear: nextYear,
              cycleMonth: nextMonth,
              resolvedPeriodId: resolvedPeriod.id,
              employeeIdToEntryId: bootstrap.employeeIdToEntryId,
              actorUserId: currentUser.id,
              requestMeta,
            },
            tx,
          );
        }

        const [outgoingEntryCount, outgoingHeldUnreleasedCount] = await Promise.all([
          tx.payrollEntry.count({ where: { cycleId: outgoingCycleId } }),
          tx.payrollEntry.count({ where: { cycleId: outgoingCycleId, hold: true, released: false } }),
        ]);

        await recordAuditLog(
          {
            actorUserId: currentUser.id,
            action: 'payroll_cycle.archived',
            entityType: 'PayrollCycle',
            entityId: outgoingCycleId,
            metadata: {
              outgoingCycleId,
              newCycleId: newCycle.id,
              backupPackageId: reserved.id,
              backupVersion: nextVersion,
              entryCount: outgoingEntryCount,
              heldCount: outgoingHeldUnreleasedCount,
              departedObligationEntryCount: bootstrap.departedObligationEntryCount,
            },
            ipAddress: requestMeta.ipAddress,
            userAgent: requestMeta.userAgent,
          },
          tx,
        );

        await recordAuditLog(
          {
            actorUserId: currentUser.id,
            action: 'payroll_cycle.created',
            entityType: 'PayrollCycle',
            entityId: newCycle.id,
            metadata: {
              year: newCycle.year,
              month: newCycle.month,
              sourceCycleId: newCycle.sourceCycleId,
              entryCount: bootstrap.entryCount,
            },
            ipAddress: requestMeta.ipAddress,
            userAgent: requestMeta.userAgent,
          },
          tx,
        );

        await recordAuditLog(
          {
            actorUserId: currentUser.id,
            action: 'payroll_cycle.rollover_completed',
            entityType: 'PayrollCycle',
            entityId: newCycle.id,
            metadata: {
              outgoingCycleId,
              newCycleId: newCycle.id,
              backupPackageId: reserved.id,
              backupVersion: nextVersion,
              entriesCreated: bootstrap.entryCount,
              departedObligationEntries: bootstrap.departedObligationEntryCount,
              advancesMaterialized,
            },
            ipAddress: requestMeta.ipAddress,
            userAgent: requestMeta.userAgent,
          },
          tx,
        );

        const archivedOutgoingCycle = await tx.payrollCycle.findUniqueOrThrow({ where: { id: outgoingCycleId } });

        return {
          outgoingCycle: archivedOutgoingCycle,
          newCycle,
          backupPackageId: reserved.id,
          backupPackageVersion: nextVersion,
          entriesCreated: bootstrap.entryCount,
          departedObligationEntries: bootstrap.departedObligationEntryCount,
          advancesMaterialized,
        };
      },
      { timeout: 30_000 },
    );

    return result;
  } catch (error) {
    // Whatever failed — assembly, storage write, or the transaction itself — the reserved
    // BackupPackage row never reached a committed READY state (a transaction failure rolls the
    // READY flip back to GENERATING, exactly as if this attempt's commit phase never ran). The same
    // shared cleanup `generateBackupPackage` itself uses best-effort deletes this attempt's own
    // storage objects and marks the row FAILED — this rollover attempt never leaves the outgoing
    // cycle archived without its corresponding new Draft, because that pairing is the same
    // transaction: either both committed (this catch never runs) or neither did.
    await failBackupPackageGeneration({
      backupPackageId: reserved.id,
      cycleId: outgoingCycleId,
      version: nextVersion,
      writtenKeys,
      currentUser,
      requestMeta,
      error,
    });
    throw error;
  }
}
