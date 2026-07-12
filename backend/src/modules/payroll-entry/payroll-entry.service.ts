import type { Prisma, PayrollEntry, PayrollEntryWorkLine } from '@prisma/client';
import type {
  AddWorkLineInput,
  BulkUpdatePayrollEntriesInput,
  CreatePayrollEntryInput,
  SessionUser,
  UpdatePayrollEntryInput,
  UpdateWorkLineInput,
} from '@payroll/shared';
import { calcNet, type CalcNetResult, type PayrollEntryCalcInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import { diffFields } from '../../common/audit-diff';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess, assertUnitBelongsToSite, isMasterAdmin } from '../employees/employees.service';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

type EntryWithWorkLines = PayrollEntry & { workLines: PayrollEntryWorkLine[] };

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

function withCalc(entry: EntryWithWorkLines) {
  return { ...entry, calc: computeEntryCalc(entry) };
}

/**
 * A `PayrollEntry` is mutable only while `released = false` AND its parent cycle is still `DRAFT`
 * (docs/architecture/database/payroll-entry.md §12) — `hold` has no bearing on this. There is
 * deliberately no route in this checkpoint that can ever set `released = true` (Release is Phase
 * 4), so in practice this guard only ever trips on a non-`DRAFT` cycle today; it is still written
 * against the full, general rule so it needs no revisiting once Release exists.
 */
export function assertEntryEditable(entry: { released: boolean; cycle: { status: string } }): void {
  if (entry.released || entry.cycle.status !== 'DRAFT') {
    throw badRequest(
      'This payroll entry is locked and can no longer be edited directly — released payroll is immutable (Principle 9)',
    );
  }
}

async function getEntryForMutation(id: string) {
  const entry = await prisma.payrollEntry.findUnique({
    where: { id },
    include: { cycle: true, workLines: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!entry) {
    throw notFound('Payroll entry not found');
  }
  return entry;
}

async function getWorkLineForMutation(workLineId: string) {
  const line = await prisma.payrollEntryWorkLine.findUnique({
    where: { id: workLineId },
    include: { payrollEntry: { include: { cycle: true, workLines: { orderBy: { sortOrder: 'asc' } } } } },
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
        workLines: { orderBy: { sortOrder: 'asc' } },
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
    entries: entries.map((entry) => withCalc(entry)),
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
      workLines: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!entry) {
    throw notFound('Payroll entry not found');
  }
  assertSiteAccess(currentUser, entry.siteId);
  return withCalc(entry);
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
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
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

  return withCalc(entry);
}

/** Fields on `UpdatePayrollEntryInput` that map 1:1 onto a Prisma update payload. `version` is
 * handled separately (the optimistic-locking guard), never written as an ordinary field. Exported
 * so the Payroll Entry import path (Checkpoint 5) reuses this exact mapping rather than
 * redefining it — one implementation of "which fields does an ordinary entry edit touch." */
export function mapUpdateInputToEntryData(
  input: Omit<UpdatePayrollEntryInput, 'version'>,
): Prisma.PayrollEntryUncheckedUpdateInput {
  return {
    ...(input.designation !== undefined && { designation: input.designation }),
    ...(input.bankId !== undefined && { bankId: input.bankId }),
    ...(input.branchCode !== undefined && { branchCode: input.branchCode }),
    ...(input.accountNumber !== undefined && { accountNumber: input.accountNumber }),
    ...(input.iban !== undefined && { iban: input.iban }),
    ...(input.grossPay !== undefined && { grossPay: input.grossPay }),
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

  const { version, ...fields } = input;
  const data = mapUpdateInputToEntryData(fields);
  // Banking rule (2026-07-11 refinement): clearing the bank on this request also clears Account
  // Number/IBAN — a cash entry never carries stale bank details. Deliberately *not* the mirror
  // "bank set ⇒ Account Number required" hard rejection `employees.service.ts` applies: this grid
  // autosaves one field at a time (docs/architecture/database/payroll-entry.md §12's Draft-editable
  // convention), so a user who has just picked a bank and hasn't typed the account number yet must
  // not have that in-progress edit rejected — the same tolerance `InlineNumberCell`'s `invalid` prop
  // already gives every other field here.
  if (data.bankId === null) {
    data.accountNumber = null;
    data.iban = null;
  }
  const changes = diffFields(
    existing as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  return prisma.$transaction(async (tx) => {
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

    const updated = await tx.payrollEntry.findUniqueOrThrow({
      where: { id },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    return withCalc(updated);
  });
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

  return prisma.$transaction(async (tx) => {
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

    const updated = await tx.payrollEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    return withCalc(updated);
  });
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

  return prisma.$transaction(async (tx) => {
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

    const updated = await tx.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    return withCalc(updated);
  });
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

  return prisma.$transaction(async (tx) => {
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

    const updated = await tx.payrollEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { workLines: { orderBy: { sortOrder: 'asc' } } },
    });
    return withCalc(updated);
  });
}

export interface BulkUpdatePayrollEntriesResult {
  matchedCount: number;
  appliedCount: number;
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
 */
export async function bulkUpdatePayrollEntries(
  currentUser: SessionUser,
  cycleId: string,
  input: BulkUpdatePayrollEntriesInput,
  requestMeta: RequestMeta,
): Promise<BulkUpdatePayrollEntriesResult> {
  const cycle = await getPayrollCycle(cycleId);
  if (cycle.status !== 'DRAFT') {
    throw badRequest('Cannot bulk-edit payroll entries in a cycle that is not in Draft');
  }

  for (const siteId of input.siteIds) {
    assertSiteAccess(currentUser, siteId);
  }

  const matched = await prisma.payrollEntry.findMany({
    where: { cycleId, siteId: { in: input.siteIds } },
    select: {
      id: true,
      released: true,
      workLines: { orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true } },
    },
  });
  // A released entry is locked exactly like a single-entity edit would reject it
  // (`assertEntryEditable`) — skipped here rather than failing the whole batch over it.
  const editable = matched.filter((entry) => !entry.released);

  let appliedCount = 0;

  if (editable.length > 0) {
    const entryIds = editable.map((entry) => entry.id);

    await prisma.$transaction(async (tx) => {
      if (input.field === 'leaveRate') {
        const result = await tx.payrollEntry.updateMany({
          where: { id: { in: entryIds } },
          data: { leaveRate: input.value, version: { increment: 1 } },
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
            matchedCount: matched.length,
            appliedCount,
          },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    });
  }

  return { matchedCount: matched.length, appliedCount };
}
