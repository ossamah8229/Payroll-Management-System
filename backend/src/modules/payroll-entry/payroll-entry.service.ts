import type { Prisma, PayrollEntry, PayrollEntryWorkLine, PayrollCycleStatus } from '@prisma/client';
import type {
  AddWorkLineInput,
  BulkUpdatePayrollEntriesInput,
  CreatePayrollEntryInput,
  SessionUser,
  UpdatePayrollEntryInput,
  UpdateWorkLineInput,
} from '@payroll/shared';
import { calcNet, normalizeAccountNumber, normalizeIban, type CalcNetResult, type PayrollEntryCalcInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import { diffFields, omitKeys } from '../../common/audit-diff';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertUnitBelongsToSite } from '../employees/employees.service';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { evaluatePayrollEntryReleaseReadiness, RELEASE_BLOCK_REASONS } from '../payroll-release/payroll-release-eligibility';
import { syncEobiApplicability } from './eobi-sync.service';

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** Every `workLines` include across this file, in one place — always ordered by `sortOrder` (so
 * `[0]` is reliably the primary line) and always carrying its own `unit` relation, the source of
 * the grid's "Deputed Branch" column (`ProjectUnit.code` — the "deputed branch/site code" for that
 * specific work line). A released/archived entry's work lines are never edited again (§12), so
 * this is the same historical snapshot for those entries forever; a Draft entry's lines reflect
 * whatever the roster reconciliation/edits currently have them pointing at. */
export const WORK_LINES_INCLUDE = { orderBy: { sortOrder: 'asc' as const }, include: { unit: true } };

export type EntryWithWorkLines = PayrollEntry & { workLines: PayrollEntryWorkLine[] };

/**
 * Adapts stored `PayrollEntry`/`PayrollEntryWorkLine` (Prisma `Decimal` fields) into shared
 * `calcNet`'s string-based input contract and returns its result — the single computation path
 * every read of a Payroll Entry's net salary goes through (Principle 5/6). Never reimplemented
 * inline; every route below that returns an entry calls this rather than computing anything itself.
 */
export function computeEntryCalc(entry: EntryWithWorkLines): CalcNetResult {
  const input: PayrollEntryCalcInput = {
    grossPay: entry.grossPay.toString(),
    allowance: entry.allowance.toString(),
    leaveDays: entry.leaveDays.toString(),
    leaveRate: entry.leaveRate?.toString() ?? null,
    eobiAmount: entry.eobiAmount.toString(),
    eobiApplicable: entry.eobiApplicable,
    advanceDeduction: entry.advanceDeduction.toString(),
    eidAdvanceDeduction: entry.eidAdvanceDeduction.toString(),
    fine: entry.fine.toString(),
    // Phase 6 Checkpoint 5 — passed through so a materialized correction obligation
    // (BalanceAdjustmentMaterialization, backend/src/modules/corrections/) is reflected in this
    // entry's own calculated net salary everywhere computeEntryCalc is the single computation
    // path (the grid, entry detail, exports) — not just at materialization-creation time.
    correctionBalancePayable: entry.correctionBalancePayable.toString(),
    correctionBalanceRecovery: entry.correctionBalanceRecovery.toString(),
    workLines: entry.workLines.map((line) => ({
      sortOrder: line.sortOrder,
      days: line.days.toString(),
      otHours: line.otHours.toString(),
      otRate: line.otRate?.toString() ?? null,
      cycleDays: line.cycleDays,
    })),
  };
  return calcNet(input);
}

// Generic over the caller's actual fetched shape (not fixed to `EntryWithWorkLines`) so a caller
// that included `unit` on its `workLines` (via `WORK_LINES_INCLUDE`, above) gets that field back on
// the returned object — `computeEntryCalc` itself never reads `unit`, so it doesn't need to be part
// of the type it requires, only of what this function happens to be passed and preserves.
function withCalc<T extends EntryWithWorkLines>(entry: T): T & { calc: CalcNetResult } {
  return { ...entry, calc: computeEntryCalc(entry) };
}

/**
 * Master Data Boundary (Phase 7D, 2026-07-30; extended Phase 7F, 2026-08-04) — Employee Registry is
 * now the sole authoritative, editable source for `designation`/`bankId`/`branchCode`/
 * `accountNumber`/`iban`/`grossPay`/employee name/father name (docs/architecture/database/
 * employee.md); `updatePayrollEntrySchema` no longer accepts writes to any of them. `PayrollEntry`
 * still *stores* its own copy of these columns — that copy is what gets frozen permanently at
 * release time (`payroll-release.service.ts`'s `releaseProjectUnit`) so Payslips/Bank Sheets/every
 * other historical document keeps reading a stable, never-rewritten snapshot (Principle 9) — but
 * while an entry is still unreleased, that stored copy is no longer the *display* (or calculation)
 * source of truth. This overwrites it with the live `Employee` record on every read, so a
 * Draft/Open cycle always reflects whatever Employee Registry currently says (a corrected bank
 * account, a title change, a revised Gross Salary) the moment the page is refreshed — no separate
 * "resync" action, and no possibility of Payroll Entry silently showing (or calculating net salary
 * from) a stale duplicate. Once `released = true` — or once a Unit release sweep has otherwise
 * *resolved* the entry without setting `released` itself (`payoutOutcome = NO_PAY_DUE`/
 * `RECOVERY_DUE`, the same "locked" tier `assertEntryEditable`/`withReleaseBlockReasons` already
 * treat identically to `released`) — this is a no-op: the entry's own frozen columns (synced to
 * Employee Registry's live values at the moment of that resolution, `payroll-release.service.ts`)
 * are returned exactly as stored, untouched by whatever Employee Registry says today.
 *
 * **Phase 7F (2026-08-04)**: `grossPay`/`employeeNameSnapshot`/`fatherNameSnapshot` join this
 * overlay — production UAT found Gross Salary specifically was missed by the Phase 7D pass (still
 * a Draft-editable duplicated column, the reported defect); Employee Name/Father Name were already
 * effectively live everywhere they're displayed (the grid reads `entry.employee.name` directly, a
 * live join, never the snapshot column) but the *stored* snapshot columns themselves — which
 * Payslip generation reads for a *released* entry — were never refreshed at read time or re-frozen
 * at release, so a name/father-name change between entry creation and release would silently not
 * appear on the eventual Payslip. Folded into this one function rather than a second one, since
 * the gating condition (`released || payoutOutcome !== null`) is identical.
 *
 * **Exported (Phase 7F Refinement, 2026-08-04)** — CSV/Excel export
 * (`payroll-entry-import-export.service.ts`) was found reading these same columns straight off the
 * stored row, bypassing this overlay entirely; a Draft export could show a stale Gross
 * Pay/Designation the on-screen grid no longer showed. Exporting this function (rather than
 * re-deriving the same logic a second time) is the minimum-safe fix — same function, same
 * `released || payoutOutcome !== null` gate, so a Released/Archived entry's export row is
 * unaffected (still reads the frozen, historical columns exactly as stored) and calculations are
 * untouched (this function never touches `calcNet`/`computeEntryCalc` inputs beyond the values it
 * already overlays for on-screen display).
 */
