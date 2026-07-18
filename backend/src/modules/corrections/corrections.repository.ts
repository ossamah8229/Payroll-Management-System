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
 * Phase 6 Checkpoint 2 — read-only data access for the correction calculation engine. Every
 * export here only reads (Prisma `findUnique`/`findMany`); there is deliberately no `create`/
 * `update`/`delete` in this file — persisting a `Correction`/`BalanceAdjustment` is Checkpoint 3's
 * scope, not this one's. Every function accepts an optional transaction client, defaulting to the
 * shared `prisma` singleton, following this codebase's established pattern
 * (`src/modules/audit-log/audit-log.service.ts`'s `recordAuditLog`) so a future transactional
 * caller can pass its own `tx` and have these reads participate in the same transaction.
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
 * The one orchestration entry point this checkpoint exposes: loads everything
 * `calculateCorrection` needs (the entry, its approved-correction history, the reversal target if
 * any) and validates `adjustmentTypeId`, then delegates to the pure engine. Performs reads only —
 * no `Correction`/`BalanceAdjustment` row is created, no `AuditLog` entry is written, no
 * transaction is opened. Not wired to any route; Checkpoint 4 is what will expose this behind
 * `POST /corrections/preview` or equivalent.
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
