import { prisma } from '../../lib/prisma';

/**
 * Phase 6 Checkpoint 6 — minimal read-only projection of the `AdjustmentType` lookup table
 * (seeded by `prisma/seed.ts`, referenced by every `Correction`/`CorrectionRequest`/
 * `BalanceAdjustment` since Checkpoint 1). No route existed anywhere to list these before this
 * checkpoint — the correction-request creation form cannot let a user pick a required
 * `adjustmentTypeId` foreign key without one. Read-only: no create/update/delete, no new
 * lifecycle, mirrors `banks.service.ts`'s own `listBanks` shape exactly.
 */
export async function listAdjustmentTypes(): Promise<{ id: string; code: string; label: string }[]> {
  return prisma.adjustmentType.findMany({
    where: { isActive: true },
    select: { id: true, code: true, label: true },
    orderBy: { label: 'asc' },
  });
}