export function withLiveMasterData<
  T extends {
    released: boolean;
    payoutOutcome: string | null;
    designation: string;
    bankId: string | null;
    branchCode: string | null;
    accountNumber: string | null;
    iban: string | null;
    grossPay: Prisma.Decimal;
    employeeNameSnapshot: string | null;
    fatherNameSnapshot: string | null;
    employee: {
      designation: string;
      bankId: string | null;
      branchCode: string | null;
      accountNumber: string | null;
      iban: string | null;
      grossPay: Prisma.Decimal;
      name: string;
      fatherName: string | null;
    };
  },
>(entry: T): T {
  if (entry.released || entry.payoutOutcome !== null) return entry;
  return {
    ...entry,
    designation: entry.employee.designation,
    bankId: entry.employee.bankId,
    branchCode: entry.employee.branchCode,
    accountNumber: entry.employee.accountNumber,
    iban: entry.employee.iban,
    grossPay: entry.employee.grossPay,
    employeeNameSnapshot: entry.employee.name,
    fatherNameSnapshot: entry.employee.fatherName,
  };
}

/**
 * Pre-release "Needs Attention" visibility (2026-07-27 refinement) — the Payroll Entry grid must
 * never silently show a plain "—" for an employee the backend already knows can't release
 * (duplicate CNIC/Employee Code/Account Number/IBAN, or a bank-paid entry missing its Account
 * Number). Reuses `evaluatePayrollEntryReleaseReadiness` — the exact same canonical function
 * `releaseProjectUnit` enforces with — rather than reimplementing any of these rules; only its
 * `blockReasons` are used here (the `netSalary` argument is irrelevant to this display purpose).
 * Skipped entirely for an already-resolved entry (`released`, `hold`, or a non-null
 * `payoutOutcome`) — there is nothing left to warn about once an entry has locked.
 *
 * **Single-entry only** — up to four DB round trips for the one entry being returned (a mutation
 * response, or `getPayrollEntry`'s detail view). For a *list* of entries, use
 * `attachReleaseBlockReasonsBulk` below instead — calling this once per row doubled as a real
 * regression under concurrent load (a 50-row page load, run alongside 50 concurrent mutations,
 * multiplied to hundreds of simultaneous queries and exhausted the connection pool — caught by
 * `payroll-entry-performance.test.ts`'s own concurrency suite).
 */
async function withReleaseBlockReasons<
  T extends {
    released: boolean;
    hold: boolean;
    payoutOutcome: string | null;
    employeeId: string;
    bankId: string | null;
    accountNumber: string | null;
    iban: string | null;
    employee: { cnic: string | null; employeeCode: string | null };
  },
>(entry: T): Promise<T & { releaseBlockReasons: string[] }> {
  if (entry.released || entry.hold || entry.payoutOutcome !== null) {
    return { ...entry, releaseBlockReasons: [] };
  }
  const readiness = await evaluatePayrollEntryReleaseReadiness(
    {
      employeeId: entry.employeeId,
      bankId: entry.bankId,
      accountNumber: entry.accountNumber,
      iban: entry.iban,
    },
    entry.employee,
    '0',
    prisma,
  );
  return { ...entry, releaseBlockReasons: readiness.blockReasons };
}

/**
 * Bulk variant of `withReleaseBlockReasons`, for the Payroll Entry *list* (`listPayrollEntries`) —
 * the exact same duplicate-identity/missing-banking-detail rules `evaluatePayrollEntryReleaseReadiness`
 * enforces (same `RELEASE_BLOCK_REASONS` wording, imported from the same canonical module — never a
 * second definition of what counts as a duplicate), but computed via a handful of batched queries
 * across the whole page instead of up to four sequential lookups per row. A page of N unresolved
 * rows now costs a constant ~4 queries, not up to 4×N — the shape this codebase's own N+1 discipline
 * already requires elsewhere (`payslips.test.ts`'s "issues a constant number of queries regardless
 * of batch size").
 */
async function attachReleaseBlockReasonsBulk<
  T extends {
    id: string;
    employeeId: string;
    released: boolean;
    hold: boolean;
    payoutOutcome: string | null;
    bankId: string | null;
    accountNumber: string | null;
    iban: string | null;
    employee: { cnic: string | null; employeeCode: string | null };
  },
