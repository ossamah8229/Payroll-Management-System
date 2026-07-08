import { decimalString } from '@payroll/shared';

/**
 * Whether a currently-typed decimal draft value is complete/valid enough to send to the server —
 * reuses the exact same `decimalString` Zod schema the backend enforces (`updatePayrollEntrySchema`/
 * `updateWorkLineSchema`), so there is exactly one definition of "a valid decimal string," never a
 * second, potentially-drifting regex on the frontend.
 *
 * An incomplete value while the user is still typing (`""`, `"-"`, `"."`, `"0."`) is expected and
 * must never be sent — for a nullable field (OT Rate, Leave Rate) an empty string is itself valid
 * (means "auto"); for every other numeric field, empty is not yet a value to save.
 */
export function isValidDecimalDraft(value: string, nullable: boolean): boolean {
  if (value === '') return nullable;
  return decimalString.safeParse(value).success;
}

/** Cycle Days is a plain integer 1–31 (docs/architecture/database/payroll-entry.md §12a), not a decimal
 * string — validated and parsed together so an incomplete/out-of-range value is never sent, the
 * same "gate at commit time, never at keystroke" pattern as the decimal fields use. */
export function parseValidCycleDays(value: string): number | undefined {
  if (!/^\d{1,2}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 && n <= 31 ? n : undefined;
}
