import { z } from 'zod';

/**
 * Creates a Payroll Cycle — either the very first one ever (no existing cycles) or a subsequent
 * one (docs/architecture/data-and-storage.md §4, docs/IMPLEMENTATION_PLAN.md Phase 3 Checkpoint 1).
 * The caller supplies which calendar month this cycle represents; the service layer determines
 * whether this is a bootstrap or a carry-forward creation by looking at what already exists — the
 * request shape is identical either way.
 */
export const createPayrollCycleSchema = z.object({
  // Upper bound deliberately wider than a "reasonable real-world year" alone would need
  // (year 2900 is the established fake/test-fixture marker this project's test suite uses to
  // scope Payroll Cycle test rows for cleanup, backend/tests/helpers.ts's cleanTestData()) — still
  // a real bound against garbage input, just wide enough to not collide with that convention.
  year: z.number().int().min(2000).max(2999),
  month: z.number().int().min(1).max(12),
});

export type CreatePayrollCycleInput = z.infer<typeof createPayrollCycleSchema>;
