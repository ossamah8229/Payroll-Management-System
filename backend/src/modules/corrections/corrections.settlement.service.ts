import type {
  PreviewSettlementInput,
  RecordBalanceAdjustmentSettlementInput,
  RecordCorrectionPaymentInput,
  SessionUser,
} from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess } from '../employees/employees.service';
import { acquireBalanceAdjustmentLock } from './corrections.lock';
import { calculateSettlement, calculateStandalonePayment } from './corrections.settlement';
import {
  SettlementValidationError,
  type SettlementCalculationResult,
} from './corrections.settlement.types';
import {
  assertBankExists,
  assertCycleExists,
  createBalanceAdjustmentSettlementRow,
  createCorrectionPaymentRow,
  getActiveReservedAmount,
  getBalanceAdjustmentById,
  listBalanceAdjustmentSettlements,
  updateBalanceAdjustmentAfterSettlement,
  type BalanceAdjustmentDetail,
} from './corrections.repository';

/**
 * Phase 6 Checkpoint 4 — settlement lifecycle orchestration: locking, validation coordination, and
 * authorization for recording how an outstanding `BalanceAdjustment` gets settled. Delegates every
 * read/write to `corrections.repository.ts`, every calculation to the pure
 * `corrections.settlement.ts`, and every lock to `corrections.lock.ts`'s
 * `acquireBalanceAdjustmentLock`. Does not implement `PayrollEntry` deductions, bank-sheet/cash-sheet
 * integration, or any frontend-facing concern — those remain later checkpoints.
 *
 * **Checkpoint 5A (2026-07-18) — reservation-aware settlement.** Every settlement path (standalone
 * `CorrectionPayment`, cycle-scoped `BalanceAdjustmentSettlement`, and the read-only preview) now
 * reads `getActiveReservedAmount` (`corrections.repository.ts`, the same reservation ledger
 * Checkpoint 5's `corrections.materialization.ts` reads as `activeReservedAmount`) and passes it
 * into the pure calculation so `RESERVED_AMOUNT_UNAVAILABLE` rejects a settlement that would double-
 * process an amount already reserved into a Draft cycle's own `PayrollEntry` (and therefore already
 * headed for that cycle's release). See that checkpoint's own review report for the full analysis —
 * this was a genuine gap: Checkpoint 5's materialization already treated Checkpoint 4-recorded
 * settlements as reducing `availableToMaterialize` (via `remainingAmount`), but the reverse was never
 * true — settlement never checked reservations.
 */

function assertNotFound(adjustment: BalanceAdjustmentDetail | null, id: string): asserts adjustment is BalanceAdjustmentDetail {
  if (!adjustment) {
    throw new SettlementValidationError({
      code: 'BALANCE_ADJUSTMENT_NOT_FOUND',
      message: `BalanceAdjustment "${id}" does not exist.`,
    });
  }
}

/** Product Decision Resolution: "Recovery from departed employees remains permanently pending" —
 * no receivables/collections system exists anywhere in this codebase (the same accepted gap as an
 * uncollectable Advance), so there is no approved path, automatic or manual, to settle a
 * `RECOVERY` adjustment once the employee has departed. `PAYABLE` is entirely unaffected — paying
 * money *to* a departed employee has no collection problem to begin with. */
function assertRecoverySettlementAllowed(adjustment: BalanceAdjustmentDetail): void {
  if (adjustment.type === 'RECOVERY' && adjustment.employee.dateOfLeaving !== null) {
    throw new SettlementValidationError({
      code: 'DEPARTED_EMPLOYEE_RECOVERY_PENDING',
      message:
        'This employee has departed — a RECOVERY balance from a departed employee remains permanently PENDING; no settlement path exists (no receivables system in this codebase, per the approved Product Decision Resolution).',
    });
  }
}

function assertPayableOnly(adjustment: BalanceAdjustmentDetail): void {
  if (adjustment.type !== 'PAYABLE') {
    throw new SettlementValidationError({
      code: 'WRONG_ADJUSTMENT_TYPE_FOR_PAYMENT',
      message: `A standalone CorrectionPayment only applies to a PAYABLE BalanceAdjustment (this one is ${adjustment.type}).`,
    });
  }
}