>(entries: T[]): Promise<Array<T & { releaseBlockReasons: string[] }>> {
  const candidates = entries.filter((entry) => !entry.released && !entry.hold && entry.payoutOutcome === null);
  if (candidates.length === 0) {
    return entries.map((entry) => ({ ...entry, releaseBlockReasons: [] }));
  }

  const accountCanonicalByEntryId = new Map(candidates.map((entry) => [entry.id, normalizeAccountNumber(entry.accountNumber)]));
  const ibanCanonicalByEntryId = new Map(candidates.map((entry) => [entry.id, normalizeIban(entry.iban)]));

  const cnics = [...new Set(candidates.map((entry) => entry.employee.cnic).filter((value): value is string => Boolean(value)))];
  const codes = [
    ...new Set(candidates.map((entry) => entry.employee.employeeCode).filter((value): value is string => Boolean(value))),
  ];
  const accountCanonicals = [
    ...new Set([...accountCanonicalByEntryId.values()].filter((value): value is string => Boolean(value))),
  ];
  const ibanCanonicals = [...new Set([...ibanCanonicalByEntryId.values()].filter((value): value is string => Boolean(value)))];

  const [cnicRows, codeRows, accountRows, ibanRows] = await Promise.all([
    cnics.length ? prisma.employee.findMany({ where: { cnic: { in: cnics } }, select: { id: true, cnic: true } }) : [],
    codes.length
      ? prisma.employee.findMany({ where: { employeeCode: { in: codes } }, select: { id: true, employeeCode: true } })
      : [],
    accountCanonicals.length
      ? prisma.employee.findMany({
          where: { accountNumberCanonical: { in: accountCanonicals } },
          select: { id: true, accountNumberCanonical: true },
        })
      : [],
    ibanCanonicals.length
      ? prisma.employee.findMany({ where: { ibanCanonical: { in: ibanCanonicals } }, select: { id: true, ibanCanonical: true } })
      : [],
  ]);

  // Maps each candidate value to every *currently existing* Employee id holding it (almost always
  // exactly one, given the DB's own uniqueness constraints on all four fields — but see below).
  // The check this mirrors is `findEmployeeByCnic`/etc.'s own "does anyone *other than me* hold
  // this value" — never "do two rows in the Employee table currently collide," which the DB
  // constraints on all four fields already make near-impossible going forward. The scenario this
  // must still catch: a `PayrollEntry`'s own *frozen* accountNumber/iban snapshot ("copied, not
  // linked") no longer matches its own employee's current record (which legitimately moved on to
  // a new value) but now collides with some *other* employee's current one — the exact case Part
  // A6/B8 exist for. A value held by 2+ distinct ids (a legacy, pre-constraint duplicate) is
  // handled the same way: it's a conflict for anyone holding it, self included.
  function holdersByValue<R extends { id: string }>(rows: R[], getValue: (row: R) => string | null): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      const value = getValue(row);
      if (!value) continue;
      const ids = map.get(value) ?? new Set<string>();
      ids.add(row.id);
      map.set(value, ids);
    }
    return map;
  }

  function isDuplicateForEmployee(holders: Map<string, Set<string>>, value: string | null, employeeId: string): boolean {
    if (!value) return false;
    const ids = holders.get(value);
    if (!ids) return false;
    return [...ids].some((id) => id !== employeeId);
  }

  const cnicHolders = holdersByValue(cnicRows, (row) => row.cnic);
  const codeHolders = holdersByValue(codeRows, (row) => row.employeeCode);
  const accountHolders = holdersByValue(accountRows, (row) => row.accountNumberCanonical);
  const ibanHolders = holdersByValue(ibanRows, (row) => row.ibanCanonical);

  return entries.map((entry) => {
    if (entry.released || entry.hold || entry.payoutOutcome !== null) {
      return { ...entry, releaseBlockReasons: [] };
    }

    const reasons: string[] = [];
    if (isDuplicateForEmployee(cnicHolders, entry.employee.cnic, entry.employeeId)) {
      reasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_CNIC);
    }
    if (isDuplicateForEmployee(codeHolders, entry.employee.employeeCode, entry.employeeId)) {
      reasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_EMPLOYEE_CODE);
    }
    if (entry.bankId) {
      if (!entry.accountNumber) {
        reasons.push(RELEASE_BLOCK_REASONS.MISSING_ACCOUNT_NUMBER);
      } else if (isDuplicateForEmployee(accountHolders, accountCanonicalByEntryId.get(entry.id) ?? null, entry.employeeId)) {
        reasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_ACCOUNT_NUMBER);
      }
    }
    if (isDuplicateForEmployee(ibanHolders, ibanCanonicalByEntryId.get(entry.id) ?? null, entry.employeeId)) {
      reasons.push(RELEASE_BLOCK_REASONS.DUPLICATE_IBAN);
    }

    return { ...entry, releaseBlockReasons: reasons };
  });
}

/**
 * A `PayrollEntry` is mutable only while `released = false` **and its cycle is not `ARCHIVED`**
 * (docs/architecture/database/payroll-entry.md §12, corrected 2026-07-14 — Phase 5 Checkpoint 1
 * architecture review; extended 2026-07-15 — Phase 5 Checkpoint 4 architecture review). Between
 * `DRAFT` and `RELEASED`, immutability is driven exclusively by the entry's own `released` flag,
 * never by the parent cycle's status: Finalize Cycle (`DRAFT` → `RELEASED`) does not release held
 * entries, so a held, unreleased entry stays exactly as editable after finalization as it was the
 * moment before — `hold` has no bearing on mutability either way. **`ARCHIVED` is the one exception,
 * added Checkpoint 4**: once rollover archives a cycle, ordinary editing stops entirely, including
 * for a held/unreleased entry that never resolved before archiving — the approved
 * "Archive locks all ordinary editing" decision (2026-07-15 architecture review), chosen specifically
 * to keep the Backup Package generated at archive time meaningfully authoritative (a still-editable
 * held row would let archived history silently drift after the snapshot was taken). A held
 * employee's unresolved pay is addressed forward, in their own carried-forward entry in a future
 * Draft cycle — never by reaching back into a locked Archived row; there is still no dedicated Late
 * Entry / exceptional-settlement workflow (remains deferred).
 */
export function assertEntryEditable(entry: {
  released: boolean;
  payoutOutcome: string | null;
  cycle: { status: PayrollCycleStatus };
}): void {
  if (entry.released) {
    throw badRequest(
      'This payroll entry is locked and can no longer be edited directly — released payroll is immutable (Principle 9)',
    );
  }
  // Negative Payroll Recovery checkpoint (2026-07-26) — a zero/negative-net entry resolved by a
  // Unit release sweep (`payoutOutcome = NO_PAY_DUE`/`RECOVERY_DUE`) is just as locked as a paid
  // one, even though `released` itself stays `false` for it (released never redefines its meaning
  // to include this case — see `payroll-release.service.ts`).
  if (entry.payoutOutcome != null) {
    throw badRequest(
      'This payroll entry has been resolved by its Unit release (no payment due / recovery due) and can no longer be edited directly — released payroll is immutable (Principle 9)',
    );
  }
  if (entry.cycle.status === 'ARCHIVED') {
    throw badRequest(
      'This payroll entry belongs to an Archived payroll cycle and can no longer be edited — Archived cycles are permanently locked for ordinary editing',
    );
  }
}

async function getEntryForMutation(id: string) {
  const entry = await prisma.payrollEntry.findUnique({
    where: { id },
    include: { cycle: true, workLines: WORK_LINES_INCLUDE },
  });
  if (!entry) {
    throw notFound('Payroll entry not found');
  }
  return entry;
}

async function getWorkLineForMutation(workLineId: string) {
  const line = await prisma.payrollEntryWorkLine.findUnique({
    where: { id: workLineId },
    include: { payrollEntry: { include: { cycle: true, workLines: WORK_LINES_INCLUDE } } },
  });
  if (!line) {
    throw notFound('Payroll entry work line not found');
  }
  return line;
}

export interface ListPayrollEntriesFilters {
  cycleId: string;
  siteId?: string;
  employeeId?: string;
  page?: number;
  pageSize?: number;
}

