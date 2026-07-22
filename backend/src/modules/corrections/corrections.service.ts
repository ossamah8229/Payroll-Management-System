import { Decimal } from 'decimal.js';
import type {
  ApproveCorrectionRequestInput,
  CreateCorrectionRequestInput,
  ListCorrectionRequestsQuery,
  PreviewCorrectionInput,
  RejectCorrectionRequestInput,
  SessionUser,
} from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess, isMasterAdmin } from '../employees/employees.service';
import { acquirePayrollEntryLock } from './corrections.lock';
import {
  assertEntryIsReleased,
  assertFieldIsCorrectable,
  assertSingleWorkLineForField,
  calculateCorrection,
  parseAndValidateFieldValue,
} from './corrections.calculation';
import {
  assertAdjustmentTypeValid,
  createBalanceAdjustmentRow,
  createCorrectionRequestRow,
  createCorrectionRow,
  getApprovedCorrectionsForEntry,
  getCorrectionById,
  getCorrectionRequestById,
  getEntryForCorrection,
  listCorrectionRequests,
  listCorrectionsForEntry,
  markCorrectionRequestApproved,
  markCorrectionRequestRejected,
  previewCorrection,
  type CorrectionRequestDetail,
} from './corrections.repository';
import { CorrectionValidationError, type CorrectionHistoryRecord, type CorrectionPreview } from './corrections.types';

/**
 * Phase 6 Checkpoint 3 — the transactional request/approval/rejection workflow: lifecycle
 * orchestration, validation coordination, and authorization. Delegates every actual read/write to
 * `corrections.repository.ts`, every calculation to `corrections.calculation.ts` (Checkpoint 2,
 * unchanged), and every lock to `corrections.lock.ts`. Does not implement settlement,
 * `CorrectionPayment` processing, `BalanceAdjustmentSettlement` creation, Draft-cycle
 * materialization, or any frontend-facing concern — those remain later checkpoints.
 *
 * Deliberately does **not** implement a "direct correction" (Master User corrects a released
 * entry personally, bypassing `CorrectionRequest` entirely) — the Architecture Review describes
 * this as a second, valid path to an identical `Correction` row, but this checkpoint's own brief
 * scopes "Implement" to request creation/listing/detail, approval, and rejection only; direct
 * correction is left for a later checkpoint to add as a thin variant of `approveCorrectionRequest`
 * below (skip the request-lookup/status-flip steps, everything else — lock, recalculation,
 * `Correction`/`BalanceAdjustment` creation, audit — is already exactly reusable).
 */

function assertReasonNonBlank(reason: string, field: 'reason' | 'rejectionReason'): void {
  if (reason.trim().length === 0) {
    throw new CorrectionValidationError({
      code: 'MALFORMED_ENUM_COMBINATION',
      message: field === 'reason' ? 'A reason is required.' : 'A rejection reason is required.',
    });
  }
}

/**
 * Post-Phase-5 Stabilization Checkpoint 4B remediation — requester/reviewer separation
 * (docs/architecture/authentication.md). Whoever submitted a `CorrectionRequest` may never be the
 * one who approves or rejects it, checked purely by comparing user ids — never a role name, role
 * code, or permission combination. Today this can only ever fire for Master Admin (the only seeded
 * role holding both `payroll:entry` and `corrections:approve`); it exists so a future
 * administrator-defined role combining the two doesn't silently inherit a self-approval path
 * nobody designed. Called both before and after the per-entry advisory lock is acquired
 * (`approveCorrectionRequest`/`rejectCorrectionRequest`, below) — the same defense-in-depth
 * double-check this module already applies to `REQUEST_NOT_PENDING` — so the guard is the very
 * first thing evaluated both times, before any read that could feed a mutation.
 */
function assertNotSelfReview(currentUser: SessionUser, request: { requestedById: string }): void {
  if (request.requestedById === currentUser.id) {
    throw new CorrectionValidationError({
      code: 'SELF_REVIEW_NOT_ALLOWED',
      message: 'You cannot approve or reject your own correction request.',
    });
  }
}

