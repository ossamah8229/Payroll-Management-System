import { z } from 'zod';

const emptyToNull = (val: unknown) => (val === '' ? null : val);

export const updateCompanySettingsSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(200),
  registeredAddress: z.preprocess(emptyToNull, z.string().trim().max(300).nullable().optional()),
  phone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
  email: z.preprocess(emptyToNull, z.string().trim().email('Enter a valid email address').nullable().optional()),
});

export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;