export async function listPayrollEntries(currentUser: SessionUser, filters: ListPayrollEntriesFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

  if (filters.siteId) {
    assertSiteAccess(currentUser, filters.siteId);
  }

  // A Payroll Staff user with no explicit siteId filter is scoped to every site they're assigned
  // to; Master Admin with no filter sees the whole cycle (§ "site-scoping for Payroll Entry...
  // enforced against PayrollEntry.siteId").
  const siteIdFilter = filters.siteId
    ? [filters.siteId]
    : !isMasterAdmin(currentUser)
      ? currentUser.siteIds
      : undefined;

  const where: Prisma.PayrollEntryWhereInput = {
    cycleId: filters.cycleId,
    ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    ...(filters.employeeId && { employeeId: filters.employeeId }),
  };

  const [total, entries] = await Promise.all([
    prisma.payrollEntry.count({ where }),
    prisma.payrollEntry.findMany({
      where,
      include: {
        employee: true,
        site: true,
        bank: true,
        // Phase 4 Checkpoint 5 (Advances) — the small linked-balance indicator surfaced under
        // the Advance/Eid Advance grid cells; a light select, not the full row.
        advance: { select: { id: true, outstandingBalance: true, status: true } },
        eidAdvance: { select: { id: true, outstandingBalance: true, status: true } },
        workLines: WORK_LINES_INCLUDE,
      },
      orderBy: { sortOrder: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    entries: await attachReleaseBlockReasonsBulk(entries.map((entry) => withCalc(withLiveMasterData(entry)))),
  };
}

export async function getPayrollEntry(currentUser: SessionUser, id: string) {
  const entry = await prisma.payrollEntry.findUnique({
    where: { id },
    include: {
      employee: true,
      site: true,
      bank: true,
      // Phase 4 Checkpoint 5 (Advances) — the small linked-balance indicator surfaced under
      // the Advance/Eid Advance grid cells; a light select, not the full row.
      advance: { select: { id: true, outstandingBalance: true, status: true } },
      eidAdvance: { select: { id: true, outstandingBalance: true, status: true } },
      workLines: WORK_LINES_INCLUDE,
    },
  });
  if (!entry) {
    throw notFound('Payroll entry not found');
  }
  assertSiteAccess(currentUser, entry.siteId);
  return withReleaseBlockReasons(withCalc(withLiveMasterData(entry)));
}

/**
 * Creates a `PayrollEntry` for one employee within one Draft cycle — the "add this employee to
 * the cycle" action (a new hire mid-cycle, or an employee the bulk cycle-creation sweep somehow
 * missed). `grossPay`/`allowance`/etc. are never caller-supplied here; they are always copied from
 * `Employee`'s current record at this exact moment (§12), then ordinarily Draft-editable via
 * `updatePayrollEntry` afterward. Always creates at least one `PayrollEntryWorkLine` in the same
 * transaction as the entry itself — an entry is never left with zero lines, even transiently
 * (§12a).
 */
export async function createPayrollEntry(
  currentUser: SessionUser,
  cycleId: string,
  input: CreatePayrollEntryInput,
  requestMeta: RequestMeta,
) {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  if (cycle.status !== 'DRAFT') {
    throw badRequest('Cannot add a payroll entry to a cycle that is not in Draft');
  }

  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) {
    throw notFound('Employee not found');
  }

  assertSiteAccess(currentUser, employee.siteId);

  const existing = await prisma.payrollEntry.findUnique({
    where: { cycleId_employeeId: { cycleId, employeeId: input.employeeId } },
  });
  if (existing) {
    throw conflict('This employee already has a payroll entry for this cycle');
  }

  const seeds = input.workLines?.length ? input.workLines : [{}];

  const resolvedLines: { unitId: string; days: string; otHours: string; otRate: string | null; cycleDays: number }[] =
    [];
  for (const seed of seeds) {
    const unitId = seed.unitId ?? employee.unitId;
    await assertUnitBelongsToSite(unitId, employee.siteId);
    resolvedLines.push({
      unitId,
      days: seed.days ?? '0',
      otHours: seed.otHours ?? '0',
      otRate: seed.otRate ?? null,
      cycleDays: seed.cycleDays ?? 30,
    });
  }

  const maxSortOrder = await prisma.payrollEntry.aggregate({
    where: { cycleId },
    _max: { sortOrder: true },
  });
  const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollEntry.create({
      data: {
        cycleId,
        employeeId: employee.id,
        siteId: employee.siteId,
        // Phase 4 Checkpoint 6.1 (Payslips backend foundation) — frozen at creation, same "copied,
        // not linked" convention as designation/banking below. No prior-entry carry-forward path
        // exists here: this is the single ad-hoc "add this employee to the cycle" action, which has
        // no prior-cycle concept of its own (that carry-forward instead lives in
        // `payroll-processing.service.ts`'s `createPayrollCycle` bootstrap).
        employeeNameSnapshot: employee.name,
        fatherNameSnapshot: employee.fatherName,
        designation: employee.designation,
        bankId: employee.bankId,
        branchCode: employee.branchCode,
        accountNumber: employee.accountNumber,
        iban: employee.iban,
        grossPay: employee.grossPay,
        eobiAmount: employee.defaultEobiAmount,
        eobiApplicable: employee.defaultEobiApplicable,
        sortOrder: nextSortOrder,
        workLines: {
          create: resolvedLines.map((line, index) => ({
            siteId: employee.siteId,
            unitId: line.unitId,
            days: line.days,
            otHours: line.otHours,
            otRate: line.otRate,
            cycleDays: line.cycleDays,
            sortOrder: index,
          })),
        },
      },
      include: { workLines: WORK_LINES_INCLUDE },
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'payroll_entry.created',
        entityType: 'PayrollEntry',
        entityId: created.id,
        metadata: { cycleId, employeeId: employee.id, siteId: employee.siteId },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return created;
  });

  // A freshly created entry has no Employee relation loaded here (only `workLines` was included),
  // so the release-readiness check (which needs the employee's own cnic/employeeCode) can't run
  // against this shape — and a brand-new entry has nothing to warn about yet regardless (Employee
  // creation itself already rejects a duplicate CNIC/Code/Account Number/IBAN before this entry
  // could ever exist, B4). The grid's own list refetch picks up the real check on its next load.
  return { ...withCalc(entry), releaseBlockReasons: [] };
}

/** Fields on `UpdatePayrollEntryInput` that map 1:1 onto a Prisma update payload. `version` is
 * handled separately (the optimistic-locking guard), never written as an ordinary field. Exported
 * so the Payroll Entry import path (Checkpoint 5) reuses this exact mapping rather than
 * redefining it — one implementation of "which fields does an ordinary entry edit touch."
 *
 * Phase 7D (2026-07-30) — `designation`/`bankId`/`branchCode`/`accountNumber`/`iban` deliberately
 * absent: `updatePayrollEntrySchema` no longer accepts them at all (Employee Registry is now the
 * sole editable source for these fields), so there is nothing for this mapper to translate.
 * Phase 7F (2026-08-04) — `grossPay` removed the same way, for the same reason. */
export function mapUpdateInputToEntryData(
  input: Omit<UpdatePayrollEntryInput, 'version'>,
): Prisma.PayrollEntryUncheckedUpdateInput {
  return {
    ...(input.allowance !== undefined && { allowance: input.allowance }),
    ...(input.leaveDays !== undefined && { leaveDays: input.leaveDays }),
    ...(input.leaveRate !== undefined && { leaveRate: input.leaveRate }),
    ...(input.eobiAmount !== undefined && { eobiAmount: input.eobiAmount }),
    ...(input.eobiApplicable !== undefined && { eobiApplicable: input.eobiApplicable }),
    ...(input.advanceDeduction !== undefined && { advanceDeduction: input.advanceDeduction }),
    ...(input.eidAdvanceDeduction !== undefined && { eidAdvanceDeduction: input.eidAdvanceDeduction }),
    ...(input.fine !== undefined && { fine: input.fine }),
    ...(input.hold !== undefined && { hold: input.hold }),
    ...(input.remarks !== undefined && { remarks: input.remarks }),
    ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
  };
}

/**
 * Advance/Payroll Entry integrity boundary (v1.0.2 Advance Edit/Cancel checkpoint, 2026-08-25).
 * `advanceDeduction`/`eidAdvanceDeduction` are ordinary Draft-editable fields — but only for an
 * entry with no linked `Advance`/`eidAdvance` (a legitimately manual, ledger-free deduction; that
 * case is untouched by this guard). Once `advanceId`/`eidAdvanceId` is set, that figure is
 * Advance-ledger-owned: it was written by `materializeOneAdvanceDeduction` and must only ever
 * change via the Advances module's own `updateAdvance`/`cancelAdvance`/`deferAdvanceSchedule`,
 * which keep the Advance's own `totalAmount`/`outstandingBalance` in lockstep with it in the same
 * transaction. Editing it directly here would silently desync the two — exactly the production
 * defect this checkpoint root-caused (a direct `advanceDeduction` PATCH to 10,000 against a 5,000
 * Advance left the entry and its Advance disagreeing, which then crashed Cancel's own reversal
 * with an unhandled `Advance_outstandingBalance_check` violation). Rejected with a clear domain
 * error rather than silently accepted or left to fail later at the Advance layer.
 */
function assertDeductionNotAdvanceLinked(
  existing: { advanceId: string | null; eidAdvanceId: string | null },
  input: { advanceDeduction?: string; eidAdvanceDeduction?: string },
): void {
  if (input.advanceDeduction !== undefined && existing.advanceId !== null) {
    throw badRequest(
      'This deduction is managed by a linked Advance — edit or cancel the Advance itself (Advances) instead of changing it directly here',
    );
  }
  if (input.eidAdvanceDeduction !== undefined && existing.eidAdvanceId !== null) {
    throw badRequest(
      'This deduction is managed by a linked Eid Advance — edit or cancel the Advance itself (Advances) instead of changing it directly here',
    );
  }
}

/**
 * Ordinary field edit to an already-created `PayrollEntry`. Optimistic locking (§22): the caller
 * must supply the `version` they last read; a stale version is rejected with 409, never silently
 * overwritten. Guarded via `updateMany({ where: { id, version } })` rather than `update()` — a
 * plain `update()` would need a compound `(id, version)` unique index (a schema change this
 * checkpoint doesn't make); `updateMany` needs no such index and reports how many rows it actually
 * touched, which is exactly the signal a stale-version conflict needs.
 */
export async function updatePayrollEntry(
  currentUser: SessionUser,
  id: string,
  input: UpdatePayrollEntryInput,
  requestMeta: RequestMeta,
) {
  const existing = await getEntryForMutation(id);
  assertSiteAccess(currentUser, existing.siteId);
  assertEntryEditable(existing);
  assertDeductionNotAdvanceLinked(existing, input);

  const { version, ...fields } = input;
  const data = mapUpdateInputToEntryData(fields);
  const allChanges = diffFields(
    existing as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  // EOBI Bidirectional Synchronisation (Phase 7D refinement, 2026-07-30, permissions/audit
  // revision) — changing this field also writes to the employee's own Employee Registry record
  // (`eobi-sync.service.ts`), but that write is an *internal system synchronisation*, not a second
  // user edit: the user is authorised to change EOBI applicability because they hold this route's
  // own `payroll:entry` permission (already enforced by the route), and that authorisation alone is
  // sufficient — `employees:edit` is deliberately never checked here. This does not weaken
  // Employee Registry's own protection: a user cannot reach `PATCH /employees/:id` itself, or any
  // *other* Employee field, without holding `employees:edit` in the ordinary way; only the
  // synchronised EOBI write is exempt, and only because it is not an independent edit of that
  // resource.
  //
  // `eobiApplicable` is excluded from the generic `payroll_entry.updated` changes bundle below and
  // given its own dedicated `payroll_entry.eobi_updated` audit entry instead (mirrors
  // `employees.service.ts`'s own `siteId`/`unitId` exclusion for `employee.transferred`) — every
  // EOBI applicability change on this entity, whichever screen originates it, is recorded exactly
  // once under that one consistent action name, never folded into (or duplicated alongside) the
  // generic bundle.
  const changesEobiApplicable = data.eobiApplicable !== undefined && data.eobiApplicable !== existing.eobiApplicable;
  const changes = omitKeys(allChanges, ['eobiApplicable']);

  // Negative Payroll Recovery checkpoint (2026-07-27, performance fix) — `withReleaseBlockReasons`
  // does its own DB round trips; running it *inside* this interactive transaction extended the
  // transaction's own held time and made it compete with those extra queries for the same
  // connection pool, causing real "Transaction already closed: ... timeout" failures under
  // concurrent load (`payroll-entry-performance.test.ts`'s own concurrency suite caught this).
  // Committed first, then the readiness check runs against a released connection.
  const updated = await prisma.$transaction(async (tx) => {
    const guarded = await tx.payrollEntry.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });

    if (guarded.count === 0) {
      throw conflict('This payroll entry was changed by someone else — reload and try again');
    }

    if (Object.keys(changes).length > 0) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_entry.updated',
          entityType: 'PayrollEntry',
          entityId: id,
          metadata: { changes },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    if (changesEobiApplicable) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_entry.eobi_updated',
          entityType: 'PayrollEntry',
          entityId: id,
          metadata: { previousValue: existing.eobiApplicable, newValue: data.eobiApplicable, origin: 'payroll_entry' },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    // EOBI Bidirectional Synchronisation — same transaction as the entry write itself, so both
    // records update together or not at all (a version conflict above already threw before this
    // point, so this only runs once the entry write is guaranteed to commit).
    if (changesEobiApplicable) {
      await syncEobiApplicability({
        tx,
        employeeId: existing.employeeId,
        newValue: data.eobiApplicable as boolean,
        origin: 'payroll_entry',
        actorUserId: currentUser.id,
        requestMeta,
        sourcePayrollEntryId: id,
      });
    }

    return tx.payrollEntry.findUniqueOrThrow({
      where: { id },
      include: {
        workLines: WORK_LINES_INCLUDE,
        employee: {
          select: {
            cnic: true,
            employeeCode: true,
            designation: true,
            bankId: true,
            branchCode: true,
            accountNumber: true,
            iban: true,
            grossPay: true,
            name: true,
            fatherName: true,
          },
        },
      },
    });
  });
  return withReleaseBlockReasons(withCalc(withLiveMasterData(updated)));
}

/**
 * Deletes a `PayrollEntry`, only where the architecture permits it: the entry must be unreleased
 * and its cycle still Draft (same condition as an ordinary edit — this is not "historical payroll"
 * yet, so Principle 2 does not apply to it). `PayrollEntryWorkLine` rows cascade-delete at the
 * database level (§12a, `ON DELETE CASCADE`) — no separate cleanup needed here.
 */
export async function deletePayrollEntry(
  currentUser: SessionUser,
  id: string,
  expectedVersion: number,
  requestMeta: RequestMeta,
): Promise<void> {
  const existing = await getEntryForMutation(id);
  assertSiteAccess(currentUser, existing.siteId);
  assertEntryEditable(existing);

  await prisma.$transaction(async (tx) => {
    const guarded = await tx.payrollEntry.deleteMany({ where: { id, version: expectedVersion } });
    if (guarded.count === 0) {
      throw conflict('This payroll entry was changed by someone else — reload and try again');
    }

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'payroll_entry.deleted',
        entityType: 'PayrollEntry',
        entityId: id,
        metadata: { cycleId: existing.cycleId, employeeId: existing.employeeId },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );
  });
}

/**
 * Adds a new `PayrollEntryWorkLine` to an already-existing entry — the backend capability behind
 * "Split by {unitLabel}" (its UI is a later checkpoint). Work lines carry no `version` of their
 * own; they mutate under their parent entry's lock (§22), so this bumps `PayrollEntry.version`
 * using the caller-supplied value in the same transaction as the line insert, and the change is
 * folded into a `payroll_entry.updated` audit entry (§22: "work-line attendance changes...
 * captured in the same field-level diff"), never a separate `PayrollEntryWorkLine`-typed action.
 */
export async function addWorkLine(
  currentUser: SessionUser,
  entryId: string,
  input: AddWorkLineInput,
  requestMeta: RequestMeta,
) {
  const entry = await getEntryForMutation(entryId);
  assertSiteAccess(currentUser, entry.siteId);
  assertEntryEditable(entry);
  await assertUnitBelongsToSite(input.unitId, entry.siteId);

  const nextSortOrder = entry.workLines.length
    ? Math.max(...entry.workLines.map((line) => line.sortOrder)) + 1
    : 0;

  // Negative Payroll Recovery checkpoint (2026-07-27, performance fix) — see the doc comment on
  // `updatePayrollEntry`'s own identical restructuring: `withReleaseBlockReasons` must run after
  // this transaction commits, never inside it.
  const updated = await prisma.$transaction(async (tx) => {
    const guarded = await tx.payrollEntry.updateMany({
      where: { id: entryId, version: input.version },
      data: { version: { increment: 1 } },
    });
    if (guarded.count === 0) {
      throw conflict('This payroll entry was changed by someone else — reload and try again');
    }

    const line = await tx.payrollEntryWorkLine.create({
      data: {
        payrollEntryId: entryId,
        siteId: entry.siteId,
        unitId: input.unitId,
        days: input.days ?? '0',
        otHours: input.otHours ?? '0',
        otRate: input.otRate ?? null,
        cycleDays: input.cycleDays ?? 30,
        sortOrder: nextSortOrder,
      },
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'payroll_entry.updated',
        entityType: 'PayrollEntry',
        entityId: entryId,
        metadata: { workLineAdded: { id: line.id, unitId: line.unitId } },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return tx.payrollEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: {
        workLines: WORK_LINES_INCLUDE,
        employee: {
          select: {
            cnic: true,
            employeeCode: true,
            designation: true,
            bankId: true,
            branchCode: true,
            accountNumber: true,
            iban: true,
            grossPay: true,
            name: true,
            fatherName: true,
          },
        },
      },
    });
  });
  return withReleaseBlockReasons(withCalc(withLiveMasterData(updated)));
}

/** Fields on `UpdateWorkLineInput` that map 1:1 onto a Prisma update payload — the work-line
 * analogue of `mapUpdateInputToEntryData` above, extracted for the same reason: exported so the
 * Payroll Entry import path (Checkpoint 5) reuses this exact mapping for a row's primary-line
 * fields rather than redefining it. */
export function mapUpdateInputToWorkLineData(
  input: Omit<UpdateWorkLineInput, 'version'>,
): Prisma.PayrollEntryWorkLineUncheckedUpdateInput {
  return {
    ...(input.unitId !== undefined && { unitId: input.unitId }),
    ...(input.days !== undefined && { days: input.days }),
    ...(input.otHours !== undefined && { otHours: input.otHours }),
    ...(input.otRate !== undefined && { otRate: input.otRate }),
    ...(input.cycleDays !== undefined && { cycleDays: input.cycleDays }),
    ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
  };
}

export async function updateWorkLine(
  currentUser: SessionUser,
  workLineId: string,
  input: UpdateWorkLineInput,
  requestMeta: RequestMeta,
) {
  const line = await getWorkLineForMutation(workLineId);
  const entry = line.payrollEntry;
  assertSiteAccess(currentUser, entry.siteId);
  assertEntryEditable(entry);

  const nextUnitId = input.unitId ?? line.unitId;
  if (input.unitId !== undefined && input.unitId !== line.unitId) {
    await assertUnitBelongsToSite(nextUnitId, entry.siteId);
  }

  const data = mapUpdateInputToWorkLineData(input);
  const changes = diffFields(
    line as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  // Negative Payroll Recovery checkpoint (2026-07-27, performance fix) — see the doc comment on
  // `updatePayrollEntry`'s own identical restructuring: `withReleaseBlockReasons` must run after
  // this transaction commits, never inside it.
  const updated = await prisma.$transaction(async (tx) => {
    const guarded = await tx.payrollEntry.updateMany({
      where: { id: entry.id, version: input.version },
      data: { version: { increment: 1 } },
    });
    if (guarded.count === 0) {
      throw conflict('This payroll entry was changed by someone else — reload and try again');
    }

    await tx.payrollEntryWorkLine.update({ where: { id: workLineId }, data });

    if (Object.keys(changes).length > 0) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'payroll_entry.updated',
          entityType: 'PayrollEntry',
          entityId: entry.id,
          metadata: { workLineUpdated: { id: workLineId, changes } },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    return tx.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: {
        workLines: WORK_LINES_INCLUDE,
        employee: {
          select: {
            cnic: true,
            employeeCode: true,
            designation: true,
            bankId: true,
            branchCode: true,
            accountNumber: true,
            iban: true,
            grossPay: true,
            name: true,
            fatherName: true,
          },
        },
      },
    });
  });
  return withReleaseBlockReasons(withCalc(withLiveMasterData(updated)));
}