/** Composes `BalanceAdjustment.remark` — the auto-generated, human-readable explanation shown on
 * the Payslip and Corrections Ledger (`docs/architecture/workflows/
 * corrections-and-balance-adjustments.md` §6's example text). Not byte-identical to that example,
 * but carries the same information: what changed, why, and the resulting balance. */
function composeBalanceAdjustmentRemark(input: {
  field: string;
  oldValue: string;
  newValue: string;
  oldNetSalary: string;
  newNetSalary: string;
  adjustmentTypeLabel: string;
  reason: string;
  amount: string;
  classification: 'PAYABLE' | 'RECOVERY';
}): string {
  const verb = input.classification === 'PAYABLE' ? 'Balance payable' : 'Balance recoverable';
  return (
    `${verb}: a correction (type: ${input.adjustmentTypeLabel}; reason: ${input.reason}) changed ` +
    `${input.field} from ${input.oldValue} to ${input.newValue}, adjusting net salary from ` +
    `PKR ${input.oldNetSalary} to PKR ${input.newNetSalary}. PKR ${input.amount} ` +
    `${input.classification === 'PAYABLE' ? 'is payable to' : 'is recoverable from'} the employee.`
  );
}

/** Validates a caller-supplied `recoveryInstallmentAmount` string — a positive decimal, same
 * bounds as `BalanceAdjustment_recoveryInstallmentAmount_positive_check` (Checkpoint 1's
 * hand-added CHECK), surfaced as a clean typed error instead of a raw Postgres constraint
 * violation. */
function validatePositiveDecimalString(raw: string): string {
  let value: Decimal;
  try {
    value = new Decimal(raw);
  } catch {
    throw new CorrectionValidationError({
      code: 'INVALID_NUMERIC_VALUE',
      message: `recoveryInstallmentAmount must be a valid number, got ${JSON.stringify(raw)}.`,
    });
  }
  if (!value.isFinite() || value.lessThanOrEqualTo(0)) {
    throw new CorrectionValidationError({
      code: 'INVALID_NUMERIC_VALUE',
      message: `recoveryInstallmentAmount must be a positive number, got ${JSON.stringify(raw)}.`,
    });
  }
  return value.toFixed(2);
}

// --- Create --------------------------------------------------------------------------------------

/**
 * Submits a `CorrectionRequest` — "any authorized payroll user may propose a correction"
 * (`payroll:entry`). Deliberately does not calculate or freeze a delta here (the brief's own
 * instruction) — only structural/shape validation of the proposed value runs now;
 * `approveCorrectionRequest` is what recalculates the real baseline and delta, from live data, at
 * approval time.
 */
