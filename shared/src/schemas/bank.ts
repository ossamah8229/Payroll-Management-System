import { z } from 'zod';

/**
 * Bank Registry input validation (Phase 4 Checkpoint 1, docs/architecture/database/employee.md
 * §7). Field lengths mirror `Bank.code`/`Bank.name`'s existing `@db.VarChar` column limits
 * (backend/prisma/schema.prisma) — no new columns were added for this checkpoint.
 */
export const createBankSchema = z.object({
  code: z.string().trim().min(1, 'Bank code is required').max(10),
  name: z.string().trim().min(1, 'Display name is required').max(120),
});

export type CreateBankInput = z.infer<typeof createBankSchema>;

/**
 * All fields optional — `banks.service.ts` enforces which combinations are actually allowed
 * (e.g. `code` is rejected once a bank has been referenced; every field is rejected outright for
 * the reserved Cash record) rather than expressing those business rules here in the shape itself.
 */
export const updateBankSchema = z.object({
  code: z.string().trim().min(1, 'Bank code is required').max(10).optional(),
  name: z.string().trim().min(1, 'Display name is required').max(120).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateBankInput = z.infer<typeof updateBankSchema>;