/**
 * Removes a `PayrollEntryWorkLine`, enforcing the one invariant this table can never violate: a
 * `PayrollEntry` must never be left with zero lines (§12a). Checked transactionally against a
 * fresh count, not the caller's possibly-stale view of how many lines exist.
 */
export async function deleteWorkLine(
  currentUser: SessionUser,
  workLineId: string,
  expectedVersion: number,
  requestMeta: RequestMeta,
) {
  const line = await getWorkLineForMutation(workLineId);
  const entry = line.payrollEntry;
  assertSiteAccess(currentUser, entry.siteId);
  assertEntryEditable(entry);

  // Negative Payroll Recovery checkpoint (2026-07-27, performance fix) — see the doc comment on
  // `updatePayrollEntry`'s own identical restructuring: `withReleaseBlockReasons` must run after
  // this transaction commits, never inside it.
  const updated = await prisma.$transaction(async (tx) => {
    const remaining = await tx.payrollEntryWorkLine.count({ where: { payrollEntryId: entry.id } });
    if (remaining <= 1) {
      throw badRequest('Cannot delete the last remaining work line — a payroll entry must always have at least one');
    }

    const guarded = await tx.payrollEntry.updateMany({
      where: { id: entry.id, version: expectedVersion },
      data: { version: { increment: 1 } },
    });
    if (guarded.count === 0) {
      throw conflict('This payroll entry was changed by someone else — reload and try again');
    }

    await tx.payrollEntryWorkLine.delete({ where: { id: workLineId } });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'payroll_entry.updated',
        entityType: 'PayrollEntry',
        entityId: entry.id,
        metadata: { workLineDeleted: { id: workLineId, unitId: line.unitId } },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return tx.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: {
        workLines: WORK_LINES_INCLUDE,
        employee: {
          select: {
            cnic: true,
            employeeCode: true,
            designation: true,
            bankId: true,
            branchCode: true,
            accountNumber: true,
            iban: true,
            grossPay: true,
            name: true,
            fatherName: true,
          },
        },
      },
    });
  });
  return withReleaseBlockReasons(withCalc(withLiveMasterData(updated)));
}

