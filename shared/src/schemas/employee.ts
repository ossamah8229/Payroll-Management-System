import { z } from 'zod';

/** Forms commonly submit an empty string for a cleared optional field; treat that as null. */
const emptyToNull = (val: unknown) => (val === '' ? null : val);

/** For non-nullable-but-optional-with-a-default fields: an empty string means "use the default". */
const emptyToUndefined = (val: unknown) => (val === '' ? undefined : val);

const optionalTrimmedString = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

/** numeric(12,2)/numeric(10,2)-safe: transported as a decimal string, never a float, per Principle 5. */
const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a valid amount (up to 2 decimal places)');

const optionalDate = z.preprocess(emptyToNull, z.string().date().nullable().optional());

export const createEmployeeSchema = z.object({
  employeeCode: optionalTrimmedString(30),
  cnic: z.preprocess(
    emptyToNull,
    z
      .string()
      .trim()
      .regex(/^\d{13}$/, 'CNIC must be exactly 13 digits')
      .nullable()
      .optional(),
  ),
  name: z.string().trim().min(1, 'Name is required').max(160),
  fatherName: optionalTrimmedString(160),
  religion: optionalTrimmedString(40),
  dateOfBirth: optionalDate,
  mobileNumber: optionalTrimmedString(20),
  designation: z.string().trim().min(1, 'Designation is required').max(80),
  siteId: z.string().uuid('A project site is required'),
  unitId: z.string().uuid('A project unit is required'),
  dateOfJoining: optionalDate,
  payType: z.enum(['DAILY_WAGE', 'MONTHLY']).optional(),
  grossPay: decimalString,
  bankId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  branchCode: optionalTrimmedString(20),
  accountNumber: optionalTrimmedString(40),
  accountTitle: optionalTrimmedString(160),
  defaultEobiAmount: z.preprocess(emptyToUndefined, decimalString.optional()),
  defaultEobiApplicable: z.boolean().optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/**
 * The three `transfer*` fields only apply when this update also changes `siteId`/`unitId` (a
 * transfer, docs/architecture/database-schema.md §8b) — they're accepted here rather than via a
 * separate endpoint because a transfer is detected implicitly by comparing the employee's current
 * site/unit against the submitted one, the same way an ordinary field edit is. Ignored by the
 * service layer when no transfer is actually happening.
 */
export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  /** Defaults to today (server-side) if a transfer occurs and this isn't provided. */
  transferEffectiveDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  transferReason: optionalTrimmedString(500),
  transferRemarks: optionalTrimmedString(500),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/** The dedicated "employee has left" action (docs/architecture/database-schema.md §9) — presence
 * of `dateOfLeaving` is what drives active-employee filtering, so setting it is a distinct,
 * intentional action rather than an incidental field on a general update. */
export const markEmployeeLeftSchema = z.object({
  dateOfLeaving: z.string().date(),
});

export type MarkEmployeeLeftInput = z.infer<typeof markEmployeeLeftSchema>;
