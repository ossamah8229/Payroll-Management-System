/**
 * Canonical-comparison helpers for Employee banking identifiers — same convention as
 * `normalizeCnic` (`shared/src/lib/cnic.ts`): a pure, side-effect-free normalization function used
 * identically everywhere a value is validated, looked up, or compared for uniqueness. Neither
 * function ever mutates the raw stored `accountNumber`/`iban` display value — they only produce
 * the canonical string used for duplicate-detection and the `accountNumberCanonical`/
 * `ibanCanonical` shadow columns (docs/architecture/database/employee.md).
 */

/** Strips all whitespace and uppercases (e.g. "pk36 abcd 0000 1234" -> "PK36ABCD00001234"). */
export function normalizeIban(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const stripped = raw.replace(/\s+/g, '').toUpperCase();
  return stripped === '' ? null : stripped;
}

/**
 * Uppercases and strips everything but letters/digits (e.g. "0110-79310689-03" ->
 * "011079310689 03" ... -> "01107931068903"). Cosmetic separators (spaces, hyphens) are treated as
 * non-significant for duplicate detection; the raw stored `accountNumber` keeps its original
 * formatting untouched — this canonical form is never shown to a user.
 */
export function normalizeAccountNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return stripped === '' ? null : stripped;
}