async function recordSettlementAuditEvent(
  tx: PrismaTransactionClient,
  params: {
    currentUser: SessionUser;
    adjustment: BalanceAdjustmentDetail;
    result: SettlementCalculationResult;
    correctionPaymentId?: string;
    settlementId?: string;
    requestMeta: RequestMeta;
  },
): Promise<void> {
  await recordAuditLog(
    {
      actorUserId: params.currentUser.id,
      action: 'balance_adjustment.settled',
      entityType: 'BalanceAdjustment',
      entityId: params.adjustment.id,
      metadata: {
        correctionId: params.adjustment.correctionId,
        adjustmentType: params.adjustment.type,
        settlementAmount: params.result.acceptedAmount,
        previousRemainingAmount: params.adjustment.remainingAmount.toString(),
        newRemainingAmount: params.result.newRemainingAmount,
        previousStatus: params.adjustment.status,
        newStatus: params.result.newStatus,
        correctionPaymentId: params.correctionPaymentId ?? null,
        settlementId: params.settlementId ?? null,
      },
      ipAddress: params.requestMeta.ipAddress,
      userAgent: params.requestMeta.userAgent,
    },
    tx,
  );
}

/**
 * Records a standalone `CorrectionPayment` — the one-shot, out-of-cycle, full-settlement path for
 * a `PAYABLE` `BalanceAdjustment`. Always settles the entire remaining balance
 * (`calculateStandalonePayment`); `settledInCycleId` stays `null` (settled outside any cycle, per
 * `docs/architecture/workflows/corrections-and-balance-adjustments.md`).
 */
export async function recordCorrectionPayment(
  currentUser: SessionUser,
  balanceAdjustmentId: string,
  input: RecordCorrectionPaymentInput,
  requestMeta: RequestMeta,
) {
  return prisma.$transaction(async (tx) => {
    const preLock = await getBalanceAdjustmentById(balanceAdjustmentId, tx);
    assertNotFound(preLock, balanceAdjustmentId);
    assertSiteAccess(currentUser, preLock.employee.siteId);

    await acquireBalanceAdjustmentLock(balanceAdjustmentId, tx);

    const adjustment = await getBalanceAdjustmentById(balanceAdjustmentId, tx);
    assertNotFound(adjustment, balanceAdjustmentId);
    assertPayableOnly(adjustment);

    if (input.bankId) {
      await assertBankExists(input.bankId, tx);
    }

    const activeReservedAmount = await getActiveReservedAmount(balanceAdjustmentId, tx);
    const result = calculateStandalonePayment({
      remainingAmount: adjustment.remainingAmount.toString(),
      status: adjustment.status,
      activeReservedAmount,
    });

    const correctionPayment = await createCorrectionPaymentRow(
      {
        balanceAdjustmentId,
        employeeId: adjustment.employeeId,
        amount: result.acceptedAmount,
        bankId: input.bankId ?? null,
        branchCode: input.branchCode ?? null,
        accountNumber: input.accountNumber ?? null,
        iban: input.iban ?? null,
        paidById: currentUser.id,
      },
      tx,
    );

    const affected = await updateBalanceAdjustmentAfterSettlement(
      balanceAdjustmentId,
      {
        expectedRemainingAmount: adjustment.remainingAmount.toString(),
        newRemainingAmount: result.newRemainingAmount,
        newStatus: result.newStatus,
        settledInCycleId: null,
      },
      tx,
    );
    if (affected === 0) {
      throw new SettlementValidationError({
        code: 'STALE_CONCURRENT_WRITE',
        message: 'This BalanceAdjustment was changed by a concurrent request. Reload and try again.',
      });
    }

    await recordSettlementAuditEvent(tx, {
      currentUser,
      adjustment,
      result,
      correctionPaymentId: correctionPayment.id,
      requestMeta,
    });

    const finalAdjustment = await getBalanceAdjustmentById(balanceAdjustmentId, tx);
    return { balanceAdjustment: finalAdjustment!, correctionPayment };
  });
}

/**
 * Records an immutable `BalanceAdjustmentSettlement` — the repeatable, cycle-scoped, partial-or-
 * full ledger entry, for either `PAYABLE` or `RECOVERY`. `input.cycleId` is caller-supplied
 * (no automatic "next Draft cycle" discovery — Draft-cycle materialization is out of scope).
 */
