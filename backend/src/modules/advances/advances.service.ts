import { Prisma } from '@prisma/client';
import type {
  CreateAdvanceInput,
  DeferAdvanceScheduleInput,
  ListAdvancesQuery,
  SessionUser,
  UpdateAdvanceInput,
} from '@payroll/shared';
import { isoDateToUtcDate } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import { diffFields } from '../../common/audit-diff';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess, isMasterAdmin } from '../employees/employees.service';
import { assertEntryEditable } from '../payroll-entry/payroll-entry.service';
import { findOrCreateScheduledPayrollPeriod } from '../payroll-processing/payroll-processing.service';

/**
 * Advances (Phase 4 Checkpoint 5, docs/architecture/database/advances.md §15/§15a). Tracks a
 * `LOAN`/`EID_ADVANCE` given to an employee and its remaining balance; deducted against a specific
 * cycle's `PayrollEntry` (linked via `advanceId`/`eidAdvanceId`, never re-inferred later).
 *
 * **Approved architecture decisions, frozen for this checkpoint:**
 * - At most one `ACTIVE` Advance per employee per type (`Advance_employeeId_type_active_key`,
 *   the partial unique index in the migration) — enforced here as a fast, clean pre-check, with the
 *   database index as the concurrency backstop (translated to a clean 409 by the global error
 *   handler's existing P2002 handling, same precedent as Salary Release's double-release guard).
 * - No generic Outstanding-Payroll-Obligation provider/hook registry — `payroll-processing.service.ts`
 *   calls `materializeScheduledAdvanceDeductions` below directly.
 * - Cash Advances, Advance-only Bank Sheets, and Company Bank Account management are out of scope.
 * - Payroll Entry CSV/Excel import/export is unchanged — no automatic Advance linking during import.
 * - No new permission — every export below is gated by the existing `ADVANCES_MANAGE` (Payroll
 *   Staff, site-scoped, and Master Admin only; Finance holds no Advances permission).
 */

const advanceWithEmployeeInclude = { employee: true } as const;

type AdvanceWithEmployee = Prisma.AdvanceGetPayload<{ include: typeof advanceWithEmployeeInclude }>;

async function getAdvanceOrThrow(id: string, client: PrismaTransactionClient = prisma): Promise<AdvanceWithEmployee> {
  const advance = await client.advance.findUnique({ where: { id }, include: advanceWithEmployeeInclude });
  if (!advance) {
    throw notFound('Advance not found');
  }
  return advance;
}

