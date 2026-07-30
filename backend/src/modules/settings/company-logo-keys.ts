/**
 * Deterministic sibling storage keys for the Company Logo (Phase 7C). `CompanySettings.logoStorageKey`
 * already existed in the schema (migration `20260702084133_phase2_master_data`) before this
 * checkpoint — this file is a deliberate reinterpretation of what that one column *means*, not a
 * schema change: it now holds a **version identifier** (a fresh UUID minted on every upload/
 * replace), not a literal object key. One canonical base key derives all three approved derived
 * assets (Original / UI / Print), so no additional column is needed to track them individually —
 * per this checkpoint's own instruction to "prefer avoiding schema expansion when one canonical
 * base key can identify all three assets." Safe to reinterpret with no migration and no backfill:
 * `logoStorageKey` was `null` for every existing row (Phase 7B's own architecture review confirmed
 * nothing had ever written to it), and the only other reader, `payslips.service.ts`'s
 * `PayslipCompany.logoStorageKey`, never dereferenced it as a literal key — it was carried through
 * unused.
 *
 * Object keys are opaque strings to `StorageProvider` (both implementations) — no extension is
 * needed on `original` for correctness; it is never served back to a client (see
 * `company-logo.service.ts`), only retained for archival purposes, so nothing needs to recover its
 * original content type from the key alone.
 */
export interface CompanyLogoObjectKeys {
  original: string;
  ui: string;
  print: string;
}

export function companyLogoObjectKeys(version: string): CompanyLogoObjectKeys {
  return {
    original: `company-assets/logo/${version}/original`,
    ui: `company-assets/logo/${version}/ui.png`,
    print: `company-assets/logo/${version}/print.png`,
  };
}
