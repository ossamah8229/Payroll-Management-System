import { z } from 'zod';

/** Forms commonly submit an empty string for a cleared optional field; treat that as null. */
export const emptyToNull = (val: unknown) => (val === '' ? null : val);

/** For non-nullable-but-optional-with-a-default fields: an empty string means "use the default". */
export const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

export const optionalTrimmedString = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

/** Same shape as `optionalTrimmedString`, uppercased — the single implementation of "trimmed,
 * optional, stored uppercase" (currently just `iban`, Employee/PayrollEntry banking refinement) so
 * a future uppercase-stored identifier never redefines the same transform inline. */
export const optionalUppercaseString = (max: number) =>
  z.preprocess(
    (val) => emptyToNull(typeof val === 'string' ? val.trim().toUpperCase() : val),
    z.string().max(max).nullable().optional(),
  );

/** numeric(12,2)/numeric(10,2)-safe: transported as a decimal string, never a float, per Principle 5.
 * The single implementation of this pattern — every schema that validates a monetary or
 * decimal-precision figure (Employee, Payroll Entry, Payroll Entry Work Line, and any future
 * module with a `numeric(...)` column) imports this rather than redefining an equivalent regex. */
export const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a valid amount (up to 2 decimal places)');

export const optionalDate = z.preprocess(emptyToNull, z.string().date().nullable().optional());
