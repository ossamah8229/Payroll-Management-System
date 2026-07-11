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
 * trigger that rejects DELETE outright (docs/architecture/system-conventions.md §3) — deleting a
 * test User instead nulls those rows' actorUserId via the FK's documented ON DELETE SET NULL
 * action (docs/architecture/database/audit-log.md §16). Test assertions against AuditLog are
 * therefore scoped to the specific entityId each test created, never to an action name alone.
 * EmployeeTransferHistory is append-only by application-layer convention only (§8b — no DB
 * trigger), so test cleanup deleting its rows is the "direct database intervention" that
 * convention explicitly reserves; its RESTRICT FKs would otherwise block deleting test
 * employees, users, units, and sites.
 *
 * PayrollEntry/PayrollCycle (Phase 3 Checkpoint 0 — no routes/service layer yet, so today's only
 * callers are direct-Prisma boundary tests) are scoped by a deliberately fake `year` (2900,
 * comfortably outside any real payroll year but a valid `smallint`) rather than a name/email
 * pattern, since neither table has a text column to prefix. PayrollEntryWorkLine is NOT deleted
 * explicitly — its `payrollEntryId` FK is `ON DELETE CASCADE` (§12a), so deleting the parent
 * PayrollEntry removes its work lines automatically. PayrollEntry must be deleted before
 * Employee/ProjectSite/Bank (all RESTRICT from PayrollEntry), and PayrollCycle before User (its
 * createdBy/releasedBy/archivedBy FKs are RESTRICT) — both ordered ahead of those deletes below.
 */
export async function cleanTestData(): Promise<void> {
  // Advances (Phase 4 Checkpoint 5, docs/architecture/database/advances.md §15/§15a) — all RESTRICT,
  // so deletion order matters: AdvanceScheduleChange references Advance/PayrollEntry/
  // ScheduledPayrollPeriod/User and must go first; PayrollEntry.advanceId/.eidAdvanceId reference
  // Advance, so PayrollEntry must be gone before Advance can be deleted; Advance/AdvanceScheduleChange
  // reference ScheduledPayrollPeriod, so that table is cleared only after both of those, and strictly
  // before PayrollCycle (ScheduledPayrollPeriod.payrollCycleId → PayrollCycle is also RESTRICT).
  // Scoped by the same fake year>=2900 convention as PayrollEntry/PayrollCycle below — every test in
  // this suite uses a year in that range, comfortably outside any real payroll year.
  await prisma.advanceScheduleChange.deleteMany({ where: { payrollEntry: { cycle: { year: { gte: 2900 } } } } });
  // PayrollUnitRelease (Phase 4 Checkpoint 2, docs/architecture/database/release.md §12b) is
  // RESTRICT on both cycleId (→ PayrollCycle) and unitId (→ ProjectUnit) — deleted before those,
  // scoped by the same fake year=2900 convention as PayrollEntry/PayrollCycle below (it has no
  // text column of its own to prefix).
  await prisma.payrollUnitRelease.deleteMany({ where: { cycle: { year: { gte: 2900 } } } });
  await prisma.payrollEntry.deleteMany({ where: { cycle: { year: { gte: 2900 } } } });
  await prisma.advance.deleteMany({ where: { employee: { site: { name: { startsWith: 'Test Site ' } } } } });
  await prisma.scheduledPayrollPeriod.deleteMany({ where: { year: { gte: 2900 } } });
  await prisma.payrollCycle.deleteMany({ where: { year: { gte: 2900 } } });
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
  // Task.assignedToUserId/.assignedByUserId are RESTRICT (docs/architecture/database/tasks.md §27),
  // so any task referencing a test user must be cleared before user.deleteMany below — same
  // FK-ordering discipline as EmployeeTransferHistory, above. TaskNotification rows cascade-delete
  // automatically with their parent Task (§27a), so no separate cleanup is needed for those.
  await prisma.task.deleteMany({
    where: {
      OR: [
        { assignedTo: { email: { endsWith: '@test.local' } } },
        { assignedBy: { email: { endsWith: '@test.local' } } },
      ],
    },
  });
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