export interface BulkUpdatePayrollEntriesResult {
  matchedCount: number;
  appliedCount: number;
}

/**
 * Independent-review remediation (M2, Post-Checkpoint-1A UAT Stabilization) — the bulk-update audit
 * entry's own `metadata.value` already records the *new* value, but previously recorded no prior
 * state at all, for any field. A single flat "previous value" would be untruthful whenever the
 * matched population didn't already share one value (the common case for `eobiAmount` specifically,
 * since employees are onboarded at different times against whatever the statutory amount was then).
 * This stays a bounded *summary*, never one entry per affected row, so it costs nothing extra even
 * at a 10,000-row match — `kind: 'single'` when every editable row already agreed (the value itself,
 * verbatim, including a genuine `null` for an unset `leaveRate`/`otRate`); `kind: 'mixed'` otherwise,
 * with a distinct-value count plus the numeric min/max across whichever rows had a value at all (a
 * row that was `null` still counts toward `distinctCount`, just not toward min/max — there is no
 * numeric "minimum" a null value could contribute).
 */
type PreviousValuesSummary =
  | { kind: 'single'; value: string | number | null }
  | { kind: 'mixed'; distinctCount: number; minimum: number; maximum: number };

interface EntryForPreviousValue {
  leaveRate: Prisma.Decimal | null;
  eobiAmount: Prisma.Decimal;
  workLines: { cycleDays: number; otRate: Prisma.Decimal | null }[];
}

