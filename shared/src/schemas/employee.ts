import { z } from 'zod';
import { normalizeCnic } from '../lib/cnic';
import {
  decimalString,
  emptyToNull,
  emptyToUndefined,
  optionalDate,
  optionalTrimmedString,
  optionalUppercaseString,
} from './common';

/** Strips non-digit characters (e.g. a "#####-#######-#" formatted CNIC) before validating, not
 * just before storing — docs/architecture/database/schema-invariants.md §26 item 6. Applied here, once, so
 * the create/update routes and CSV/Excel import (which all parse through this schema) normalize
 * identically. */
const normalizeCnicInput = (val: unknown) => (typeof val === 'string' ? normalizeCnic(val) : val);

/**
 * Canonical field-length/format limits for `Employee` — the single source every consumer that
 * needs to know "how long can this field be" reads from, rather than redefining the same number.
 * Each value mirrors the matching `@db.VarChar(n)` column in `backend/prisma/schema.prisma`
 * exactly (see the comment on each constant); `employeeObjectSchema` below is the only place that
 * enforces them at the API boundary, and the Employee Registry import template (Import Templates
 * checkpoint, `employees-import-export.service.ts`'s `EMPLOYEE_TEMPLATE_COLUMN_NOTES`/Excel
 * `dataValidation`) imports these same constants for its own text-length validation and
 * "Column Guide" documentation, so the template can never silently drift from what the API/database
 * actually accept.
 */
export const EMPLOYEE_FIELD_LIMITS = {
  /** `Employee.employeeCode @db.VarChar(30)` */
  employeeCode: 30,
  /** Normalized (digits-only) CNIC length — `/^\d{13}$/` below; the column itself is
   * `@db.VarChar(15)`, sized for the widest thing anyone has ever pasted in, but 13 digits is the
   * only value this schema ever accepts or stores. */
  cnic: 13,
  /** `Employee.name @db.VarChar(160)` */
  name: 160,
  /** `Employee.fatherName @db.VarChar(160)` */
  fatherName: 160,
  /** `Employee.religion @db.VarChar(40)` */
  religion: 40,
  /** `Employee.mobileNumber @db.VarChar(20)` */
  mobileNumber: 20,
  /** `Employee.designation @db.VarChar(80)` */
  designation: 80,
  /** `ProjectUnit.code @db.VarChar(20)` — the Employee Registry template's "Branch Code" column
   * (the employee's Project Unit code, not `branchCode` below). */
  unitCode: 20,
  /** `Employee.branchCode @db.VarChar(20)` — the employee's own bank branch code. */
  bankBranchCode: 20,
  /** `Employee.accountNumber @db.VarChar(40)` */
  accountNumber: 40,
  /** `Employee.iban @db.VarChar(34)` — ISO 13616 international maximum. */
  iban: 34,
} as const;

/** `Employee.grossPay @db.Decimal(12, 2)`: up to 10 integer digits, 2 decimal places (matches
 * `decimalString`'s `\d{1,10}(\.\d{1,2})?` pattern) — the widest value the column can store. */
export const EMPLOYEE_GROSS_PAY_MAX = 9_999_999_999.99;
/** `Employee.defaultEobiAmount @db.Decimal(10, 2)`: up to 8 integer digits, 2 decimal places. */
export const EMPLOYEE_EOBI_AMOUNT_MAX = 99_999_999.99;

/** `Employee.payType` (Prisma `PayType` enum) values and their display labels — the single source
 * for the create/edit form's dropdown, this schema's own `z.enum`, and the Employee Registry
 * import template's "Pay Type" column dropdown, so the three can never present different option
 * sets. */
export const PAY_TYPE_VALUES = ['DAILY_WAGE', 'MONTHLY'] as const;
export type PayTypeValue = (typeof PAY_TYPE_VALUES)[number];
export const PAY_TYPE_LABELS: Record<PayTypeValue, string> = {
  DAILY_WAGE: 'Daily Wage',
  MONTHLY: 'Monthly',
};

