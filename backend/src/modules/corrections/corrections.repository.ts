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
import { SettlementValidationError } from './corrections.settlement.types';

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

/** Phase 6 Checkpoint 6 — `employee`/`cycle` nested under `payrollEntry` added (read-only select
 * expansion of an already-joined relation, no new join, no new lifecycle) so the Review Queue can
 * display employee identity and payroll period without a per-row follow-up fetch. */
const correctionRequestDetailInclude = {
  payrollEntry: {
    select: {
      id: true,
      employeeId: true,
      siteId: true,
      cycleId: true,
      employee: { select: { id: true, name: true, employeeCode: true } },
      cycle: { select: { id: true, year: true, month: true } },
    },
  },
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
  /** Restricts the list to requests submitted by this one user — the service layer sets this for
   * any caller who lacks `corrections:approve` (Presentation & Workflow Stabilization Checkpoint,
   * 2026-07-25's "My Requests" view: a submitter may monitor their own requests without gaining
   * visibility into every other submitter's), and leaves it `undefined` for an approver, who still
   * sees every request within `siteIds`. */
  requestedById?: string;
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
      ...(filters.requestedById && { requestedById: filters.requestedById }),
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

// --- Phase 6 Checkpoint 4: BalanceAdjustment settlement ------------------------------------------

const balanceAdjustmentDetailInclude = {
  // Phase 6 Checkpoint 6 — `employeeCode` added (read-only select expansion of the same
  // already-joined relation) so the Corrections Ledger can display it without a follow-up fetch.
  employee: { select: { id: true, name: true, employeeCode: true, siteId: true, dateOfLeaving: true } },
  correction: { select: { id: true, field: true, payrollEntryId: true } },
  /// Negative Payroll Recovery checkpoint (2026-07-26) — `null` for a Correction-originated row
  /// (mutually exclusive with `correction` above; see `BalanceAdjustment.originPayrollEntryId`).
  originPayrollEntry: { select: { id: true, cycleId: true, employeeId: true } },
  adjustmentType: true,
  sourceCycle: { select: { id: true, year: true, month: true } },
  settledInCycle: { select: { id: true, year: true, month: true } },
  correctionPayment: true,
  settlements: { orderBy: { appliedAt: 'desc' } as const },
} satisfies Prisma.BalanceAdjustmentInclude;

export type BalanceAdjustmentDetail = Prisma.BalanceAdjustmentGetPayload<{
  include: typeof balanceAdjustmentDetailInclude;
}>;

export async function getBalanceAdjustmentById(
  id: string,
  client: PrismaTransactionClient = prisma,
): Promise<BalanceAdjustmentDetail | null> {
  return client.balanceAdjustment.findUnique({ where: { id }, include: balanceAdjustmentDetailInclude });
}

/**
 * Phase 6 Checkpoint 6 — the Corrections Ledger's own data source. No general "list all
 * BalanceAdjustments" route existed before this checkpoint (Checkpoint 4's own module comment
 * explicitly deferred it as "the Corrections Ledger, explicitly out of this checkpoint's scope").
 * Read-only, reuses `balanceAdjustmentDetailInclude` unchanged — the exact same shape the
 * single-record `getBalanceAdjustmentById` above already returns, just as a filtered list. Mirrors
 * `listCorrectionRequests`'s own `siteIds` convention (`undefined` = unrestricted, Master Admin
 * only; enforced by the service layer, never inferred here).
 */
export interface ListBalanceAdjustmentsFilters {
  status?: 'PENDING' | 'SETTLED';
  type?: 'PAYABLE' | 'RECOVERY' | 'NONE';
  employeeId?: string;
  siteIds?: string[];
}

export async function listBalanceAdjustments(
  filters: ListBalanceAdjustmentsFilters,
  client: PrismaTransactionClient = prisma,
): Promise<BalanceAdjustmentDetail[]> {
  return client.balanceAdjustment.findMany({
    where: {
      ...(filters.status && { status: filters.status }),
      ...(filters.type && { type: filters.type }),
      ...(filters.employeeId && { employeeId: filters.employeeId }),
      ...(filters.siteIds && { employee: { siteId: { in: filters.siteIds } } }),
    },
    include: balanceAdjustmentDetailInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function listBalanceAdjustmentSettlements(
  balanceAdjustmentId: string,
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustmentSettlement.findMany({
    where: { balanceAdjustmentId },
    orderBy: { appliedAt: 'desc' },
    include: { cycle: { select: { id: true, year: true, month: true } } },
  });
}

/** Mirrors `assertAdjustmentTypeValid`'s own convention — a clean typed error instead of a raw
 * FK-violation surfacing at insert time. `isActive` is not required here (unlike AdjustmentType):
 * a `Bank` snapshot on a payment record is describing where money already went, not offering a
 * fresh choice from an active list, so a since-deactivated bank a payment already reflects is not
 * itself invalid — only a genuinely nonexistent one is. */
export async function assertBankExists(bankId: string, client: PrismaTransactionClient = prisma): Promise<void> {
  const bank = await client.bank.findUnique({ where: { id: bankId }, select: { id: true } });
  if (!bank) {
    throw new SettlementValidationError({ code: 'INVALID_BANK', message: `Bank "${bankId}" does not exist.` });
  }
}

export async function assertCycleExists(cycleId: string, client: PrismaTransactionClient = prisma): Promise<void> {
  const cycle = await client.payrollCycle.findUnique({ where: { id: cycleId }, select: { id: true } });
  if (!cycle) {
    throw new SettlementValidationError({ code: 'INVALID_CYCLE', message: `PayrollCycle "${cycleId}" does not exist.` });
  }
}

export async function createCorrectionPaymentRow(
  data: Prisma.CorrectionPaymentUncheckedCreateInput,
  client: PrismaTransactionClient = prisma,
) {
  return client.correctionPayment.create({ data });
}

export async function createBalanceAdjustmentSettlementRow(
  data: Prisma.BalanceAdjustmentSettlementUncheckedCreateInput,
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustmentSettlement.create({ data });
}

/**
 * The settlement-side counterpart to Checkpoint 3's `markCorrectionRequestApproved` — a
 * conditional `updateMany` guarded by the exact `remainingAmount` this transaction read
 * post-lock, not a blind `update`. Returns the affected row count; `0` means a concurrent
 * transaction already changed this `BalanceAdjustment` since the read, surfaced by the caller as
 * `STALE_CONCURRENT_WRITE` rather than silently overwriting.
 */
export async function updateBalanceAdjustmentAfterSettlement(
  id: string,
  data: {
    expectedRemainingAmount: string;
    newRemainingAmount: string;
    newStatus: 'PENDING' | 'SETTLED';
    settledInCycleId: string | null;
  },
  client: PrismaTransactionClient = prisma,
): Promise<number> {
  const result = await client.balanceAdjustment.updateMany({
    where: { id, status: 'PENDING', remainingAmount: data.expectedRemainingAmount },
    data: {
      remainingAmount: data.newRemainingAmount,
      status: data.newStatus,
      ...(data.newStatus === 'SETTLED' && {
        settledInCycleId: data.settledInCycleId,
        settledAt: new Date(),
      }),
    },
  });
  return result.count;
}

// --- Phase 6 Checkpoint 5: Draft-cycle materialization -------------------------------------------

export async function getActiveReservedAmount(
  balanceAdjustmentId: string,
  client: PrismaTransactionClient = prisma,
): Promise<string> {
  const result = await client.balanceAdjustmentMaterialization.aggregate({
    where: { balanceAdjustmentId, status: 'ACTIVE' },
    _sum: { amount: true },
  });
  return (result._sum.amount ?? 0).toString();
}

export async function getMaterializationForCycle(
  balanceAdjustmentId: string,
  cycleId: string,
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustmentMaterialization.findUnique({
    where: { balanceAdjustmentId_cycleId: { balanceAdjustmentId, cycleId } },
  });
}

export async function getPayrollEntryForEmployeeInCycle(
  employeeId: string,
  cycleId: string,
  client: PrismaTransactionClient = prisma,
) {
  return client.payrollEntry.findUnique({ where: { cycleId_employeeId: { cycleId, employeeId } } });
}

export async function createMaterializationRow(
  data: Prisma.BalanceAdjustmentMaterializationUncheckedCreateInput,
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustmentMaterialization.create({ data });
}

/** Every materialization row for one `PayrollEntry`, with its underlying `BalanceAdjustment.type`
 * — the service layer sums these (split PAYABLE/RECOVERY) to recompute
 * `correctionBalancePayable`/`.correctionBalanceRecovery` from scratch, never incrementally. */
export async function listMaterializationsForEntry(
  payrollEntryId: string,
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustmentMaterialization.findMany({
    where: { payrollEntryId },
    select: { amount: true, balanceAdjustment: { select: { type: true } } },
  });
}

export async function updatePayrollEntryCorrectionAggregates(
  payrollEntryId: string,
  data: { correctionBalancePayable: string; correctionBalanceRecovery: string },
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  await client.payrollEntry.update({
    where: { id: payrollEntryId },
    data: {
      correctionBalancePayable: data.correctionBalancePayable,
      correctionBalanceRecovery: data.correctionBalanceRecovery,
      // Same optimistic-locking convention `materializeScheduledAdvanceDeductions` (Advances,
      // Phase 4 Checkpoint 5) already uses for this exact kind of hook-driven PayrollEntry write.
      version: { increment: 1 },
    },
  });
}

export async function getCurrentDraftCycle(client: PrismaTransactionClient = prisma) {
  return client.payrollCycle.findFirst({ where: { status: 'DRAFT' } });
}

export async function getCycleById(cycleId: string, client: PrismaTransactionClient = prisma) {
  return client.payrollCycle.findUnique({ where: { id: cycleId } });
}

/**
 * Native Postgres row-level lock (`SELECT ... FOR UPDATE`), not a custom advisory lock — the
 * deliberate choice for the target `PayrollCycle`, first in the documented lock order (cycle, then
 * `BalanceAdjustment` — `corrections.materialization.service.ts`'s own module comment). Finalize
 * Cycle's own transaction (`payroll-processing.service.ts`) already takes an implicit row lock on
 * this same row via its own conditional `UPDATE ... WHERE status = 'DRAFT'` — a `FOR UPDATE` select
 * here participates in that *same* native Postgres lock queue automatically, with zero changes to
 * Finalize's own code. A custom advisory lock would not achieve this: it only serializes against
 * other code that explicitly takes the identical lock, and Finalize takes none.
 */
export async function lockPayrollCycleForUpdate(
  cycleId: string,
  client: PrismaTransactionClient,
): Promise<{ id: string; status: string } | null> {
  const rows = await client.$queryRaw<
    { id: string; status: string }[]
  >`SELECT "id", "status" FROM "PayrollCycle" WHERE "id" = ${cycleId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** Every `PayrollEntry` in a cycle, reduced to just its own id + `employeeId` + `released` — the
 * `employeeIdToEntryId` shape `materializeScheduledAdvanceDeductions` (Advances) already
 * established as the Materialization Hook convention, built here for the manual/batch route;
 * the archive-and-create-next orchestrator already has its own copy to pass in directly (always
 * `released: false` there — brand-new entries in a cycle just created within the same
 * transaction). `released` added Phase 6 Checkpoint 7, for the `targetEntryReleased` eligibility
 * guard (`corrections.materialization.ts`). */
export async function listEntriesForCycle(cycleId: string, client: PrismaTransactionClient = prisma) {
  return client.payrollEntry.findMany({ where: { cycleId }, select: { id: true, employeeId: true, released: true } });
}

// --- Phase 6 Checkpoint 7: release-time materialization consumption ------------------------------

/** Every `ACTIVE` `BalanceAdjustmentMaterialization` reserved against any of the given
 * `PayrollEntry` ids — the exact set `releaseProjectUnit` needs to consume the moment those
 * entries flip `released: true`. Ordered by `balanceAdjustmentId` so the caller can acquire
 * `acquireBalanceAdjustmentLock` in a deterministic order across the whole batch (the same
 * "cycle, then adjustment" protocol Checkpoint 5 established, extended here to also order
 * multiple adjustments against each other within one release). */
export async function listActiveMaterializationsForEntries(
  entryIds: string[],
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustmentMaterialization.findMany({
    where: { payrollEntryId: { in: entryIds }, status: 'ACTIVE' },
    orderBy: { balanceAdjustmentId: 'asc' },
  });
}

/** Flips one `BalanceAdjustmentMaterialization` `ACTIVE -> CONSUMED`, linking the
 * `BalanceAdjustmentSettlement` row that realized it. Conditional on `status: 'ACTIVE'` — the
 * same defense-in-depth `updateBalanceAdjustmentAfterSettlement` already applies to its own
 * parent `BalanceAdjustment` row, guarded here too even though the adjustment's own advisory lock
 * already makes a concurrent double-consumption structurally impossible in practice. Returns the
 * affected row count; `0` means this materialization was somehow no longer `ACTIVE` (should never
 * happen given the lock, surfaced by the caller as a hard failure rather than silently ignored). */
export async function consumeMaterializationRow(
  id: string,
  data: { settlementId: string },
  client: PrismaTransactionClient = prisma,
): Promise<number> {
  const result = await client.balanceAdjustmentMaterialization.updateMany({
    where: { id, status: 'ACTIVE' },
    data: { status: 'CONSUMED', settlementId: data.settlementId, consumedAt: new Date() },
  });
  return result.count;
}

/** Negative Payroll Recovery checkpoint (2026-07-26) — flips one `BalanceAdjustmentMaterialization`
 * `ACTIVE -> CANCELLED`, never touching `BalanceAdjustment.remainingAmount`/`.status` (unlike
 * `consumeMaterializationRow`, this is not a settlement). Used exactly once: when a `RECOVERY`
 * materialization's target entry resolves (releases) with zero actual capacity to absorb it this
 * cycle (`computeReleaseRecoveryAdjustment`'s case 3) — the reservation must not linger `ACTIVE`
 * against an entry that has just permanently locked, since `getActiveReservedAmount` would then
 * under-count `availableToMaterialize` for every future cycle forever. Cancelling frees the full
 * `remainingAmount` to be re-materialized into the employee's next Draft-cycle entry instead. */
export async function cancelMaterializationRow(
  id: string,
  client: PrismaTransactionClient = prisma,
): Promise<number> {
  const result = await client.balanceAdjustmentMaterialization.updateMany({
    where: { id, status: 'ACTIVE' },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  return result.count;
}

/** Every `PENDING` `BalanceAdjustment` eligible in principle for cycle materialization
 * (`RECOVERY`, or `PAYABLE` with `paymentTiming = DEFERRED`) for a given set of employees —
 * final eligibility (already-materialized, departed, remaining/available amount) is still decided
 * by `corrections.materialization.ts`'s pure `determineMaterialization`, not here. */
export async function listMaterializableAdjustments(
  employeeIds: string[],
  client: PrismaTransactionClient = prisma,
) {
  return client.balanceAdjustment.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'PENDING',
      OR: [{ type: 'RECOVERY' }, { type: 'PAYABLE', paymentTiming: 'DEFERRED' }],
    },
    include: { employee: { select: { id: true, siteId: true, dateOfLeaving: true } } },
  });
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
