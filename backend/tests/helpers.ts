import argon2 from 'argon2';
import type { Response as SuperTestResponse } from 'supertest';
import { prisma } from '../src/lib/prisma';

/**
 * Deletes test data in FK-safe order. Deliberately scoped to rows this test suite itself creates
 * (by a recognizable email domain), never a blanket TRUNCATE — these tests may run against a
 * shared local Postgres instance that also has seed data (docs/architecture Phase 1 seed script)
 * that must survive a test run.
 */
export async function cleanTestData(): Promise<void> {
  await prisma.userSiteAssignment.deleteMany({ where: { user: { email: { endsWith: '@test.local' } } } });
  await prisma.auditLog.deleteMany({ where: { actor: { email: { endsWith: '@test.local' } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } });
  await prisma.rolePermission.deleteMany({ where: { role: { code: { startsWith: 'TEST_' } } } });
  await prisma.role.deleteMany({ where: { code: { startsWith: 'TEST_' } } });
  await prisma.permission.deleteMany({ where: { key: { startsWith: 'test:' } } });
  await prisma.projectSite.deleteMany({ where: { name: { startsWith: 'Test Site ' } } });
}

export async function createTestUser(options: {
  email: string;
  password: string;
  roleCode: string;
  permissionKeys?: string[];
  isActive?: boolean;
}) {
  const role = await prisma.role.upsert({
    where: { code: options.roleCode },
    update: {},
    create: { code: options.roleCode, name: options.roleCode },
  });

  for (const key of options.permissionKeys ?? []) {
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

  return prisma.user.create({
    data: {
      email: options.email,
      passwordHash,
      name: 'Test User',
      roleId: role.id,
      isActive: options.isActive ?? true,
    },
  });
}

/** Extracts a named cookie's value from a supertest response's Set-Cookie header. */
export function extractCookie(res: SuperTestResponse, name: string): string | undefined {
  const setCookie = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return undefined;
  const value = match.split(';')[0]?.split('=')[1];
  return value ? decodeURIComponent(value) : undefined;
}
