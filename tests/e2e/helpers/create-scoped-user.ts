import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { DATABASE_URL } from '../setup/config';

/**
 * Creates a user whose role holds exactly `permissionKeys` — nothing more, nothing less — direct
 * against the E2E database via Prisma, the same technique `backend/tests/helpers.ts`'s
 * `createTestUser` already uses for the integration suite. No route on the real API can produce an
 * arbitrary permission combination (`POST /api/v1/users` only accepts an already-seeded
 * `roleCode` — `MASTER_ADMIN`/`PAYROLL_STAFF`/`FINANCE`), so a spec that needs a user shaped
 * differently than any of those three seeded roles (e.g. Phase 6 Checkpoint 6A's "reviewer-only"
 * user: `corrections:approve` without `payroll:entry`) has no other way to construct one. Login
 * itself still goes through the real form (`fixtures/auth.ts`'s `login`) — only user *creation*
 * bypasses the UI/API here, exactly as the integration suite's own precedent does. No cleanup is
 * needed: this harness's entire database is disposable and torn down after the run
 * (`tests/e2e/setup/e2e-environment.ts`), unlike `backend/tests/helpers.ts`'s `cleanTestData`,
 * which exists only because that suite reuses a persistent local database across runs.
 */
export async function createScopedUser(options: {
  email: string;
  password: string;
  roleCode: string;
  permissionKeys: string[];
  name?: string;
  /** Site-scoped visibility (`assertSiteAccess`/site-filtered list queries, e.g.
   * `listCorrectionRequestsForUser`) applies to every non-`MASTER_ADMIN` role uniformly — a
   * reviewer role needs the same explicit `UserSiteAssignment` rows a Payroll Staff/Finance test
   * user would, or every site-scoped list query correctly returns nothing for them. */
  siteIds?: string[];
}): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  try {
    const role = await prisma.role.upsert({
      where: { code: options.roleCode },
      update: {},
      create: { code: options.roleCode, name: options.roleCode },
    });

    for (const key of options.permissionKeys) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }

    const passwordHash = await argon2.hash(options.password);
    const user = await prisma.user.create({
      data: {
        email: options.email,
        passwordHash,
        name: options.name ?? 'E2E Scoped User',
        roleId: role.id,
        isActive: true,
      },
    });

    for (const siteId of options.siteIds ?? []) {
      await prisma.userSiteAssignment.create({ data: { userId: user.id, siteId } });
    }
  } finally {
    await prisma.$disconnect();
  }
}
