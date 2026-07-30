import type { UpdateCompanySettingsInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../common/http-error';

/** Fixed, well-known PK — must match the row the seed script creates (docs/architecture/database/access-control.md §19). */
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

/**
 * The one place `logoStorageKey` is stripped before a `CompanySettings` row ever crosses the HTTP
 * boundary (Phase 7C's own explicit requirement: "do not return storage keys to the frontend") —
 * every settings route response (`GET`/`PATCH /company`, the logo upload/remove routes) goes
 * through this, mirroring `backup-packages.routes.ts`'s own `serializeBackupPackage` doing the same
 * for `storageKey`. `hasLogo` is all a client needs to know — whether to render the real `<img>`
 * (via the public `/company/logo/ui` route) or fall back to `LogoPlaceholder`.
 */
export function serializeCompanySettings<T extends { logoStorageKey: string | null }>(
  settings: T,
): Omit<T, 'logoStorageKey'> & { hasLogo: boolean } {
  const { logoStorageKey, ...rest } = settings;
  return { ...rest, hasLogo: logoStorageKey !== null };
}