function extractPreviousFieldValue(
  entry: EntryForPreviousValue,
  field: BulkUpdatePayrollEntriesInput['field'],
): string | number | null {
  switch (field) {
    case 'leaveRate':
      return entry.leaveRate === null ? null : entry.leaveRate.toString();
    case 'eobiAmount':
      return entry.eobiAmount.toString();
    case 'cycleDays':
      return entry.workLines[0]!.cycleDays;
    case 'otRate':
      return entry.workLines[0]!.otRate === null ? null : entry.workLines[0]!.otRate.toString();
  }
}

/** Compares by numeric value (never by raw string), so e.g. a `Decimal` that happens to serialize as
 * `"400"` on one row and `"400.00"` on another is still correctly recognized as the same previous
 * value — a raw-string `Set` would silently over-report `distinctCount` for exactly that case. */
function summarizePreviousValues(rawValues: (string | number | null)[]): PreviousValuesSummary {
  const normalized = rawValues.map((v) => (v === null ? null : Number(v)));
  const distinct = new Set(normalized);
  if (distinct.size <= 1) {
    return { kind: 'single', value: rawValues[0] ?? null };
  }
  const numeric = normalized.filter((v): v is number => v !== null);
  return { kind: 'mixed', distinctCount: distinct.size, minimum: Math.min(...numeric), maximum: Math.max(...numeric) };
}

