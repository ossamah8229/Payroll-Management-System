import { z } from 'zod';
import { MAX_BATCH_PAYSLIPS_PER_REQUEST } from '../constants/payslips';

/** The batch PDF/ZIP generation request body (Phase 4 Checkpoint 6.3.2) — an explicit list of
 * employee ids, matching the frontend's own "select all currently loaded" semantics (never a
 * server-recomputed filter the operator never actually saw). Validated identically on both ends,
 * per this project's established Zod convention. */
export const batchPayslipsSchema = z.object({
  employeeIds: z
    .array(z.string().uuid())
    .min(1, 'Select at least one employee')
    .max(MAX_BATCH_PAYSLIPS_PER_REQUEST, `Select at most ${MAX_BATCH_PAYSLIPS_PER_REQUEST} employees per batch`),
});

export type BatchPayslipsInput = z.infer<typeof batchPayslipsSchema>;
