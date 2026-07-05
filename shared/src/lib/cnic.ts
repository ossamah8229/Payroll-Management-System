/**
 * Strips everything but digits from a CNIC (e.g. "12345-1234567-1" -> "1234512345671"). Used
 * identically wherever a CNIC is validated or looked up (docs/architecture/database-schema.md §26
 * item 6) — the Zod schema's preprocess step, the duplicate-check endpoint, and the frontend's
 * debounced availability check all call this instead of re-implementing the strip themselves.
 */
export function normalizeCnic(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, '');
  return digits === '' ? null : digits;
}
