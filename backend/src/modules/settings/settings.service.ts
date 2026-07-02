import type { UpdateCompanySettingsInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../common/http-error';

/** Fixed, well-known PK — must match the row the seed script creates (docs/architecture/database-schema.md §19). */
const COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

export async function getCompanySettings() {
  const settings = await prisma.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });

  if (!settings) {
    throw notFound('Company settings have not been seeded yet');
  }

  return settings;
}

export async function updateCompanySettings(userId: string, input: UpdateCompanySettingsInput) {
  return prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: {
      companyName: input.companyName,
      registeredAddress: input.registeredAddress ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      updatedById: userId,
    },
  });
}
