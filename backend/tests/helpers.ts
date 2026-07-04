import argon2 from 'argon2';
import request, { type Response as SuperTestResponse } from 'supertest';
import type { Express } from 'express';
import { prisma } from '../src/lib/prisma';

/**
 * Deletes test data in FK-safe order. Deliberately scoped to rows this test suite itself creates
 * (by a recognizable email domain), never a blanket TRUNCATE — these tests may run against a
 * shared local Postgres instance that also has seed data (docs/architecture Phase 1 seed script)
 * that must survive a test run.
 *
 * AuditLog rows are deliberately NOT deleted: the table is append-only, enforced by a database
 * trigger that rejects DELETE outright (docs/architecture/data-and-storage.md §3) — deleting a
 * test User instead nulls those rows' actorUserId via the FK's documented ON DELETE SET NULL
 * action (docs/architecture/database-schema.md §16). Test assertions against AuditLog are
 * therefore scoped to the specific entityId each test created, never to an action name alone.
 * EmployeeTransferHistory is append-only by application-layer convention only (§8b — no DB
 * trigger), so test cleanup deleting its rows is the "direct database intervention" that
 * convention explicitly reserves; its RESTRICT FKs would otherwise block deleting test
 * employees, users, units, and sites.
 */
export async function cleanTestData(): Promise<void> {
  await prisma.employeeTransferHistory.deleteMany({
    where: {
      OR: [
        { employee: { site: { name: { startsWith: 'Test Site ' } } } },
        { transferredBy: { email: { endsWith: '@test.local' } } },
      ],
    },
  });
  await prisma.userSiteAssignment.deleteMany({ where: { user: { email: { endsWith: '@test.local' } } } });
  await prisma.employee.deleteMany({ where: { site: { name: { startsWith: 'Test Site ' } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } });
  await prisma.rolePermission.deleteMany({ where: { role: { code: { startsWith: 'TEST_' } } } });
  await prisma.role.deleteMany({ where: { code: { startsWith: 'TEST_' } } });
  await prisma.permission.deleteMany({ where: { key: { startsWith: 'test:' } } });
  await prisma.projectUnit.deleteMany({ where: { site: { name: { startsWith: 'Test Site ' } } } });
  await prisma.projectSite.deleteMany({ where: { name: { startsWith: 'Test Site ' } } });
  await prisma.bank.deleteMany({ where: { code: { startsWith: 'TB' } } });
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

/**
 * Creates a test user (optionally with site assignments), logs them in against a real running
 * `app`, and returns a session-persistent supertest agent plus the CSRF token every state-changing
 * request in the test must send back as the `x-csrf-token` header. This is the one login flow
 * every module's integration tests need, so it lives here rather than being re-derived per file.
 */
export async function createAuthenticatedAgent(
  app: Express,
  options: {
    email: string;
    password: string;
    roleCode: string;
    permissionKeys?: string[];
    siteIds?: string[];
  },
): Promise<{ agent: ReturnType<typeof request.agent>; csrfToken: string; userId: string }> {
  const user = await createTestUser(options);

  for (const siteId of options.siteIds ?? []) {
    await prisma.userSiteAssignment.create({ data: { userId: user.id, siteId } });
  }

  const agent = request.agent(app);
  const primeRes = await agent.get('/health');
  const csrfToken = extractCookie(primeRes, 'csrf_token');
  if (!csrfToken) throw new Error('Expected /health to issue a csrf_token cookie');

  const loginRes = await agent
    .post('/api/v1/auth/login')
    .set('x-csrf-token', csrfToken)
    .send({ email: options.email, password: options.password });

  if (loginRes.status !== 200) {
    throw new Error(`Test login failed with status ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
  }

  return { agent, csrfToken, userId: user.id };
}
