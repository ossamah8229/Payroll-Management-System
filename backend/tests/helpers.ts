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
  // BackupPackage/BackupPackageFile (Phase 5 Checkpoint 2, docs/architecture/database/
  // payroll-cycle.md §17-18) are both RESTRICT (cycleId → PayrollCycle, generatedBy → User) —
  // BackupPackageFile must go before BackupPackage (its own RESTRICT parent), and both strictly
  // before PayrollCycle/User below. Scoped by the same fake year>=2900 convention (neither table
  // has a text column of its own to prefix).
  //
  // PayrollCycle.archivedWithBackupPackageId (Phase 5 Checkpoint 3) is RESTRICT the other
  // direction — a cycle archived by rollover points at the specific BackupPackage that gated its
  // archive, so that pointer must be cleared before BackupPackage itself can be deleted below.
  await prisma.payrollCycle.updateMany({
    where: { year: { gte: 2900 } },
    data: { archivedWithBackupPackageId: null },
  });
  await prisma.backupPackageFile.deleteMany({ where: { backupPackage: { cycle: { year: { gte: 2900 } } } } });
  await prisma.backupPackage.deleteMany({ where: { cycle: { year: { gte: 2900 } } } });
  // Corrections & Balance Adjustments (Phase 6 Checkpoint 1, docs/architecture/database/
  // corrections.md §13/§13a, docs/architecture/database/balance-adjustments.md §14/§14a/§14b) — all
  // RESTRICT, so deletion order matters: `Correction.reversesCorrectionId` is a nullable
  // self-reference and must be cleared first (a reversal chain would otherwise block deleting the
  // row it points to); `BalanceAdjustmentSettlement`/`CorrectionPayment` both reference
  // `BalanceAdjustment` and must go before it; `BalanceAdjustment` references `Correction` and must
  // go before it; `CorrectionRequest` references `Correction` (`resultingCorrectionId`) and must
  // also go before it; `Correction`/`CorrectionRequest` both reference `PayrollEntry` and must be
  // gone before `payrollEntry.deleteMany` below. Scoped by the same fake year>=2900 convention as
  // every other table here with no text column of its own to prefix.
  await prisma.correction.updateMany({
    where: { payrollEntry: { cycle: { year: { gte: 2900 } } } },
    data: { reversesCorrectionId: null },
  });
  // BalanceAdjustmentMaterialization (Phase 6 Checkpoint 5, docs/architecture/database/
  // balance-adjustments.md — materialization reservation model) is RESTRICT on all three of
  // balanceAdjustmentId/payrollEntryId/cycleId, plus a nullable RESTRICT settlementId — deleted
  // before BalanceAdjustmentSettlement/BalanceAdjustment/PayrollEntry/PayrollCycle below. Scoped by
  // the same fake year>=2900 convention via its own cycle relation (no text column of its own to
  // prefix).
  await prisma.balanceAdjustmentMaterialization.deleteMany({ where: { cycle: { year: { gte: 2900 } } } });
  await prisma.balanceAdjustmentSettlement.deleteMany({ where: { cycle: { year: { gte: 2900 } } } });
  await prisma.correctionPayment.deleteMany({
    where: { balanceAdjustment: { correction: { payrollEntry: { cycle: { year: { gte: 2900 } } } } } },
  });
  await prisma.balanceAdjustment.deleteMany({ where: { correction: { payrollEntry: { cycle: { year: { gte: 2900 } } } } } });
  await prisma.correctionRequest.deleteMany({ where: { payrollEntry: { cycle: { year: { gte: 2900 } } } } });
  await prisma.correction.deleteMany({ where: { payrollEntry: { cycle: { year: { gte: 2900 } } } } });
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
  // Administration & Security Management Phase 1 (roles.test.ts) — a role created through the
  // real `POST /api/v1/roles` API gets an auto-generated `code` derived from its `name`
  // (roles.service.ts's `generateRoleCode`), which only starts with `TEST_` if the name itself
  // does. Test roles created through that API are named with a leading "Test " instead (same
  // convention as `Test Site `, below), so they're cleaned up by name rather than by the
  // `TEST_`-code convention the direct-DB `createTestUser` helper's own fixture roles use.
  await prisma.rolePermission.deleteMany({ where: { role: { name: { startsWith: 'Test ' } } } });
  await prisma.role.deleteMany({ where: { name: { startsWith: 'Test ' }, isSystemRole: false } });
  await prisma.permission.deleteMany({ where: { key: { startsWith: 'test:' } } });
  await prisma.projectUnit.deleteMany({ where: { site: { name: { startsWith: 'Test Site ' } } } });
  await prisma.projectSite.deleteMany({ where: { name: { startsWith: 'Test Site ' } } });
  await prisma.bank.deleteMany({ where: { code: { startsWith: 'TB' } } });
  // AdjustmentType (Phase 2 seed data + Phase 6 Checkpoint 1's own schema tests) — test-created
  // rows are scoped by a 'TEST_' code prefix, same convention as Role/Permission above; the 7
  // seeded production types (Attendance Correction, etc.) are never touched.
  await prisma.adjustmentType.deleteMany({ where: { code: { startsWith: 'TEST_' } } });
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

/** Phase 5 Checkpoint 4 security correction (2026-07-16) — keys that must never appear anywhere in
 * an HTTP JSON response body, checked recursively (not just at the top level, since a leak
 * typically hides inside a nested actor/relation object, exactly how the `passwordHash` defect this
 * checkpoint fixed was shaped — see `docs/architecture/system-conventions.md`'s "No raw Prisma
 * model" convention). Deliberately case-insensitive substring matching on the key name, not an
 * exact-match list, so a differently-cased or prefixed variant (`PasswordHash`, `userPasswordHash`)
 * still trips it. */
const DEFAULT_FORBIDDEN_RESPONSE_KEYS = ['passwordhash', 'session', 'csrf', 'storagekey', 'absolutepath'];

/**
 * Walks an arbitrary JSON-shaped value (a parsed HTTP response body) and throws if any object key,
 * at any depth, matches one of the forbidden substrings — case-insensitively. Used to prove a
 * response is free of a known-sensitive field class (password hashes, session/CSRF secrets,
 * storage keys, filesystem paths) without having to enumerate every possible nesting path by hand,
 * and without false-positiving on legitimate domain identifiers (a `siteId`/`cycleId`/`userId`
 * field name doesn't contain any forbidden substring, so it's untouched).
 */
export function assertNoSensitiveKeys(value: unknown, extraForbiddenKeys: string[] = [], path = '$'): void {
  const forbidden = [...DEFAULT_FORBIDDEN_RESPONSE_KEYS, ...extraForbiddenKeys.map((key) => key.toLowerCase())];

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, extraForbiddenKeys, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      const hit = forbidden.find((forbiddenKey) => normalizedKey.includes(forbiddenKey));
      if (hit) {
        throw new Error(
          `assertNoSensitiveKeys: forbidden key "${key}" (matches "${hit}") found at ${path}.${key}`,
        );
      }
      assertNoSensitiveKeys(nested, extraForbiddenKeys, `${path}.${key}`);
    }
  }
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

  // Checkpoint 4D: a successful login rotates the CSRF token (`rotateCsrfCookie`,
  // `backend/src/common/middleware/csrf.ts`), so every subsequent authenticated request in the
  // caller's test must use the *rotated* token from this response, not the pre-login one above.
  const rotatedCsrfToken = extractCookie(loginRes, 'csrf_token');
  if (!rotatedCsrfToken) throw new Error('Expected a successful login to rotate the csrf_token cookie');

  return { agent, csrfToken: rotatedCsrfToken, userId: user.id };
}