export async function recordBalanceAdjustmentSettlement(
  currentUser: SessionUser,
  balanceAdjustmentId: string,
  input: RecordBalanceAdjustmentSettlementInput,
  requestMeta: RequestMeta,
) {
  return prisma.$transaction(async (tx) => {
    const preLock = await getBalanceAdjustmentById(balanceAdjustmentId, tx);
    assertNotFound(preLock, balanceAdjustmentId);
    assertSiteAccess(currentUser, preLock.employee.siteId);

    await acquireBalanceAdjustmentLock(balanceAdjustmentId, tx);

    const adjustment = await getBalanceAdjustmentById(balanceAdjustmentId, tx);
    assertNotFound(adjustment, balanceAdjustmentId);
    assertRecoverySettlementAllowed(adjustment);

    await assertCycleExists(input.cycleId, tx);

    const activeReservedAmount = await getActiveReservedAmount(balanceAdjustmentId, tx);
    const result = calculateSettlement({
      remainingAmount: adjustment.remainingAmount.toString(),
      status: adjustment.status,
      proposedAmount: input.amount,
      activeReservedAmount,
    });

    const settlement = await createBalanceAdjustmentSettlementRow(
      { balanceAdjustmentId, cycleId: input.cycleId, amountApplied: result.acceptedAmount },
      tx,
    );

    const affected = await updateBalanceAdjustmentAfterSettlement(
      balanceAdjustmentId,
      {
        expectedRemainingAmount: adjustment.remainingAmount.toString(),
        newRemainingAmount: result.newRemainingAmount,
        newStatus: result.newStatus,
        settledInCycleId: result.fullySettled ? input.cycleId : null,
      },
      tx,
    );
    if (affected === 0) {
      throw new SettlementValidationError({
        code: 'STALE_CONCURRENT_WRITE',
        message: 'This BalanceAdjustment was changed by a concurrent request. Reload and try again.',
      });
    }

    await recordSettlementAuditEvent(tx, {
      currentUser,
      adjustment,
      result,
      settlementId: settlement.id,
      requestMeta,
    });

    const finalAdjustment = await getBalanceAdjustmentById(balanceAdjustmentId, tx);
    return { balanceAdjustment: finalAdjustment!, settlement };
  });
}

/** Read-only dry run of either settlement path — no lock, no persistence. */
export async function previewSettlement(
  currentUser: SessionUser,
  balanceAdjustmentId: string,
  input: PreviewSettlementInput,
): Promise<SettlementCalculationResult> {
  const adjustment = await getBalanceAdjustmentById(balanceAdjustmentId);
  assertNotFound(adjustment, balanceAdjustmentId);
  assertSiteAccess(currentUser, adjustment.employee.siteId);

  const activeReservedAmount = await getActiveReservedAmount(balanceAdjustmentId);

  if (input.mode === 'STANDALONE') {
    assertPayableOnly(adjustment);
    return calculateStandalonePayment({
      remainingAmount: adjustment.remainingAmount.toString(),
      status: adjustment.status,
      activeReservedAmount,
    });
  }

  if (!input.amount) {
    throw new SettlementValidationError({
      code: 'INVALID_SETTLEMENT_AMOUNT',
      message: 'An amount is required to preview a cycle-scoped settlement.',
    });
  }
  assertRecoverySettlementAllowed(adjustment);
  return calculateSettlement({
    remainingAmount: adjustment.remainingAmount.toString(),
    status: adjustment.status,
    proposedAmount: input.amount,
    activeReservedAmount,
  });
}

export async function getBalanceAdjustmentDetail(currentUser: SessionUser, id: string): Promise<BalanceAdjustmentDetail> {
  const adjustment = await getBalanceAdjustmentById(id);
  assertNotFound(adjustment, id);
  assertSiteAccess(currentUser, adjustment.employee.siteId);
  return adjustment;
}

export async function listSettlementsForAdjustment(currentUser: SessionUser, balanceAdjustmentId: string) {
  const adjustment = await getBalanceAdjustmentById(balanceAdjustmentId);
  assertNotFound(adjustment, balanceAdjustmentId);
  assertSiteAccess(currentUser, adjustment.employee.siteId);
  return listBalanceAdjustmentSettlements(balanceAdjustmentId);
}