export async function createCorrectionRequest(
  currentUser: SessionUser,
  payrollEntryId: string,
  input: CreateCorrectionRequestInput,
  requestMeta: RequestMeta,
): Promise<CorrectionRequestDetail> {
  const entry = await getEntryForCorrection(payrollEntryId);
  assertSiteAccess(currentUser, entry.siteId);
  assertEntryIsReleased(entry);
  assertFieldIsCorrectable(input.field);
  assertSingleWorkLineForField(input.field, entry.workLines.length);
  parseAndValidateFieldValue(input.field, input.proposedNewValue);
  assertReasonNonBlank(input.reason, 'reason');
  await assertAdjustmentTypeValid(input.adjustmentTypeId);

  return prisma.$transaction(async (tx) => {
    const created = await createCorrectionRequestRow(
      {
        payrollEntryId,
        field: input.field,
        proposedNewValue: input.proposedNewValue,
        adjustmentTypeId: input.adjustmentTypeId,
        reason: input.reason,
        requestedById: currentUser.id,
      },
      tx,
    );

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'correction_request.created',
        entityType: 'CorrectionRequest',
        entityId: created.id,
        metadata: {
          payrollEntryId,
          field: input.field,
          proposedNewValue: input.proposedNewValue,
          adjustmentTypeId: input.adjustmentTypeId,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return created;
  });
}

// --- Read ----------------------------------------------------------------------------------------

export async function listCorrectionRequestsForUser(
  currentUser: SessionUser,
  query: ListCorrectionRequestsQuery,
): Promise<CorrectionRequestDetail[]> {
  return listCorrectionRequests({
    status: query.status,
    payrollEntryId: query.payrollEntryId,
    siteIds: isMasterAdmin(currentUser) ? undefined : currentUser.siteIds,
  });
}

export async function getCorrectionRequestDetail(
  currentUser: SessionUser,
  id: string,
): Promise<CorrectionRequestDetail> {
  const request = await getCorrectionRequestById(id);
  if (!request) {
    throw new CorrectionValidationError({ code: 'REQUEST_NOT_FOUND', message: `CorrectionRequest "${id}" does not exist.` });
  }
  assertSiteAccess(currentUser, request.payrollEntry.siteId);
  return request;
}

/** Read-only dry run of `corrections.repository.ts`'s `previewCorrection` — no lock, no
 * persistence, safe to call as often as the UI wants while a user is drafting a request. */
export async function previewCorrectionForEntry(
  currentUser: SessionUser,
  payrollEntryId: string,
  input: PreviewCorrectionInput,
): Promise<CorrectionPreview> {
  const entry = await getEntryForCorrection(payrollEntryId);
  assertSiteAccess(currentUser, entry.siteId);
  return previewCorrection(payrollEntryId, input);
}

export async function getCorrectionHistoryForEntry(currentUser: SessionUser, payrollEntryId: string) {
  const entry = await getEntryForCorrection(payrollEntryId);
  assertSiteAccess(currentUser, entry.siteId);
  return listCorrectionsForEntry(payrollEntryId);
}

// --- Approve ---------------------------------------------------------------------------------------

export interface ApproveCorrectionRequestResult {
  correctionRequest: CorrectionRequestDetail;
  correction: Awaited<ReturnType<typeof createCorrectionRow>>;
  balanceAdjustment: Awaited<ReturnType<typeof createBalanceAdjustmentRow>>;
}

/**
 * The one genuinely transactional write path in this checkpoint — see this file's own module
 * comment and the Core Invariants list in Checkpoint 3's brief. Sequence, exactly:
 * 1. Load the request (to discover which `PayrollEntry` to lock).
 * 2. Authorize (site access) before acquiring anything.
 * 3. Acquire the advisory lock for that `PayrollEntry`.
 * 4. Re-read the request — authoritative, post-lock.
 * 5. Confirm `PENDING`.
 * 6. Re-read the `PayrollEntry` and its full approved-correction history — fresh, post-lock.
 * 7. Recalculate via the pure Checkpoint 2 engine (throws `ZERO_DELTA` internally if applicable).
 * 8. Create the immutable `Correction`.
 * 9. Create the `BalanceAdjustment`.
 * 10. Flip the request to `APPROVED` via the conditional `updateMany` (defense-in-depth backstop).
 * 11. Audit (one aggregate `correction.approved` event, cross-referencing the request and the
 *     resulting `BalanceAdjustment`).
 * All inside one `prisma.$transaction` — any failure at any step rolls back everything.
 */
export async function approveCorrectionRequest(
  currentUser: SessionUser,
  requestId: string,
  input: ApproveCorrectionRequestInput,
  requestMeta: RequestMeta,
): Promise<ApproveCorrectionRequestResult> {
  return prisma.$transaction(async (tx: PrismaTransactionClient) => {
    const preLockRequest = await getCorrectionRequestById(requestId, tx);
    if (!preLockRequest) {
      throw new CorrectionValidationError({ code: 'REQUEST_NOT_FOUND', message: `CorrectionRequest "${requestId}" does not exist.` });
    }
    assertNotSelfReview(currentUser, preLockRequest);
    assertSiteAccess(currentUser, preLockRequest.payrollEntry.siteId);

    await acquirePayrollEntryLock(preLockRequest.payrollEntryId, tx);

    const request = await getCorrectionRequestById(requestId, tx);
    if (!request) {
      throw new CorrectionValidationError({ code: 'REQUEST_NOT_FOUND', message: `CorrectionRequest "${requestId}" does not exist.` });
    }
    assertNotSelfReview(currentUser, request);
    if (request.status !== 'PENDING') {
      throw new CorrectionValidationError({
        code: 'REQUEST_NOT_PENDING',
        message: `CorrectionRequest "${requestId}" has already been ${request.status.toLowerCase()} and cannot be approved.`,
      });
    }

    const entry = await getEntryForCorrection(request.payrollEntryId, tx);
    assertEntryIsReleased(entry);

    const approvedCorrections = await getApprovedCorrectionsForEntry(request.payrollEntryId, tx);

    const field = input.field ?? request.field;
    const proposedNewValue = input.proposedNewValue ?? request.proposedNewValue;
    const adjustmentTypeId = input.adjustmentTypeId ?? request.adjustmentTypeId;
    const reversesCorrectionId = input.reversesCorrectionId ?? null;

    await assertAdjustmentTypeValid(adjustmentTypeId, tx);

    let reversalTarget: CorrectionHistoryRecord | null = null;
    if (reversesCorrectionId) {
      reversalTarget = await getCorrectionById(reversesCorrectionId, tx);
    }

    const preview = calculateCorrection(
      entry,
      approvedCorrections,
      { field, proposedNewValue, adjustmentTypeId, reversesCorrectionId },
      reversalTarget,
    );

    let paymentTiming: 'IMMEDIATE' | 'DEFERRED' | null = null;
    if (preview.delta.classification === 'PAYABLE') {
      if (!input.paymentTiming) {
        throw new CorrectionValidationError({
          code: 'PAYMENT_TIMING_REQUIRED',
          field,
          message: 'paymentTiming (IMMEDIATE or DEFERRED) is required when the correction results in a payable balance.',
        });
      }
      paymentTiming = input.paymentTiming;
    } else if (input.paymentTiming) {
      throw new CorrectionValidationError({
        code: 'PAYMENT_TIMING_NOT_APPLICABLE',
        field,
        message: 'paymentTiming only applies when the correction results in a PAYABLE balance.',
      });
    }

    let recoveryInstallmentAmount: string | null = null;
    if (input.recoveryInstallmentAmount) {
      if (preview.delta.classification !== 'RECOVERY') {
        throw new CorrectionValidationError({
          code: 'RECOVERY_INSTALLMENT_AMOUNT_NOT_APPLICABLE',
          field,
          message: 'recoveryInstallmentAmount only applies when the correction results in a RECOVERY balance.',
        });
      }
      recoveryInstallmentAmount = validatePositiveDecimalString(input.recoveryInstallmentAmount);
    }

    const correction = await createCorrectionRow(
      {
        payrollEntryId: entry.id,
        field,
        oldValue: preview.oldValue,
        newValue: preview.newValue,
        oldNetSalary: preview.oldNetSalary,
        newNetSalary: preview.newNetSalary,
        adjustmentTypeId,
        reason: request.reason,
        approvedById: currentUser.id,
        reversesCorrectionId,
      },
      tx,
    );

    const amount = new Decimal(preview.delta.amount).abs().toFixed(2);
    const adjustmentType = await tx.adjustmentType.findUniqueOrThrow({ where: { id: adjustmentTypeId } });
    const remark = composeBalanceAdjustmentRemark({
      field,
      oldValue: preview.oldValue,
      newValue: preview.newValue,
      oldNetSalary: preview.oldNetSalary,
      newNetSalary: preview.newNetSalary,
      adjustmentTypeLabel: adjustmentType.label,
      reason: request.reason,
      amount,
      classification: preview.delta.classification,
    });

    const balanceAdjustment = await createBalanceAdjustmentRow(
      {
        correctionId: correction.id,
        employeeId: entry.employeeId,
        sourceCycleId: entry.cycleId,
        adjustmentTypeId,
        amount,
        type: preview.delta.classification,
        status: 'PENDING',
        paymentTiming,
        recoveryInstallmentAmount,
        remainingAmount: amount,
        remark,
      },
      tx,
    );

    const affected = await markCorrectionRequestApproved(
      requestId,
      { reviewedById: currentUser.id, resultingCorrectionId: correction.id },
      tx,
    );
    if (affected === 0) {
      throw new CorrectionValidationError({
        code: 'REQUEST_NOT_PENDING',
        message: `CorrectionRequest "${requestId}" was decided by a concurrent request and cannot be approved.`,
      });
    }

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'correction.approved',
        entityType: 'Correction',
        entityId: correction.id,
        metadata: {
          correctionRequestId: requestId,
          payrollEntryId: entry.id,
          field,
          oldValue: preview.oldValue,
          newValue: preview.newValue,
          delta: { amount: preview.delta.amount, classification: preview.delta.classification },
          balanceAdjustmentId: balanceAdjustment.id,
          balanceAdjustmentType: balanceAdjustment.type,
          reversesCorrectionId,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    const finalRequest = await getCorrectionRequestById(requestId, tx);
    return { correctionRequest: finalRequest!, correction, balanceAdjustment };
  });
}

// --- Reject --------------------------------------------------------------------------------------

/**
 * Rejects a `PENDING` `CorrectionRequest`. Also acquires the same `PayrollEntry`-scoped advisory
 * lock `approveCorrectionRequest` does — not because rejection recalculates anything (it doesn't),
 * but because without it, a reject-vs-approve race on the *same request* could otherwise let a
 * rejection silently overwrite a request an interleaved transaction just approved (or vice versa).
 * The lock fully serializes both against each other for the same entry; the conditional
 * `updateMany` (below, via `markCorrectionRequestRejected`) is the backstop.
 */
export async function rejectCorrectionRequest(
  currentUser: SessionUser,
  requestId: string,
  input: RejectCorrectionRequestInput,
  requestMeta: RequestMeta,
): Promise<CorrectionRequestDetail> {
  assertReasonNonBlank(input.rejectionReason, 'rejectionReason');

  return prisma.$transaction(async (tx) => {
    const preLockRequest = await getCorrectionRequestById(requestId, tx);
    if (!preLockRequest) {
      throw new CorrectionValidationError({ code: 'REQUEST_NOT_FOUND', message: `CorrectionRequest "${requestId}" does not exist.` });
    }
    assertNotSelfReview(currentUser, preLockRequest);
    assertSiteAccess(currentUser, preLockRequest.payrollEntry.siteId);

    await acquirePayrollEntryLock(preLockRequest.payrollEntryId, tx);

    const request = await getCorrectionRequestById(requestId, tx);
    if (!request || request.status !== 'PENDING') {
      throw new CorrectionValidationError({
        code: 'REQUEST_NOT_PENDING',
        message: `CorrectionRequest "${requestId}" has already been decided and cannot be rejected.`,
      });
    }
    assertNotSelfReview(currentUser, request);

    const affected = await markCorrectionRequestRejected(
      requestId,
      { reviewedById: currentUser.id, rejectionReason: input.rejectionReason },
      tx,
    );
    if (affected === 0) {
      throw new CorrectionValidationError({
        code: 'REQUEST_NOT_PENDING',
        message: `CorrectionRequest "${requestId}" was decided by a concurrent request and cannot be rejected.`,
      });
    }

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'correction_request.rejected',
        entityType: 'CorrectionRequest',
        entityId: requestId,
        metadata: {
          payrollEntryId: request.payrollEntryId,
          field: request.field,
          rejectionReason: input.rejectionReason,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return (await getCorrectionRequestById(requestId, tx))!;
  });
}
