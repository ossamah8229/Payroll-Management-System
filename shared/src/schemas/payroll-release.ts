import { z } from 'zod';

/**
 * Phase 7E durability checkpoint (A4) — closes the "release races a pending Payroll Entry edit"
 * gap identified in the Payroll Entry Data Durability audit. `releaseProjectUnit` itself already
 * only ever releases against Postgres rows read fresh, inside its own locked transaction (never
 * client-supplied entry data) — so a release can never be computed from stale figures. What it
 * *couldn't* previously detect is the narrower case this schema targets: the Salary Release page
 * showing the operator a Unit's entry count from one read, and a distinct save landing on one of
 * those same entries between that read and the moment "Release" is actually clicked — releasing
 * without the operator having seen the entry in its final form.
 *
 * `expectedVersions` is optional and additive, not a new save/preflight API of its own: it reuses
 * the exact same optimistic-locking `version` column every Payroll Entry PATCH already relies on
 * (`docs/architecture/database/schema-invariants.md` §22). The Salary Release page populates it
 * from entries it already fetches (`usePayrollEntries`, filtered to whichever entries touch the
 * Unit being released) — no new read endpoint either. Omitting it (or sending an empty array)
 * skips the check entirely, so this stays backward-compatible with any other caller.
 */
export const releaseProjectUnitSchema = z.object({
  expectedVersions: z
    .array(
      z.object({
        entryId: z.string().uuid(),
        version: z.number().int(),
      }),
    )
    .optional(),
});

export type ReleaseProjectUnitInput = z.infer<typeof releaseProjectUnitSchema>;
