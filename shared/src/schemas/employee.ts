import { z } from 'zod';
import { normalizeCnic } from '../lib/cnic';
import { decimalString, emptyToNull, emptyToUndefined, optionalDate, optionalTrimmedString } from './common';

/** Strips non-digit characters (e.g. a "#####-#######-#" formatted CNIC) before validating, not
 * just before storing — docs/architecture/database-schema.md §26 item 6. Applied here, once, so
 * the create/update routes and CSV/Excel import (which all parse through this schema) normalize
 * identically. */
const normalizeCnicInput = (val: unknown) => (typeof val === 'string' ? normalizeCnic(val) : val);

export const createEmployeeSchema = z.object({
  employeeCode: optionalTrimmedString(30),
  cnic: z.preprocess(
    (val) => emptyToNull(normalizeCnicInput(val)),
    z
      .string()
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