export async function listAdvances(currentUser: SessionUser, filters: ListAdvancesQuery) {
  if (filters.siteId) {
    assertSiteAccess(currentUser, filters.siteId);
  }

  const siteIdFilter = filters.siteId
    ? [filters.siteId]
    : !isMasterAdmin(currentUser)
      ? currentUser.siteIds
      : undefined;

  const where: Prisma.AdvanceWhereInput = {
    ...(filters.employeeId && { employeeId: filters.employeeId }),
    ...(filters.type && { type: filters.type }),
    ...(filters.status && { status: filters.status }),
    ...(siteIdFilter && { employee: { siteId: { in: siteIdFilter } } }),
  };

  return prisma.advance.findMany({
    where,
    include: { employee: true, originalScheduledPeriod: true, currentScheduledPeriod: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getAdvance(currentUser: SessionUser, id: string) {
  const advance = await prisma.advance.findUnique({
    where: { id },
    include: {
      employee: true,
      originalScheduledPeriod: true,
      currentScheduledPeriod: true,
      scheduleChanges: { orderBy: { changedAt: 'desc' }, include: { fromPeriod: true, toPeriod: true, changedBy: true } },
    },
  });
  if (!advance) {
    throw notFound('Advance not found');
  }
  assertSiteAccess(currentUser, advance.employee.siteId);
  return advance;
}

/**
 * Records a new Advance. `originalPeriod` resolves (find-or-create, never a direct write — see
 * `findOrCreateScheduledPayrollPeriod`) into the `ScheduledPayrollPeriod` both
 * `originalScheduledPeriodId` (immutable forever after, BR-ADV-001) and `currentScheduledPeriodId`
 * (the live pointer) are set to.
 */
export async function createAdvance(
  currentUser: SessionUser,
  input: CreateAdvanceInput,
  requestMeta: RequestMeta,
) {
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) {
    throw notFound('Employee not found');
  }
  assertSiteAccess(currentUser, employee.siteId);

  const existingActive = await prisma.advance.findFirst({
    where: { employeeId: input.employeeId, type: input.type, status: 'ACTIVE' },
  });
  if (existingActive) {
    throw conflict(
      `This employee already has an ACTIVE ${input.type === 'LOAN' ? 'Advance' : 'Eid Advance'} — it must be fully paid off before a new one can be recorded`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const period = await findOrCreateScheduledPayrollPeriod(
      input.originalPeriod.year,
      input.originalPeriod.month,
      tx,
    );

    const advance = await tx.advance.create({
      data: {
        employeeId: input.employeeId,
        type: input.type,
        totalAmount: input.totalAmount,
        outstandingBalance: input.totalAmount,
        dateGiven: isoDateToUtcDate(input.dateGiven)!,
        repaymentType: input.repaymentType,
        scheduledInstallmentAmount: input.scheduledInstallmentAmount ?? null,
        notes: input.notes ?? null,
        status: 'ACTIVE',
        originalScheduledPeriodId: period.id,
        currentScheduledPeriodId: period.id,
      },
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'advance.created',
        entityType: 'Advance',
        entityId: advance.id,
        metadata: {
          employeeId: input.employeeId,
          type: input.type,
          totalAmount: input.totalAmount,
          repaymentType: input.repaymentType,
          originalPeriod: input.originalPeriod,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return advance;
  });
}

/** Ordinary field edit — deliberately narrow (see `updateAdvanceSchema`'s own doc comment).
 * `totalAmount`/`outstandingBalance`/`type`/`status`/scheduled-period fields never move through
 * this path; they only ever change via the system actions that own them. */
export async function updateAdvance(
  currentUser: SessionUser,
  id: string,
  input: UpdateAdvanceInput,
  requestMeta: RequestMeta,
) {
  const advance = await getAdvanceOrThrow(id);
  assertSiteAccess(currentUser, advance.employee.siteId);

  const data: Prisma.AdvanceUncheckedUpdateInput = {
    ...(input.repaymentType !== undefined && { repaymentType: input.repaymentType }),
    ...(input.scheduledInstallmentAmount !== undefined && {
      scheduledInstallmentAmount: input.scheduledInstallmentAmount,
    }),
    ...(input.notes !== undefined && { notes: input.notes }),
  };

  const changes = diffFields(advance as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.advance.update({ where: { id }, data });

    if (Object.keys(changes).length > 0) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'advance.updated',
          entityType: 'Advance',
          entityId: id,
          metadata: { changes },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    return updated;
  });
}

/**
 * Defers an Advance's currently-materialized deduction to a future Draft-eligible payroll period
 * (BR-ADV-002–006). Deliberately only ever operates on a deduction that has already materialized
 * into a real, still-Draft `PayrollEntry` — there is no "reschedule before it ever lands" action
 * (a genuinely simpler design than a pre-materialization reschedule path would be, and it matches
 * `AdvanceScheduleChange.payrollEntryId` being mandatory in the frozen schema).
 */
export async function deferAdvanceSchedule(
  currentUser: SessionUser,
  advanceId: string,
  input: DeferAdvanceScheduleInput,
  requestMeta: RequestMeta,
) {
  const advance = await getAdvanceOrThrow(advanceId);
  assertSiteAccess(currentUser, advance.employee.siteId);

  const entry = await prisma.payrollEntry.findUnique({
    where: { id: input.payrollEntryId },
    include: { cycle: true },
  });
  if (!entry) {
    throw notFound('Payroll entry not found');
  }
  assertSiteAccess(currentUser, entry.siteId);
  assertEntryEditable(entry);

  const isLoan = advance.type === 'LOAN';
  const linkedId = isLoan ? entry.advanceId : entry.eidAdvanceId;
  if (linkedId !== advance.id) {
    throw badRequest("This payroll entry is not currently carrying this advance's deduction");
  }

  // The exact amount THIS entry deducted — reversed back onto the balance below. Deliberately not
  // read from `advance.currentScheduledPeriodId`/`.status`: a `FULL_DEDUCTION` advance is marked
  // `PAID_OFF` the instant its deduction materializes, but the entry hasn't released yet, so
  // nothing about that is final — deferral must still be able to undo it (BR-ADV-002 applies to
  // "the deduction," not only to advances that happen to still read as `ACTIVE`).
  const deductedAmount = isLoan ? entry.advanceDeduction : entry.eidAdvanceDeduction;
  if (deductedAmount.lessThanOrEqualTo(0)) {
    throw badRequest('This payroll entry has no advance deduction to defer');
  }

  const targetKey = input.toPeriod.year * 12 + input.toPeriod.month;
  const currentCycleKey = entry.cycle.year * 12 + entry.cycle.month;
  if (targetKey <= currentCycleKey) {
    throw badRequest('An advance deduction may only be deferred to a future payroll period');
  }

  const conflictingCycle = await prisma.payrollCycle.findUnique({
    where: { year_month: { year: input.toPeriod.year, month: input.toPeriod.month } },
  });
  if (conflictingCycle && conflictingCycle.status !== 'DRAFT') {
    throw badRequest('This target period has already been released or archived and can no longer accept a deferred deduction');
  }

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw badRequest('A reason is required');
  }

  return prisma.$transaction(async (tx) => {
    // The "from" period is this entry's own cycle — where the deduction actually was — never
    // `advance.currentScheduledPeriodId`, which may have already auto-advanced past it (the
    // ordinary INSTALLMENT case) or been cleared to null (the FULL_DEDUCTION PAID_OFF case).
    const fromPeriod = await findOrCreateScheduledPayrollPeriod(entry.cycle.year, entry.cycle.month, tx);
    const toPeriod = await findOrCreateScheduledPayrollPeriod(input.toPeriod.year, input.toPeriod.month, tx);

    const guarded = await tx.payrollEntry.updateMany({
      where: { id: entry.id, version: entry.version },
      data: isLoan
        ? { advanceDeduction: '0', advanceId: null, version: { increment: 1 } }
        : { eidAdvanceDeduction: '0', eidAdvanceId: null, version: { increment: 1 } },
    });
    if (guarded.count === 0) {
      throw conflict('This payroll entry was changed by someone else — reload and try again');
    }

    const restoredBalance = advance.outstandingBalance.plus(deductedAmount);

    const updatedAdvance = await tx.advance.update({
      where: { id: advanceId },
      data: {
        outstandingBalance: restoredBalance,
        status: 'ACTIVE',
        currentScheduledPeriodId: toPeriod.id,
        paidOffAt: null,
      },
    });

    await tx.advanceScheduleChange.create({
      data: {
        advanceId,
        payrollEntryId: entry.id,
        fromPeriodId: fromPeriod.id,
        toPeriodId: toPeriod.id,
        reason,
        changedById: currentUser.id,
      },
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'advance.deferred',
        entityType: 'Advance',
        entityId: advanceId,
        metadata: {
          payrollEntryId: entry.id,
          fromPeriod: { year: entry.cycle.year, month: entry.cycle.month },
          toPeriod: input.toPeriod,
          amountRestored: deductedAmount.toFixed(2),
          reason,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'payroll_entry.advance_deferred',
        entityType: 'PayrollEntry',
        entityId: entry.id,
        metadata: { advanceId, toPeriod: input.toPeriod, reason },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return updatedAdvance;
  });
}

export interface MaterializeScheduledAdvanceDeductionsParams {
  cycleId: string;
  /** The `(year, month)` the resolved period itself names — the caller already knows this (it's
   * the new cycle's own year/month), so this function never needs to re-fetch the period row just
   * to compute "the following month" for advancing a not-yet-paid-off advance's pointer. */
  cycleYear: number;
  cycleMonth: number;
  resolvedPeriodId: string;
  employeeIdToEntryId: Map<string, string>;
  actorUserId: string;
  requestMeta: RequestMeta;
}

/**
 * The Advances half of the new-cycle bootstrap integration (Phase 4 Checkpoint 5) — called
 * directly from `payroll-processing.service.ts`'s `createPayrollCycle` and
 * `archiveAndCreateNextPayrollCycle` (Phase 5 Checkpoint 3), never a generic registry (approved
 * architecture decision). Runs inside the caller's own transaction. Returns the number of advances
 * actually materialized (excludes any `continue`d below) — Checkpoint 3's rollover audit
 * (`payroll_cycle.rollover_completed`) reports this count directly rather than re-deriving it.
 *
 * For every `ACTIVE` Advance whose `currentScheduledPeriodId` resolves to this cycle: `FULL_DEDUCTION`
 * deducts the entire `outstandingBalance` in one shot; `INSTALLMENT` deducts
 * `min(scheduledInstallmentAmount, outstandingBalance)` **only if** a `scheduledInstallmentAmount`
 * has been set — an `INSTALLMENT` advance with no standing schedule yet is deliberately left
 * unmaterialized (no value is ever computed by the system).
 *
 * **Departed employees (Phase 5 Checkpoint 3, closes this doc comment's own former gap):** a
 * departed employee whose scheduled period arrives now DOES have a new entry — rollover's own
 * bootstrap (`payroll-processing.service.ts`) includes every departed employee with an `ACTIVE`
 * Advance due this exact period, specifically so this function can reach them. `employeeIdToEntryId`
 * lacking an employee is therefore only expected via `createPayrollCycle`'s first-cycle-only path
 * (which by definition has no prior cycle for anyone to have departed from) or as a defensive
 * fallback should a future caller ever build the map incompletely.
 */
export async function materializeScheduledAdvanceDeductions(
  params: MaterializeScheduledAdvanceDeductionsParams,
  tx: PrismaTransactionClient,
): Promise<number> {
  const { cycleId, cycleYear, cycleMonth, resolvedPeriodId, employeeIdToEntryId, actorUserId, requestMeta } = params;

  const dueAdvances = await tx.advance.findMany({
    where: { status: 'ACTIVE', currentScheduledPeriodId: resolvedPeriodId },
  });

  let materializedCount = 0;

  for (const advance of dueAdvances) {
    const entryId = employeeIdToEntryId.get(advance.employeeId);
    if (!entryId) {
      // Phase 5 Checkpoint 3 closed the ordinary version of this gap — a departed employee with a
      // scheduled deduction due this period is now included in the new cycle's own bootstrap
      // (`payroll-processing.service.ts`'s `archiveAndCreateNextPayrollCycle`), so `entryId` is
      // normally found. This branch remains reachable only via `createPayrollCycle`'s own
      // first-cycle-only path (never a departed employee, by definition — there is no prior cycle
      // to have departed from) and as a defensive fallback if `employeeIdToEntryId` is ever built
      // incompletely by a future caller.
      continue;
    }

    let amount: Prisma.Decimal;
    if (advance.repaymentType === 'FULL_DEDUCTION') {
      amount = advance.outstandingBalance;
    } else {
      if (!advance.scheduledInstallmentAmount || advance.scheduledInstallmentAmount.lessThanOrEqualTo(0)) {
        continue; // No standing schedule set yet — nothing to auto-apply.
      }
      amount = Prisma.Decimal.min(advance.scheduledInstallmentAmount, advance.outstandingBalance);
    }

    const newOutstanding = advance.outstandingBalance.minus(amount);
    const isPaidOff = newOutstanding.lessThanOrEqualTo(0);

    await tx.payrollEntry.update({
      where: { id: entryId },
      data:
        advance.type === 'LOAN'
          ? { advanceDeduction: amount, advanceId: advance.id, version: { increment: 1 } }
          : { eidAdvanceDeduction: amount, eidAdvanceId: advance.id, version: { increment: 1 } },
    });

    let nextPeriodId: string | null = null;
    if (!isPaidOff) {
      // Advances automatically to the calendar month immediately following this cycle, as the new
      // default target — the ordinary, no-deferral-involved case (docs/architecture/database/
      // advances.md §15).
      const nextYear = cycleMonth === 12 ? cycleYear + 1 : cycleYear;
      const nextMonthNum = cycleMonth === 12 ? 1 : cycleMonth + 1;
      const next = await findOrCreateScheduledPayrollPeriod(nextYear, nextMonthNum, tx);
      nextPeriodId = next.id;
    }

    await tx.advance.update({
      where: { id: advance.id },
      data: {
        outstandingBalance: isPaidOff ? new Prisma.Decimal(0) : newOutstanding,
        status: isPaidOff ? 'PAID_OFF' : 'ACTIVE',
        currentScheduledPeriodId: isPaidOff ? null : nextPeriodId,
        paidOffAt: isPaidOff ? new Date() : null,
      },
    });

    await recordAuditLog(
      {
        actorUserId,
        action: 'advance.schedule_materialized',
        entityType: 'Advance',
        entityId: advance.id,
        metadata: {
          cycleId,
          payrollEntryId: entryId,
          amount: amount.toFixed(2),
          outstandingBalanceBefore: advance.outstandingBalance.toFixed(2),
          outstandingBalanceAfter: newOutstanding.lessThanOrEqualTo(0) ? '0.00' : newOutstanding.toFixed(2),
          status: isPaidOff ? 'PAID_OFF' : 'ACTIVE',
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    materializedCount += 1;
  }

  return materializedCount;
}
