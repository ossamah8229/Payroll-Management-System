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
import { calculateSettlement } from './corrections.settlement';
import { SettlementValidationError } from './corrections.settlement.types';
import {
  consumeMaterializationRow,
  createBalanceAdjustmentSettlementRow,
  createMaterializationRow,
  getActiveReservedAmount,
  getBalanceAdjustmentById,
  getCurrentDraftCycle,
  getMaterializationForCycle,
  getPayrollEntryForEmployeeInCycle,
  listActiveMaterializationsForEntries,
  listEntriesForCycle,
  listMaterializableAdjustments,
  listMaterializationsForEntry,
  lockPayrollCycleForUpdate,
  updateBalanceAdjustmentAfterSettlement,
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
 * columns.
 *
 * **Phase 6 Checkpoint 7 — the `ACTIVE -> CONSUMED` transition, below
 * (`consumeMaterializationsForReleasedEntries`).** Deferred by every checkpoint through 6A as "a
 * later checkpoint's own event" — this is that checkpoint. It does not live here as a manual,
 * HTTP-triggered action alongside `materializeBalanceAdjustment` above; it is called from exactly
 * one place, `payroll-release.service.ts`'s `releaseProjectUnit`, at the exact moment a
 * `PayrollEntry` actually releases — because that is the moment the reserved
 * `correctionBalancePayable`/`.correctionBalanceRecovery` amount is genuinely paid or deducted
 * through that entry's own net salary, not before. Reuses the *same* `lockPayrollCycleForUpdate` +
 * `acquireBalanceAdjustmentLock` lock order this file already established — `releaseProjectUnit`
 * now acquires the cycle lock too, making release a third participant in that protocol.
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
  employeeIdToEntry: Map<string, { id: string; released: boolean }>,
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

  const targetEntry = employeeIdToEntry.get(adjustment.employeeId);
  const targetEntryId = targetEntry?.id;

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
    targetEntryExists: targetEntry !== undefined,
    targetEntryReleased: targetEntry?.released ?? false,
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
    targetEntryReleased: targetEntry?.released ?? false,
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
    const employeeIdToEntry = new Map(entries.map((e) => [e.employeeId, { id: e.id, released: e.released }]));

    return materializeOneAdjustmentLocked(
      balanceAdjustmentId,
      lockedCycle.id,
      lockedCycle.status,
      employeeIdToEntry,
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
  const employeeIdToEntry = new Map(entries.map((e) => [e.employeeId, { id: e.id, released: e.released }]));
  const employeeIds = [...employeeIdToEntry.keys()];

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
        employeeIdToEntry,
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
 *
 * `params.employeeIdToEntryId` stays the plain `Map<string, string>` shape shared with Advances'
 * own `materializeScheduledAdvanceDeductions` (the same map, passed to both hooks unchanged) —
 * every entry it names was just bootstrapped in this exact transaction, so `released` is always
 * `false`; converted to the richer `{ id, released }` shape `materializeOneAdjustmentLocked` now
 * expects, below.
 */
export async function materializeCorrectionObligationsForNewCycle(
  params: MaterializeCorrectionObligationsParams,
  tx: PrismaTransactionClient,
): Promise<number> {
  const lockedCycle = await lockPayrollCycleForUpdate(params.cycleId, tx);
  if (!lockedCycle) {
    return 0;
  }

  const employeeIdToEntry = new Map(
    [...params.employeeIdToEntryId.entries()].map(([employeeId, entryId]) => [employeeId, { id: entryId, released: false }]),
  );
  const employeeIds = [...employeeIdToEntry.keys()];
  const candidates = await listMaterializableAdjustments(employeeIds, tx);

  let materializedCount = 0;
  for (const candidate of candidates) {
    const result = await materializeOneAdjustmentLocked(
      candidate.id,
      lockedCycle.id,
      lockedCycle.status,
      employeeIdToEntry,
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

// --- Phase 6 Checkpoint 7: release-time ACTIVE -> CONSUMED --------------------------------------

export interface ReleaseTimeConsumptionResult {
  consumedCount: number;
  settledCount: number;
}

/**
 * Consumes every `ACTIVE` `BalanceAdjustmentMaterialization` reserved against the given
 * `PayrollEntry` ids, the moment those entries actually release. Called by exactly one place —
 * `payroll-release.service.ts`'s `releaseProjectUnit`, from inside its own already-open
 * transaction, immediately after the `toRelease` sweep flips those entries' `released` flag —
 * never opens its own transaction, never acquires the cycle lock itself (the caller already holds
 * it, first in the documented lock order, before calling this).
 *
 * For each materialization found (already ordered by `balanceAdjustmentId` —
 * `listActiveMaterializationsForEntries`):
 * 1. `acquireBalanceAdjustmentLock` — same lock every other write path for this `BalanceAdjustment`
 *    already takes, second in the lock order, visited in a deterministic (sorted) sequence so two
 *    concurrent releases naming overlapping adjustments can never deadlock against each other.
 * 2. Re-read the `BalanceAdjustment` fresh, post-lock.
 * 3. Reuse `calculateSettlement` unchanged — the exact settlement math every other settlement path
 *    already uses — passing the *other* active reservations (this materialization's own amount
 *    excluded) as the ceiling, since this settlement is what fulfills this reservation, not a
 *    second, independent claim against it.
 * 4. Create the `BalanceAdjustmentSettlement` row (`cycleId` = the cycle that just released,
 *    `amountApplied` = the materialization's own reserved amount, never re-derived), update the
 *    `BalanceAdjustment` (`remainingAmount`/`.status`/`.settledInCycleId`, the same conditional,
 *    optimistic-concurrency `updateBalanceAdjustmentAfterSettlement` every settlement path uses),
 *    flip the materialization `ACTIVE -> CONSUMED` with its new `settlementId`/`consumedAt`, and
 *    write one `balance_adjustment.settled` audit event (`triggeredBy: 'RELEASE'` distinguishes it
 *    from a manually-recorded settlement in the same audit trail).
 *
 * Everything above happens inside the caller's transaction — if `releaseProjectUnit` fails or
 * rolls back for any reason, every settlement, consumption, balance change, and audit row created
 * here rolls back with it, by construction.
 */
export async function consumeMaterializationsForReleasedEntries(
  params: {
    entryIds: string[];
    releasingCycleId: string;
    actorUserId: string;
    requestMeta: RequestMeta;
  },
  tx: PrismaTransactionClient,
): Promise<ReleaseTimeConsumptionResult> {
  if (params.entryIds.length === 0) {
    return { consumedCount: 0, settledCount: 0 };
  }

  const materializations = await listActiveMaterializationsForEntries(params.entryIds, tx);

  let consumedCount = 0;
  let settledCount = 0;

  for (const materialization of materializations) {
    await acquireBalanceAdjustmentLock(materialization.balanceAdjustmentId, tx);

    const adjustment = await getBalanceAdjustmentById(materialization.balanceAdjustmentId, tx);
    if (!adjustment) {
      // Structurally unreachable (the materialization's own FK RESTRICTs this), kept as a defensive
      // guard rather than a silent `!` assertion, matching this module's own established style.
      continue;
    }

    const activeReservedAmount = await getActiveReservedAmount(materialization.balanceAdjustmentId, tx);
    const otherActiveReservedAmount = new Decimal(activeReservedAmount).minus(materialization.amount.toString()).toFixed(2);

    const result = calculateSettlement({
      remainingAmount: adjustment.remainingAmount.toString(),
      status: adjustment.status,
      proposedAmount: materialization.amount.toString(),
      activeReservedAmount: otherActiveReservedAmount,
    });

    const settlement = await createBalanceAdjustmentSettlementRow(
      {
        balanceAdjustmentId: materialization.balanceAdjustmentId,
        cycleId: params.releasingCycleId,
        amountApplied: result.acceptedAmount,
      },
      tx,
    );

    const affected = await updateBalanceAdjustmentAfterSettlement(
      materialization.balanceAdjustmentId,
      {
        expectedRemainingAmount: adjustment.remainingAmount.toString(),
        newRemainingAmount: result.newRemainingAmount,
        newStatus: result.newStatus,
        settledInCycleId: result.fullySettled ? params.releasingCycleId : null,
      },
      tx,
    );
    if (affected === 0) {
      throw new SettlementValidationError({
        code: 'STALE_CONCURRENT_WRITE',
        message: `BalanceAdjustment "${materialization.balanceAdjustmentId}" changed concurrently during release-time settlement. Reload and try again.`,
      });
    }

    const consumedRows = await consumeMaterializationRow(materialization.id, { settlementId: settlement.id }, tx);
    if (consumedRows === 0) {
      throw new SettlementValidationError({
        code: 'STALE_CONCURRENT_WRITE',
        message: `BalanceAdjustmentMaterialization "${materialization.id}" was no longer ACTIVE at release-time consumption.`,
      });
    }

    await recordAuditLog(
      {
        actorUserId: params.actorUserId,
        action: 'balance_adjustment.settled',
        entityType: 'BalanceAdjustment',
        entityId: materialization.balanceAdjustmentId,
        metadata: {
          correctionId: adjustment.correctionId,
          adjustmentType: adjustment.type,
          settlementAmount: result.acceptedAmount,
          previousRemainingAmount: adjustment.remainingAmount.toString(),
          newRemainingAmount: result.newRemainingAmount,
          previousStatus: adjustment.status,
          newStatus: result.newStatus,
          settlementId: settlement.id,
          materializationId: materialization.id,
          payrollEntryId: materialization.payrollEntryId,
          releasingCycleId: params.releasingCycleId,
          triggeredBy: 'RELEASE',
        },
        ipAddress: params.requestMeta.ipAddress,
        userAgent: params.requestMeta.userAgent,
      },
      tx,
    );

    consumedCount += 1;
    if (result.fullySettled) {
      settledCount += 1;
    }
  }

  return { consumedCount, settledCount };
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
