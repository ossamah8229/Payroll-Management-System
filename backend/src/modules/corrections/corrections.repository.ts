import type { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import type { EntryWithWorkLines } from '../payroll-entry/payroll-entry.service';
import { calculateCorrection } from './corrections.calculation';
import {
  CorrectionValidationError,
  type CorrectionCalculationInput,
  type CorrectionHistoryRecord,
  type CorrectionPreview,
} from './corrections.types';

/**
 * Phase 6 Checkpoints 2 and 3 — data access for the correction domain. Checkpoint 2's own exports
 * (through `previewCorrection`, below) are read-only. Checkpoint 3 adds thin, business-logic-free
 * `create`/`update` primitives for `CorrectionRequest`/`Correction`/`BalanceAdjustment` — every one
 * of them just a Prisma call with typed params, no branching, no validation beyond what Prisma's
 * own generated types enforce; all lifecycle sequencing, locking, and validation coordination
 * lives in `corrections.service.ts`, not here (Checkpoint 3's own "Repository and service
 * structure" — "no business-policy duplication"). Every function accepts an optional transaction
 * client, defaulting to the shared `prisma` singleton, following this codebase's established
 * pattern (`src/modules/audit-log/audit-log.service.ts`'s `recordAuditLog`) so a caller can pass
 * its own `tx` and have these participate in the same transaction.
 */

/** Loads a `PayrollEntry` with its work lines for the correction engine. Throws `ENTRY_NOT_FOUND`
 * (a `CorrectionValidationError`, not `notFound()` from `common/http-error.ts` — this module has
 * no HTTP concern) when no such entry exists. */
export async function getEntryForCorrection(
  payrollEntryId: string,
  client: PrismaTransactionClient = prisma,
): Promise<EntryWithWorkLines> {
  const entry = await client.payrollEntry.findUnique({
    where: { id: payrollEntryId },
    include: { workLines: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!entry) {
    throw new CorrectionValidationError({
      code: 'ENTRY_NOT_FOUND',
      message: `PayrollEntry "${payrollEntryId}" does not exist.`,
    });
  }
  return entry;
}

/** Every approved `Correction` against `payrollEntryId`, across all fields — the full replay
 * history `reconstructBaseline` needs. Ordered by `approvedAt desc` at the database level as a
 * read-efficiency courtesy only; the pure calculation layer re-sorts deterministically itself and
 * never trusts a caller's ordering (Principle 5). Deliberately queries only the `Correction` table
 * — a `CorrectionRequest`, in any status, never represents an applied change and must never
 * appear here (see `corrections.calculation.ts`'s own `buildEffectiveFieldMap` comment). */
export async function getApprovedCorrectionsForEntry(
  payrollEntryId: string,
  client: PrismaTransactionClient = prisma,
): Promise<CorrectionHistoryRecord[]> {
  const rows = await client.correction.findMany({
    where: { payrollEntryId },
    orderBy: { approvedAt: 'desc' },
    select: { id: true, payrollEntryId: true, field: true, newValue: true, approvedAt: true },
  });
  return rows;
}

/** Resolves a proposed `reversesCorrectionId` to its `CorrectionHistoryRecord`, or `null` if it
 * does not exist — `validateReversalTarget` (`corrections.calculation.ts`) is what turns a `null`
 * result into a thrown `REVERSAL_TARGET_NOT_FOUND`, not this function. */
export async function getCorrectionById(
  correctionId: string,
  client: PrismaTransactionClient = prisma,
): Promise<CorrectionHistoryRecord | null> {
  return client.correction.findUnique({
    where: { id: correctionId },
    select: { id: true, payrollEntryId: true, field: true, newValue: true, approvedAt: true },
  });
}

/** Validates `adjustmentTypeId` refers to an existing, active `AdjustmentType` — a DB-backed
 * check, deliberately kept out of `corrections.calculation.ts`'s pure functions (which never
 * touch Prisma). A retired (`isActive = false`) type is rejected the same as a nonexistent one:
 * `AdjustmentType.isActive` exists precisely so a type can be retired without breaking historical
 * `Correction` rows that already reference it (`database/corrections.md §11`) — it was never meant
 * to still accept *new* corrections once retired. */
export async function assertAdjustmentTypeValid(
  adjustmentTypeId: string,
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  const adjustmentType = await client.adjustmentType.findUnique({
    where: { id: adjustmentTypeId },
    select: { isActive: true },
  });
  if (!adjustmentType || !adjustmentType.isActive) {
    throw new CorrectionValidationError({
      code: 'INVALID_ADJUSTMENT_TYPE',
      message: `adjustmentTypeId "${adjustmentTypeId}" does not reference an existing, active AdjustmentType.`,
    });
  }
}

/**
 * Loads everything `calculateCorrection` needs (the entry, its approved-correction history, the
 * reversal target if any) and validates `adjustmentTypeId`, then delegates to the pure engine.
 * Performs reads only — no `Correction`/`BalanceAdjustment` row is created, no `AuditLog` entry is
 * written. Used two ways: standalone, read-only, outside any transaction, by
 * `POST /payroll-entries/:entryId/corrections/preview` (Checkpoint 3's dry-run route); and inside
 * `approveCorrectionRequest`'s own transaction (`corrections.service.ts`), passed a `tx` so the
 * recalculation participates in that transaction's advisory-lock-protected snapshot.
 */
export async function previewCorrection(
  payrollEntryId: string,
  input: CorrectionCalculationInput,
  client: PrismaTransactionClient = prisma,
): Promise<CorrectionPreview> {
  const entry = await getEntryForCorrection(payrollEntryId, client);
  const approvedCorrections = await getApprovedCorrectionsForEntry(payrollEntryId, client);
  await assertAdjustmentTypeValid(input.adjustmentTypeId, client);

  let reversalTarget: CorrectionHistoryRecord | null = null;
  if (input.reversesCorrectionId) {
    reversalTarget = await getCorrectionById(input.reversesCorrectionId, client);
  }

  return calculateCorrection(entry, approvedCorrections, input, reversalTarget);
}

// --- CorrectionRequest: reads -----------------------------------------------------------------

const correctionRequestDetailInclude = {
  payrollEntry: { select: { id: true, employeeId: true, siteId: true, cycleId: true } },
  adjustmentType: true,
  requestedBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  resultingCorrection: true,
} satisfies Prisma.CorrectionRequestInclude;

export type CorrectionRequestDetail = Prisma.CorrectionRequestGetPayload<{
  include: typeof correctionRequestDetailInclude;
}>;

export async function getCorrectionRequestById(
  id: string,
  client: PrismaTransactionClient = prisma,
): Promise<CorrectionRequestDetail | null> {
  return client.correctionRequest.findUnique({ where: { id }, include: correctionRequestDetailInclude });
}

export interface ListCorrectionRequestsFilters {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  payrollEntryId?: string;
  /** Non-Master-Admin callers are scoped to their own assigned sites — `null`/`undefined` means
   * unrestricted (Master Admin only; enforced by the service layer, never inferred here). */
  siteIds?: string[];
}

export async function listCorrectionRequests(
  filters: ListCorrectionRequestsFilters,
  client: PrismaTransactionClient = prisma,
): Promise<CorrectionRequestDetail[]> {
  return client.correctionRequest.findMany({
    where: {
      ...(filters.status && { status: filters.status }),
      ...(filters.payrollEntryId && { payrollEntryId: filters.payrollEntryId }),
      ...(filters.siteIds && { payrollEntry: { siteId: { in: filters.siteIds } } }),
    },
    include: correctionRequestDetailInclude,
    orderBy: { requestedAt: 'desc' },
  });
}

// --- CorrectionRequest: writes -----------------------------------------------------------------

export async function createCorrectionRequestRow(
  data: Prisma.CorrectionRequestUncheckedCreateInput,
  client: PrismaTransactionClient = prisma,
): Promise<CorrectionRequestDetail> {
  const created = await client.correctionRequest.create({ data });
  return getCorrectionRequestById(created.id, client) as Promise<CorrectionRequestDetail>;
}

/**
 * Both status-transition writes below use a conditional `updateMany` (`WHERE status = 'PENDING'`)
 * and return the affected row count, rather than a blind `update` — a defense-in-depth backstop
 * (Product Decision Resolution: "database constraints and conditional updates retained as a
 * secondary safeguard, not a replacement" for the advisory lock) matching this codebase's existing
 * optimistic-locking convention. `corrections.service.ts`'s callers already serialize via the
 * advisory lock before reaching this point, so `count` is expected to be `1` on the ordinary path;
 * `0` here means the request was already decided by a concurrent transaction, surfaced as
 * `REQUEST_NOT_PENDING`, never a silent no-op.
 */
export async function markCorrectionRequestApproved(
  id: string,
  data: { reviewedById: string; resultingCorrectionId: string },
  client: PrismaTransactionClient = prisma,
): Promise<number> {
  const result = await client.correctionRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: 'APPROVED',
      reviewedById: data.reviewedById,
      reviewedAt: new Date(),
      resultingCorrectionId: data.resultingCorrectionId,
    },
  });
  return result.count;
}