/** The plain object shape, kept separate from `createEmployeeSchema`'s cross-field refinement below
 * so `updateEmployeeSchema` can still call `.partial()` on it directly — `.partial()` is only
 * defined on a `ZodObject`, not on the `ZodEffects` a `.superRefine()` produces. */
const employeeObjectSchema = z.object({
  employeeCode: optionalTrimmedString(EMPLOYEE_FIELD_LIMITS.employeeCode),
  cnic: z.preprocess(
    (val) => emptyToNull(normalizeCnicInput(val)),
    z
      .string()
      .regex(/^\d{13}$/, 'CNIC must be exactly 13 digits')
      .nullable()
      .optional(),
  ),
  name: z.string().trim().min(1, 'Name is required').max(EMPLOYEE_FIELD_LIMITS.name),
  fatherName: optionalTrimmedString(EMPLOYEE_FIELD_LIMITS.fatherName),
  religion: optionalTrimmedString(EMPLOYEE_FIELD_LIMITS.religion),
  dateOfBirth: optionalDate,
  mobileNumber: optionalTrimmedString(EMPLOYEE_FIELD_LIMITS.mobileNumber),
  designation: z.string().trim().min(1, 'Designation is required').max(EMPLOYEE_FIELD_LIMITS.designation),
  siteId: z.string().uuid('A project site is required'),
  unitId: z.string().uuid('A project unit is required'),
  dateOfJoining: optionalDate,
  payType: z.enum(PAY_TYPE_VALUES).optional(),
  grossPay: decimalString,
  bankId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  branchCode: optionalTrimmedString(EMPLOYEE_FIELD_LIMITS.bankBranchCode),
  accountNumber: optionalTrimmedString(EMPLOYEE_FIELD_LIMITS.accountNumber),
  /** Banking refinement (2026-07-11): replaces `accountTitle`, which is no longer stored anywhere
   * — the account holder is always the employee's own `name`. Optional; never required, since many
   * employees operationally don't know or provide it. */
  iban: optionalUppercaseString(EMPLOYEE_FIELD_LIMITS.iban),
  defaultEobiAmount: z.preprocess(emptyToUndefined, decimalString.optional()),
  defaultEobiApplicable: z.boolean().optional(),
});

/** Banking rule (2026-07-11): a bank employee (`bankId` set) must have an Account Number on file —
 * a cash employee (no `bankId`) is defined entirely by the *absence* of banking details. Checked
 * here, at creation, where the full record is always present in one submission; `updateEmployee`
 * enforces the same rule server-side against the merged post-update state, since an update is a
 * partial patch and cannot be validated by shape alone (see `employees.service.ts`). */
export const createEmployeeSchema = employeeObjectSchema.superRefine((data, ctx) => {
  if (data.bankId && !data.accountNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Account Number is required when a bank is selected',
      path: ['accountNumber'],
    });
  }
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/**
 * The three `transfer*` fields only apply when this update also changes `siteId`/`unitId` (a
 * transfer, docs/architecture/database/employee.md §8b) — they're accepted here rather than via a
 * separate endpoint because a transfer is detected implicitly by comparing the employee's current
 * site/unit against the submitted one, the same way an ordinary field edit is. Ignored by the
 * service layer when no transfer is actually happening.
 */
export const updateEmployeeSchema = employeeObjectSchema.partial().extend({
  /** Defaults to today (server-side) if a transfer occurs and this isn't provided. */
  transferEffectiveDate: z.preprocess(emptyToNull, z.string().date().nullable().optional()),
  transferReason: optionalTrimmedString(500),
  transferRemarks: optionalTrimmedString(500),
});

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/** The dedicated "employee has left" action (docs/architecture/database/employee.md §9) — presence
 * of `dateOfLeaving` is what drives active-employee filtering, so setting it is a distinct,
 * intentional action rather than an incidental field on a general update. */
export const markEmployeeLeftSchema = z.object({
  dateOfLeaving: z.string().date(),
});

export type MarkEmployeeLeftInput = z.infer<typeof markEmployeeLeftSchema>;
