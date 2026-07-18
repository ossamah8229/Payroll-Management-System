import { Decimal } from 'decimal.js';
import type { SessionUser } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess } from '../employees/employees.service';
import { acquireBalanceAdjustmentLock } from './corrections.lock';
import { determineMaterialization } from './corrections.materialization';
import {
  MaterializationValidationError,
  type BatchMaterializationSummary,
  type MaterializationDecision,
  type MaterializationResult,
} from './corrections.materialization.types';
import {
  createMaterializationRow,
  getActiveReservedAmount,
  getBalanceAdjustmentById,
  getCurrentDraftCycle,
  getMaterializationForCycle,
  getPayrollEntryForEmployeeInCycle,
  listEntriesForCycle,
  listMaterializableAdjustments,
  listMaterializationsForEntry,
  lockPayrollCycleForUpdate,
  updatePayrollEntryCorrectionAggregates,
  type BalanceAdjustmentDetail,
} from './corrections.repository';

/**
 * Phase 6 Checkpoint 5 — Draft-cycle materialization orchestration: lock ordering, eligibility
 * coordination, and the archive-and-create-next Materialization Hook integration. Delegates every
 * eligibility/amount decision to the pure `corrections.materialization.ts` (unchanged by anything
 * here), every read/write to `corrections.repository.ts`, and reuses Checkpoint 4's
 * `acquireBalanceAdjustmentLock` unchanged — no new `BalanceAdjustment`-scoped lock invented.
 *
 * **Documented, deterministic lock order — always cycle, then adjustment, never the reverse:**
 * 1. `lockPayrollCycleForUpdate` (native Postgres `SELECT ... FOR UPDATE` on the target
 *    `PayrollCycle` row) — serializes against Finalize Cycle's own conditional `UPDATE`, with zero
 *    changes to Finalize's own code (see that function's own doc comment).
 * 2. `acquireBalanceAdjustmentLock` (Checkpoint 4's existing advisory lock) — serializes against
 *    every other materialization *and* settlement attempt for the same adjustment, regardless of
 *    which cycle.
 * Every call site in this file acquires them in this exact order, every time — the one rule that
 * makes cross-checkpoint deadlock impossible without needing a global lock registry.
 *
 * **Materialization never creates a `BalanceAdjustmentSettlement`, never touches
 * `BalanceAdjustment.remainingAmount`/`.status`.** It only ever inserts an `ACTIVE`
 * `BalanceAdjustmentMaterialization` row and recomputes the target `PayrollEntry`'s own aggregate
 * columns. The `ACTIVE -> CONSUMED` transition remains a later checkpoint's own event.
 */

async function recomputeAndPersistEntryAggregates(payrollEntryId: string, tx: PrismaTransactionClient): Promise<void> {
  const rows = await listMaterializationsForEntry(payrollEntryId, tx);
  let payable = new Decimal(0);
  let recovery = new Decimal(0);
  for (const row of rows) {
    if (row.balanceAdjustment.type === 'PAYABLE') {
      payable = payable.plus(row.amount.toString());
    } else if (row.balanceAdjustment.type === 'RECOVERY') {
      recovery = recovery.plus(row.amount.toString());
    }
  }
  await updatePayrollEntryCorrectionAggregates(
    payrollEntryId,
    { correctionBalancePayable: payable.toFixed(2), correctionBalanceRecovery: recovery.toFixed(2) },
    tx,
  );
}

/**
 * The one core per-adjustment materialization sequence, shared by every call site (manual single,
 * manual batch, and the automatic archive-and-create-next hook). Assumes the target `PayrollCycle`
 * has *already* been locked (step 1 of the documented lock order, above) by the caller — this
 * function performs only step 2 onward, so a batch caller locks the cycle exactly once for the
 * whole batch, not once per adjustment.
 */