export async function markCorrectionRequestRejected(
  id: string,
  data: { reviewedById: string; rejectionReason: string },
  client: PrismaTransactionClient = prisma,
): Promise<number> {
  const result = await client.correctionRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: 'REJECTED',
      reviewedById: data.reviewedById,
      reviewedAt: new Date(),
      rejectionReason: data.rejectionReason,
    },
  });
  return result.count;
}

// --- Correction / BalanceAdjustment: writes -----------------------------------------------------

export async function createCorrectionRow(
  data: Prisma.CorrectionUncheckedCreateInput,
  client: PrismaTransactionClient = prisma,
) {
  return client.correction.create({ data });
}

export async function createBalanceAdjustmentRow(
  data: Prisma.BalanceAdjustmentUncheckedCreateInput,
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustment.create({ data });
}

// --- Approved-correction history for one entry (dual-permission GET route) ---------------------

/** Full approved-`Correction` history for one entry, newest first — read-only, no baseline
 * replay performed here (that's `reconstructBaseline`'s job, called separately by the route if
 * it also wants the current effective state alongside the raw history). */
export async function listCorrectionsForEntry(
  payrollEntryId: string,
  client: PrismaTransactionClient = prisma,
) {
  return client.correction.findMany({
    where: { payrollEntryId },
    orderBy: { approvedAt: 'desc' },
    include: { adjustmentType: true, approvedBy: { select: { id: true, name: true, email: true } } },
  });
}