/**
 * "Copy to All" (Phase 3 Checkpoint 4) — pushes one value to every currently-filtered entry in one
 * request, following `database/schema-invariants.md` §23's standing rule ("bulk writes over
 * row-by-row loops... even though [the affected set] is typically small") rather than looping the
 * single-entity `updatePayrollEntry`/`updateWorkLine` mutations above. `leaveRate` (a `PayrollEntry`
 * column) is written directly; `otRate`/`cycleDays` (`PayrollEntryWorkLine` columns) are written
 * only to each matched entry's **primary** line (lowest `sortOrder`) — non-primary lines are
 * intentionally reachable only through the Split by {unitLabel} modal (Checkpoint 3), never through
 * this bulk action (frozen 2026-07-09 decision, `database/payroll-entry.md` §12a).
 *
 * **Deliberate exception to this module's otherwise-universal per-row optimistic locking**: unlike
 * every single-entity mutation above, this does not take or check a caller-supplied `version` per
 * row — it is a criteria-scoped administrative sweep (matching the same class of operation as the
 * `PayrollUnitRelease` sweep, `database/schema-invariants.md §23`), not a targeted edit of a row the
 * caller just read. Each affected entry's `version` is still incremented as part of the write, so
 * any row concurrently open elsewhere (e.g. a Split by {unitLabel} modal, or another operator's
 * in-flight autosave) correctly 409s on its own *next* save against the now-stale version it holds —
 * this bulk action never silently loses a genuinely concurrent single-row edit, it just doesn't
 * pre-check one on the way in.
 *
 * Writes exactly one summary `AuditLog` entry (no `entityId` — matches `employee.import`'s existing
 * bulk-audit precedent, `employees.routes.ts`), never one row per affected entry.
 *
 * **Editability (corrected 2026-07-14, Phase 5 Checkpoint 1 final review; extended 2026-07-15,
 * Phase 5 Checkpoint 4):** does not gate the whole operation on `cycle.status` up front — a cycle
 * leaving `DRAFT` for `RELEASED` (Finalize Cycle) never converts a held, unreleased entry into a
 * released one, so it must stay reachable by this bulk action exactly as any single-entity edit
 * would (`assertEntryEditable`, `database/payroll-entry.md §12`). Editability is enforced per row,
 * below, by filtering to `released = false` **and the cycle not being `ARCHIVED`** — the same two
 * conditions `assertEntryEditable` enforces for a single row, just applied across a matched set at
 * once. An `ARCHIVED` cycle therefore always applies to zero rows (every row is filtered out
 * together), reported via the ordinary `appliedCount: 0` outcome rather than a thrown error — the
 * same graceful-skip shape this bulk action already used for released rows, extended rather than
 * replaced with a new error path.
 */
export async function bulkUpdatePayrollEntries(
  currentUser: SessionUser,
  cycleId: string,
  input: BulkUpdatePayrollEntriesInput,
  requestMeta: RequestMeta,
): Promise<BulkUpdatePayrollEntriesResult> {
  const cycle = await getPayrollCycle(cycleId);

  for (const siteId of input.siteIds) {
    assertSiteAccess(currentUser, siteId);
  }

  let matchedCount = 0;
  let appliedCount = 0;

  // Independent-review remediation (Post-Checkpoint-1A UAT Stabilization) — the matching read now
  // runs *inside* the same transaction as the write and the audit insert (previously a separate,
  // pre-transaction `prisma.payrollEntry.findMany`), so the "previous value" the audit entry records
  // is genuinely the value each row held at the instant it was overwritten, not a value that could
  // have been changed by a concurrent request in the gap between an earlier, non-transactional read
  // and this write.
  await prisma.$transaction(async (tx) => {
    const matched = await tx.payrollEntry.findMany({
      where: { cycleId, siteId: { in: input.siteIds } },
      select: {
        id: true,
        released: true,
        payoutOutcome: true,
        leaveRate: true,
        eobiAmount: true,
        workLines: { orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true, cycleDays: true, otRate: true } },
      },
    });
    matchedCount = matched.length;

    // A released entry, or any entry at all once the cycle is Archived, is locked exactly like a
    // single-entity edit would reject it (`assertEntryEditable`) — skipped here rather than failing
    // the whole batch over it. Negative Payroll Recovery checkpoint (2026-07-26): an entry already
    // resolved as NO_PAY_DUE/RECOVERY_DUE is equally locked, even though `released` itself stays
    // `false` for it.
    const editable =
      cycle.status === 'ARCHIVED' ? [] : matched.filter((entry) => !entry.released && entry.payoutOutcome === null);

    // Zero-match/zero-applied behavior is unchanged: no write, no audit entry, no fabricated
    // previous-value summary.
    if (editable.length === 0) return;

    const previousValues = summarizePreviousValues(
      editable.map((entry) => extractPreviousFieldValue(entry, input.field)),
    );
    const entryIds = editable.map((entry) => entry.id);

    if (input.field === 'leaveRate') {
      const result = await tx.payrollEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { leaveRate: input.value, version: { increment: 1 } },
      });
      appliedCount = result.count;
    } else if (input.field === 'eobiAmount') {
      // Amount only — `eobiApplicable` is never touched by this field (see the schema's own doc
      // comment). Applies to every matched entry regardless of its own applicable toggle, so a
      // currently-disabled row still receives the updated statutory amount for later use.
      const result = await tx.payrollEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { eobiAmount: input.value, version: { increment: 1 } },
      });
      appliedCount = result.count;
    } else {
      // Guaranteed by the architecture — every PayrollEntry always has at least one WorkLine
      // (database/payroll-entry.md §12a) — so `workLines[0]` is always the primary line here.
      const primaryLineIds = editable.map((entry) => entry.workLines[0]!.id);
      await tx.payrollEntryWorkLine.updateMany({
        where: { id: { in: primaryLineIds } },
        data: input.field === 'cycleDays' ? { cycleDays: input.value } : { otRate: input.value },
      });
      const result = await tx.payrollEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { version: { increment: 1 } },
      });
      appliedCount = result.count;
    }

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'payroll_entry.bulk_updated',
        entityType: 'PayrollEntry',
        metadata: {
          cycleId,
          siteIds: input.siteIds,
          field: input.field,
          value: input.value,
          previousValues,
          matchedCount,
          appliedCount,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );
  });

  return { matchedCount, appliedCount };
}