async function materializeOneAdjustmentLocked(
  balanceAdjustmentId: string,
  targetCycleId: string,
  targetCycleStatus: string,
  employeeIdToEntryId: Map<string, string>,
  tx: PrismaTransactionClient,
  actorUserId: string | null,
  requestMeta: RequestMeta,
  triggeredBy: 'MANUAL' | 'AUTOMATIC',
): Promise<MaterializationResult> {
  await acquireBalanceAdjustmentLock(balanceAdjustmentId, tx);

  const adjustment = await getBalanceAdjustmentById(balanceAdjustmentId, tx);
  if (!adjustment) {
    return { balanceAdjustmentId, outcome: 'SKIPPED', reason: 'EMPLOYEE_NOT_ELIGIBLE' };
  }

  const [existingMaterialization, activeReservedAmount] = await Promise.all([
    getMaterializationForCycle(balanceAdjustmentId, targetCycleId, tx),
    getActiveReservedAmount(balanceAdjustmentId, tx),
  ]);

  const targetEntryId = employeeIdToEntryId.get(adjustment.employeeId);

  const decision: MaterializationDecision = determineMaterialization({
    adjustmentType: adjustment.type,
    adjustmentStatus: adjustment.status,
    paymentTiming: adjustment.paymentTiming,
    remainingAmount: adjustment.remainingAmount.toString(),
    activeReservedAmount,
    recoveryInstallmentAmount: adjustment.recoveryInstallmentAmount?.toString() ?? null,
    employeeDeparted: adjustment.employee.dateOfLeaving !== null,
    targetCycleStatus: targetCycleStatus as 'DRAFT' | 'RELEASED' | 'ARCHIVED',
    alreadyMaterializedForTargetCycle: existingMaterialization !== null,
    targetEntryExists: targetEntryId !== undefined,
  });

  if (!decision.eligible) {
    return { balanceAdjustmentId, outcome: 'SKIPPED', reason: decision.reason };
  }

  const materialization = await createMaterializationRow(
    {
      balanceAdjustmentId,
      payrollEntryId: targetEntryId!,
      cycleId: targetCycleId,
      amount: decision.amount,
    },
    tx,
  );

  await recomputeAndPersistEntryAggregates(targetEntryId!, tx);

  await recordAuditLog(
    {
      actorUserId,
      action: 'balance_adjustment.materialized',
      entityType: 'BalanceAdjustment',
      entityId: balanceAdjustmentId,
      metadata: {
        correctionId: adjustment.correctionId,
        employeeId: adjustment.employeeId,
        targetCycleId,
        adjustmentType: adjustment.type,
        materializedAmount: decision.amount,
        remainingAmountAtMaterialization: adjustment.remainingAmount.toString(),
        materializationId: materialization.id,
        triggeredBy,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    },
    tx,
  );

  return { balanceAdjustmentId, outcome: 'MATERIALIZED', amount: decision.amount, materializationId: materialization.id };
}

// --- Manual, HTTP-triggered materialization -------------------------------------------------

export async function previewMaterialization(
  currentUser: SessionUser,
  balanceAdjustmentId: string,
  targetCycleId?: string,
): Promise<MaterializationDecision> {
  const adjustment = await getBalanceAdjustmentById(balanceAdjustmentId);
  if (!adjustment) {
    throw new MaterializationValidationError({
      code: 'BALANCE_ADJUSTMENT_NOT_FOUND',
      message: `BalanceAdjustment "${balanceAdjustmentId}" does not exist.`,
    });
  }
  assertSiteAccess(currentUser, adjustment.employee.siteId);

  const targetCycle = targetCycleId ? await prisma.payrollCycle.findUnique({ where: { id: targetCycleId } }) : await getCurrentDraftCycle();
  if (!targetCycle) {
    throw new MaterializationValidationError({ code: 'NO_CURRENT_DRAFT', message: 'No current Draft payroll cycle exists.' });
  }

  const [existingMaterialization, activeReservedAmount, targetEntry] = await Promise.all([
    getMaterializationForCycle(balanceAdjustmentId, targetCycle.id),
    getActiveReservedAmount(balanceAdjustmentId),
    getPayrollEntryForEmployeeInCycle(adjustment.employeeId, targetCycle.id),
  ]);

  return determineMaterialization({
    adjustmentType: adjustment.type,
    adjustmentStatus: adjustment.status,
    paymentTiming: adjustment.paymentTiming,
    remainingAmount: adjustment.remainingAmount.toString(),
    activeReservedAmount,
    recoveryInstallmentAmount: adjustment.recoveryInstallmentAmount?.toString() ?? null,
    employeeDeparted: adjustment.employee.dateOfLeaving !== null,
    targetCycleStatus: targetCycle.status as 'DRAFT' | 'RELEASED' | 'ARCHIVED',
    alreadyMaterializedForTargetCycle: existingMaterialization !== null,
    targetEntryExists: targetEntry !== null,
  });
}

export async function materializeBalanceAdjustment(
  currentUser: SessionUser,
  balanceAdjustmentId: string,
  targetCycleId: string | undefined,
  requestMeta: RequestMeta,
): Promise<MaterializationResult> {
  const preLock = await getBalanceAdjustmentById(balanceAdjustmentId);
  if (!preLock) {
    throw new MaterializationValidationError({
      code: 'BALANCE_ADJUSTMENT_NOT_FOUND',
      message: `BalanceAdjustment "${balanceAdjustmentId}" does not exist.`,
    });
  }
  assertSiteAccess(currentUser, preLock.employee.siteId);

  return prisma.$transaction(async (tx) => {
    const resolvedTargetCycleId = targetCycleId ?? (await getCurrentDraftCycle(tx))?.id;
    if (!resolvedTargetCycleId) {
      throw new MaterializationValidationError({ code: 'NO_CURRENT_DRAFT', message: 'No current Draft payroll cycle exists.' });
    }

    const lockedCycle = await lockPayrollCycleForUpdate(resolvedTargetCycleId, tx);
    if (!lockedCycle) {
      throw new MaterializationValidationError({ code: 'NO_CURRENT_DRAFT', message: `PayrollCycle "${resolvedTargetCycleId}" does not exist.` });
    }

    const entries = await listEntriesForCycle(resolvedTargetCycleId, tx);
    const employeeIdToEntryId = new Map(entries.map((e) => [e.employeeId, e.id]));

    return materializeOneAdjustmentLocked(
      balanceAdjustmentId,
      lockedCycle.id,
      lockedCycle.status,
      employeeIdToEntryId,
      tx,
      currentUser.id,
      requestMeta,
      'MANUAL',
    );
  });
}

/** Materializes every eligible adjustment for every employee who has a `PayrollEntry` in the
 * target Draft cycle. Each adjustment gets its own independent transaction (partial-success
 * semantics — one failure does not roll back the rest of the batch), but the target cycle's `FOR
 * UPDATE` lock is (re-)acquired fresh for each one, matching the documented lock order exactly. */
export async function materializeEligibleAdjustmentsForCycle(
  currentUser: SessionUser,
  targetCycleId: string | undefined,
  requestMeta: RequestMeta,
): Promise<BatchMaterializationSummary> {
  const resolvedTargetCycleId = targetCycleId ?? (await getCurrentDraftCycle())?.id;
  if (!resolvedTargetCycleId) {
    throw new MaterializationValidationError({ code: 'NO_CURRENT_DRAFT', message: 'No current Draft payroll cycle exists.' });
  }

  const entries = await listEntriesForCycle(resolvedTargetCycleId);
  const employeeIdToEntryId = new Map(entries.map((e) => [e.employeeId, e.id]));
  const employeeIds = [...employeeIdToEntryId.keys()];

  const candidates = await listMaterializableAdjustments(employeeIds);
  for (const candidate of candidates) {
    assertSiteAccess(currentUser, candidate.employee.siteId);
  }

  const results: MaterializationResult[] = [];
  for (const candidate of candidates) {
    const result = await prisma.$transaction(async (tx) => {
      const lockedCycle = await lockPayrollCycleForUpdate(resolvedTargetCycleId, tx);
      if (!lockedCycle) {
        return { balanceAdjustmentId: candidate.id, outcome: 'SKIPPED' as const, reason: 'TARGET_NOT_DRAFT' as const };
      }
      return materializeOneAdjustmentLocked(
        candidate.id,
        lockedCycle.id,
        lockedCycle.status,
        employeeIdToEntryId,
        tx,
        currentUser.id,
        requestMeta,
        'MANUAL',
      );
    });
    results.push(result);
  }

  return {
    cycleId: resolvedTargetCycleId,
    materializedCount: results.filter((r) => r.outcome === 'MATERIALIZED').length,
    skippedCount: results.filter((r) => r.outcome === 'SKIPPED').length,
    results,
  };
}

// --- Automatic Materialization Hook (archive-and-create-next) ------------------------------------

export interface MaterializeCorrectionObligationsParams {
  cycleId: string;
  employeeIdToEntryId: Map<string, string>;
  actorUserId: string;
  requestMeta: RequestMeta;
}

/**
 * The correction-obligation Materialization Hook — same extensibility seam Advances already uses
 * (`materializeScheduledAdvanceDeductions`, `payroll-processing.service.ts`'s
 * `archiveAndCreateNextPayrollCycle`). Called *after* the new Draft cycle's entries all exist,
 * inside that same already-open transaction (`tx`) — never opens its own. The target cycle is the
 * brand-new Draft just created within this same transaction, so `lockPayrollCycleForUpdate` here is
 * a harmless no-op (nothing else can possibly be contending for a row not yet visible outside this
 * transaction) — called anyway, for one uniform code path with the manual routes above.
 */
export async function materializeCorrectionObligationsForNewCycle(
  params: MaterializeCorrectionObligationsParams,
  tx: PrismaTransactionClient,
): Promise<number> {
  const lockedCycle = await lockPayrollCycleForUpdate(params.cycleId, tx);
  if (!lockedCycle) {
    return 0;
  }

  const employeeIds = [...params.employeeIdToEntryId.keys()];
  const candidates = await listMaterializableAdjustments(employeeIds, tx);

  let materializedCount = 0;
  for (const candidate of candidates) {
    const result = await materializeOneAdjustmentLocked(
      candidate.id,
      lockedCycle.id,
      lockedCycle.status,
      params.employeeIdToEntryId,
      tx,
      params.actorUserId,
      params.requestMeta,
      'AUTOMATIC',
    );
    if (result.outcome === 'MATERIALIZED') {
      materializedCount += 1;
    }
  }

  return materializedCount;
}

// --- Reads -----------------------------------------------------------------------------------

export async function getBalanceAdjustmentMaterializations(currentUser: SessionUser, balanceAdjustmentId: string) {
  const adjustment: BalanceAdjustmentDetail | null = await getBalanceAdjustmentById(balanceAdjustmentId);
  if (!adjustment) {
    throw new MaterializationValidationError({
      code: 'BALANCE_ADJUSTMENT_NOT_FOUND',
      message: `BalanceAdjustment "${balanceAdjustmentId}" does not exist.`,
    });
  }
  assertSiteAccess(currentUser, adjustment.employee.siteId);
  return prisma.balanceAdjustmentMaterialization.findMany({
    where: { balanceAdjustmentId },
    orderBy: { createdAt: 'desc' },
    include: { cycle: { select: { id: true, year: true, month: true } } },
  });
}
