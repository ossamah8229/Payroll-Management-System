import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import type { CreatePayrollCycleInput, SessionUser } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { conflict, notFound } from '../../common/http-error';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { materializeScheduledAdvanceDeductions } from '../advances/advances.service';

/**
 * Payroll Processing — owns the `PayrollCycle` lifecycle (docs/architecture/database/payroll-cycle.md
 * §10). Phase 3 Checkpoint 1 scope: cycle *creation* only (bootstrap and carry-forward). Finalize
 * Cycle, Release, Archiving, and Backup Package generation are explicitly NOT implemented here —
 * see this module's `createPayrollCycle` doc comment for the precise, approved scope boundary.
 *
 * **Phase 4 Checkpoint 5 (Advances) addition:** this module now also owns
 * `ScheduledPayrollPeriod` (docs/architecture/database/payroll-cycle.md §10a) — the only module that
 * ever creates, resolves, or mutates a row in that table. Advances only ever holds a foreign key
 * into it and calls `findOrCreateScheduledPayrollPeriod` below rather than touching the table
 * directly. **Deliberately no generic Outstanding-Payroll-Obligation provider/hook registry** (an
 * approved architecture decision, superseding the fuller framework `docs/architecture/workflows/
 * outstanding-obligations.md` describes as a future possibility) — `createPayrollCycle` calls
 * Advances' own `materializeScheduledAdvanceDeductions` directly. Should Phase 6 (Balance
 * Adjustments) become a genuine second consumer needing the same seam, that is the point to
 * generalize this into a real registry, not before.
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
 * Creates a `PayrollCycle` — either the very first one ever (no cycles exist yet) or a
 * subsequent one. Both share one implementation, since the entry-seeding logic itself is
 * identical either way and is squarely Phase 3's own concern (docs/IMPLEMENTATION_PLAN.md: "Builds
 * PayrollCycle Draft creation (bootstrapping the very first cycle)").
 *
 * **Explicit, approved scope boundary (Phase 3 Checkpoint 1) — what this function deliberately
 * does NOT do, and why:** the frozen architecture's *full* "new cycle creation" transaction
 * (docs/architecture/workflows/payroll-lifecycle.md §4) additionally requires the outgoing cycle to already
 * be `RELEASED`, archives it, generates a `BackupPackage`, and includes departed employees with a
 * `PENDING` `BalanceAdjustment` — that is explicitly Phase 5's job (`docs/IMPLEMENTATION_PLAN.md`
 * Phase 5), and depends on Finalize Cycle/Release (Phase 4), `BackupPackage`/`StorageProvider`
 * (Phase 5), and `BalanceAdjustment` (Phase 6), none of which exist yet. Building any of that now
 * would mean either stubbing out tables this checkpoint has no authorization to create, or
 * silently skipping a precondition the architecture treats as load-bearing — both rejected as
 * options. What IS enforced here, because it is a timeless, phase-independent invariant (§10):
 * only one `PayrollCycle` may ever be in `DRAFT` status at a time. The previous cycle's `status`
 * is left completely untouched by this function — it is never archived here.
 *
 * **The Payroll Bootstrap Rule (frozen business rule, confirmed 2026-07-07 — do not re-litigate):**
 * for a continuing employee (one with an entry in the most recent existing cycle), payroll-specific
 * values — `grossPay`, the new single work line's `cycleDays`/`otRate`, `leaveRate`,
 * `eobiApplicable`/`eobiAmount`, and any other payroll calculation parameter — are always carried
 * forward from that prior entry, never copied from `Employee`'s own record. Payroll values
 * represent payroll history and stay stable across cycles until intentionally changed in Payroll
 * Entry itself (Employee.grossPay is documented, §9, as a "template value only" — reverting to it
 * would silently discard a deliberate adjustment). Conversely, `designation`, `bankId`,
 * `branchCode`, `accountNumber`, `iban`, the new line's `unitId` (Primary Project Unit),
 * and `siteId` always refresh from `Employee`'s CURRENT record, never the prior entry's — Employee
 * master data should always reflect the employee's latest assignment/banking information. This
 * also keeps the new entry's `siteId` consistent with whichever site the employee's current
 * default unit actually belongs to (a genuine cross-site transfer between cycles would otherwise
 * leave the new entry's `siteId` and its work line's unit referring to two different sites,
 * violating the composite-FK invariant). Attendance (`days`/`otHours`) always resets to zero —
 * attendance is a fresh decision made each cycle (§12a), never carried forward. A genuinely new
 * employee (no prior entry) seeds entirely fresh from `Employee`'s own defaults.
 *
 * **`employeeNameSnapshot`/`fatherNameSnapshot` (Phase 4 Checkpoint 6.1) deliberately follow the
 * carry-forward rule, not the designation/banking refresh rule**, even though they are identity
 * fields: once first captured, a continuing employee's snapshot is copied forward from their prior
 * entry unchanged, never resynced from `Employee`'s current name, so a Payslip's name/father name
 * stays historically stable across cycles the same way an already-released cycle's own figures do.
 * This is the explicit, approved behavior for this checkpoint; a genuinely new employee (no prior
 * entry) still seeds fresh from `Employee`'s own current record, same as every other field above.
 * **Known gap, explicitly out of this checkpoint's scope**: there is not yet any route that lets
 * either snapshot field be corrected directly on a Draft `PayrollEntry` the way `designation`/
 * banking fields can — a genuine name-spelling correction currently requires a direct database
 * intervention. Exposing that edit path (mirroring `updatePayrollEntrySchema`'s existing
 * Draft-editable fields) is future work, not part of this checkpoint's approved backend-foundation
 * scope.
 *
 * **Performance (Principle 10):** seeds every entry via two chunked `createMany` calls rather than
 * one `create` per employee — this must not become an N-round-trip loop at the 10,000-employee
 * design floor. IDs are generated client-side (`randomUUID()`) so a `PayrollEntry` and its first
 * `PayrollEntryWorkLine` can be bulk-inserted separately while still referencing each other.
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

  const duplicate = await prisma.payrollCycle.findUnique({
    where: { year_month: { year: input.year, month: input.month } },
  });
  if (duplicate) {
    throw conflict(`A payroll cycle for ${input.month}/${input.year} already exists`);
  }

  const sourceCycle = await prisma.payrollCycle.findFirst({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  const activeEmployees = await prisma.employee.findMany({ where: { dateOfLeaving: null } });

  const sourceEntryByEmployeeId = new Map<
    string,
    Prisma.PayrollEntryGetPayload<{ include: { workLines: true } }>
  >();
  if (sourceCycle) {
    const sourceEntries = await prisma.payrollEntry.findMany({
      where: { cycleId: sourceCycle.id },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    for (const entry of sourceEntries) {
      sourceEntryByEmployeeId.set(entry.employeeId, entry);
    }
  }

  const entryRows: Prisma.PayrollEntryCreateManyInput[] = [];
  const workLineRows: Prisma.PayrollEntryWorkLineCreateManyInput[] = [];
  // Phase 4 Checkpoint 5 (Advances): which newly-created entry belongs to which employee, so the
  // materialization step below can target the right row without a second lookup.
  const employeeIdToEntryId = new Map<string, string>();

  for (const [index, employee] of activeEmployees.entries()) {
    const sourceEntry = sourceEntryByEmployeeId.get(employee.id);
    const primaryLine = sourceEntry?.workLines[0]; // already ordered by sortOrder asc
    const entryId = randomUUID();
    employeeIdToEntryId.set(employee.id, entryId);

    entryRows.push({
      id: entryId,
      cycleId: '', // placeholder, filled in once the cycle itself is created inside the transaction
      employeeId: employee.id,
      siteId: employee.siteId,
      // Phase 4 Checkpoint 6.1 — carry-forward, not refresh (see this function's own doc comment).
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
      // (createPayrollEntry assigns `maxSortOrder + 1`). At small manually-tested scale this was
      // invisible; at the 10,000-employee floor, `ORDER BY sortOrder ASC LIMIT/OFFSET` pagination
      // over 10,000 rows tied on the same value is unstable (Postgres gives no tiebreaker
      // guarantee), which a real-browser Playwright measurement caught as 23 rows silently
      // duplicated across page boundaries and 23 different rows never fetched at all — a genuine
      // data-loss bug, not a performance one. Each entry now gets its own distinct position,
      // matching the loop's own iteration order.
      sortOrder: index,
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

  const cycle = await prisma.$transaction(
    async (tx) => {
      const created = await tx.payrollCycle.create({
        data: {
          year: input.year,
          month: input.month,
          sourceCycleId: sourceCycle?.id ?? null,
          createdBy: currentUser.id,
        },
      });

      for (const row of entryRows) {
        row.cycleId = created.id;
      }

      for (const batch of chunk(entryRows, CHUNK_SIZE)) {
        await tx.payrollEntry.createMany({ data: batch });
      }
      for (const batch of chunk(workLineRows, CHUNK_SIZE)) {
        await tx.payrollEntryWorkLine.createMany({ data: batch });
      }

      // Phase 4 Checkpoint 5 (Advances) — resolution step, owned exclusively by Payroll Processing
      // (docs/architecture/database/payroll-cycle.md §10a): if anything ever scheduled a deduction
      // against this exact (year, month) before this cycle existed, resolve that
      // `ScheduledPayrollPeriod` row now — the one-time NULL → NOT NULL transition. If nothing was
      // ever scheduled against this period, there is nothing to resolve and ordinary cycle creation
      // proceeds unaffected, same as the schema doc specifies.
      const pendingPeriod = await tx.scheduledPayrollPeriod.findFirst({
        where: { year: input.year, month: input.month, payrollCycleId: null },
      });
      if (pendingPeriod) {
        await tx.scheduledPayrollPeriod.update({
          where: { id: pendingPeriod.id },
          data: { payrollCycleId: created.id, resolvedAt: new Date() },
        });

        // Deliberately a direct call into Advances' own module, not a generic provider/hook
        // registry (approved architecture decision) — see this file's own header comment.
        await materializeScheduledAdvanceDeductions(
          {
            cycleId: created.id,
            cycleYear: input.year,
            cycleMonth: input.month,
            resolvedPeriodId: pendingPeriod.id,
            employeeIdToEntryId,
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
            entryCount: entryRows.length,
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
