import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assertNoSensitiveKeys, cleanTestData, createAuthenticatedAgent, extractCookie } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

describe('User Management', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.USERS_MANAGE],
    });
  }

  async function makeSite(name: string) {
    return prisma.projectSite.create({ data: { name } });
  }

  /** Administration & Security Management Phase 1 — `POST/PATCH /api/v1/users` now take a real
   * `roleId`, not a `roleCode` enum value. Every seeded role's id is looked up once per call
   * rather than cached across tests, since `cleanTestData` never touches real seeded roles
   * (they're not `TEST_`-prefixed) but this keeps each test's own intent self-contained. */
  async function payrollStaffRoleId(): Promise<string> {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.PAYROLL_STAFF } });
    return role.id;
  }

  it('lets Master Admin create a Payroll Staff account with site assignments', async () => {
    const site = await makeSite('Test Site Users Create');
    const { agent, csrfToken } = await masterAdminAgent('users-create-admin@test.local');

    const res = await agent
      .post('/api/v1/users')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'New Payroll Staffer',
        email: 'new-staffer@test.local',
        password: 'AnotherPassword1!',
        roleId: await payrollStaffRoleId(),
        siteIds: [site.id],
      });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new-staffer@test.local');
    expect(res.body.user.siteAssignments).toHaveLength(1);
    expect(res.body.user.siteAssignments[0].siteId).toBe(site.id);

    const entries = await prisma.auditLog.findMany({ where: { action: 'user.created' } });
    expect(entries.some((entry) => entry.entityId === res.body.user.id)).toBe(true);
  });

  it('rejects all user-management routes for a user without users:manage', async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'users-unauthorized@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [],
    });

    const listRes = await agent.get('/api/v1/users');
    expect(listRes.status).toBe(403);

    const createRes = await agent
      .post('/api/v1/users')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'X', email: 'x@test.local', password: 'SomePassword1!', roleId: await payrollStaffRoleId() });
    expect(createRes.status).toBe(403);
  });

  it('lets Master Admin replace a Payroll Staff user\'s site assignments', async () => {
    const siteA = await makeSite('Test Site Users Reassign A');
    const siteB = await makeSite('Test Site Users Reassign B');
    const { agent, csrfToken } = await masterAdminAgent('users-reassign-admin@test.local');

    const createRes = await agent
      .post('/api/v1/users')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Reassign Target',
        email: 'reassign-target@test.local',
        password: 'AnotherPassword1!',
        roleId: await payrollStaffRoleId(),
        siteIds: [siteA.id],
      });

    const updateRes = await agent
      .patch(`/api/v1/users/${createRes.body.user.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ siteIds: [siteB.id] });

    expect(updateRes.status).toBe(200);
    const siteIds = updateRes.body.user.siteAssignments.map((a: { siteId: string }) => a.siteId);
    expect(siteIds).toEqual([siteB.id]);
  });

  it('blocks a Master Admin from deactivating their own account', async () => {
    const { agent, csrfToken, userId } = await masterAdminAgent('users-self-deactivate@test.local');

    const res = await agent
      .patch(`/api/v1/users/${userId}`)
      .set('x-csrf-token', csrfToken)
      .send({ isActive: false });

    expect(res.status).toBe(400);
  });

  it(
    'deactivating another user invalidates their session immediately, matching the same guarantee ' +
      'proven for self-deactivation in Phase 1',
    async () => {
      const { agent: adminAgent, csrfToken } = await masterAdminAgent('users-deactivate-admin@test.local');

      const target = await createAuthenticatedAgent(app, {
        email: 'users-deactivate-target@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [],
      });

      expect((await target.agent.get('/api/v1/auth/me')).status).toBe(200);

      const deactivateRes = await adminAgent
        .patch(`/api/v1/users/${target.userId}`)
        .set('x-csrf-token', csrfToken)
        .send({ isActive: false });
      expect(deactivateRes.status).toBe(200);

      const meRes = await target.agent.get('/api/v1/auth/me');
      expect(meRes.status).toBe(401);
    },
  );

  it("lets Master Admin reset another user's password", async () => {
    const { agent, csrfToken } = await masterAdminAgent('users-reset-admin@test.local');

    const createRes = await agent
      .post('/api/v1/users')
      .set('x-csrf-token', csrfToken)
      .send({
        name: 'Reset Target',
        email: 'reset-target@test.local',
        password: 'OriginalPassword1!',
        roleId: await payrollStaffRoleId(),
      });

    const resetRes = await agent
      .post(`/api/v1/users/${createRes.body.user.id}/reset-password`)
      .set('x-csrf-token', csrfToken)
      .send({ newPassword: 'BrandNewPassword1!' });
    expect(resetRes.status).toBe(204);

    const loginRes = await agent
      .post('/api/v1/auth/login')
      .set('x-csrf-token', csrfToken)
      .send({ email: 'reset-target@test.local', password: 'BrandNewPassword1!' });
    expect(loginRes.status).toBe(200);
  });

  describe('AUD-009: session revocation on admin-triggered password reset', () => {
    async function loginAgent(email: string, password: string) {
      const agent = request.agent(app);
      const primeRes = await agent.get('/health');
      const csrfToken = extractCookie(primeRes, 'csrf_token');
      if (!csrfToken) throw new Error('Expected /health to issue a csrf_token cookie');
      const loginRes = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrfToken).send({ email, password });
      if (loginRes.status !== 200) {
        throw new Error(`Test login failed with status ${loginRes.status}: ${JSON.stringify(loginRes.body)}`);
      }
      return { agent, csrfToken };
    }

    it(
      "invalidates every existing session for the target user (a second browser session included), " +
        'leaves the acting Master Admin authenticated, and requires the new password to log back in',
      async () => {
        const { agent: adminAgent, csrfToken } = await masterAdminAgent('users-reset-sessions-admin@test.local');

        const createRes = await adminAgent
          .post('/api/v1/users')
          .set('x-csrf-token', csrfToken)
          .send({
            name: 'Reset Sessions Target',
            email: 'reset-sessions-target@test.local',
            password: 'OriginalPassword1!',
            roleId: await payrollStaffRoleId(),
          });
        expect(createRes.status).toBe(201);
        const targetId = createRes.body.user.id;

        const targetSessionA = await loginAgent('reset-sessions-target@test.local', 'OriginalPassword1!');
        const targetSessionB = await loginAgent('reset-sessions-target@test.local', 'OriginalPassword1!');

        expect((await targetSessionA.agent.get('/api/v1/auth/me')).status).toBe(200);
        expect((await targetSessionB.agent.get('/api/v1/auth/me')).status).toBe(200);

        const resetRes = await adminAgent
          .post(`/api/v1/users/${targetId}/reset-password`)
          .set('x-csrf-token', csrfToken)
          .send({ newPassword: 'BrandNewPassword1!' });
        expect(resetRes.status).toBe(204);

        // Both of the target's own sessions ("second browser session" included) are invalidated.
        expect((await targetSessionA.agent.get('/api/v1/auth/me')).status).toBe(401);
        expect((await targetSessionB.agent.get('/api/v1/auth/me')).status).toBe(401);

        // The acting Master Admin's own session is untouched — resetting someone else's password
        // never invalidates an unrelated user's (here, the admin's own) session.
        expect((await adminAgent.get('/api/v1/auth/me')).status).toBe(200);

        // Old password no longer works.
        const oldPasswordAgent = request.agent(app);
        const oldPasswordPrimeRes = await oldPasswordAgent.get('/health');
        const oldPasswordCsrf = extractCookie(oldPasswordPrimeRes, 'csrf_token')!;
        const oldLoginRes = await oldPasswordAgent
          .post('/api/v1/auth/login')
          .set('x-csrf-token', oldPasswordCsrf)
          .send({ email: 'reset-sessions-target@test.local', password: 'OriginalPassword1!' });
        expect(oldLoginRes.status).toBe(401);

        // New password logs in successfully.
        const newSession = await loginAgent('reset-sessions-target@test.local', 'BrandNewPassword1!');
        expect((await newSession.agent.get('/api/v1/auth/me')).status).toBe(200);

        // Audit behavior unchanged: exactly one password-reset entry, attributed to the admin.
        const entries = await prisma.auditLog.findMany({
          where: { action: 'user.password-reset', entityId: targetId },
        });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.actorUserId).not.toBe(targetId);
      },
    );

    it('also invalidates the acting Master Admin\'s own session when they reset their own password', async () => {
      const { agent, csrfToken, userId } = await masterAdminAgent('users-reset-self-admin@test.local');

      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);

      const resetRes = await agent
        .post(`/api/v1/users/${userId}/reset-password`)
        .set('x-csrf-token', csrfToken)
        .send({ newPassword: 'BrandNewSelfPassword1!' });
      expect(resetRes.status).toBe(204);

      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });
  });

  describe('response serialization security (Phase 5 Checkpoint 4 correction, 2026-07-16)', () => {
    /** The confirmed defect: `listUsers`/`getUser`/`createUser`/`updateUser` previously returned
     * the raw Prisma `User` row — including `passwordHash` — straight into the HTTP response. Fixed
     * by an explicit `select` + DTO assembly in `users.service.ts` (`toUserSummary`); these tests
     * pin that fix against every route that touches a `User` row's own response shape. */
    it('never includes passwordHash (or any other forbidden key) in the create response', async () => {
      const site = await makeSite('Test Site Users Security Create');
      const { agent, csrfToken } = await masterAdminAgent('users-security-create-admin@test.local');

      const res = await agent
        .post('/api/v1/users')
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'Security Check User',
          email: 'security-check-create@test.local',
          password: 'AnotherPassword1!',
          roleId: await payrollStaffRoleId(),
          siteIds: [site.id],
        });

      expect(res.status).toBe(201);
      expect(() => assertNoSensitiveKeys(res.body)).not.toThrow();
      // Direct assertion too, not only the generic recursive walk — makes the specific defect this
      // checkpoint fixed impossible to silently regress even if the generic helper's key list ever
      // changes.
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.user.role).toEqual({
        id: expect.any(String),
        code: ROLE_CODES.PAYROLL_STAFF,
        name: expect.any(String),
      });
    });

    it('never includes passwordHash in the list or single-user detail response', async () => {
      const { agent, csrfToken } = await masterAdminAgent('users-security-list-admin@test.local');
      await agent
        .post('/api/v1/users')
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'Security List Target',
          email: 'security-check-list@test.local',
          password: 'AnotherPassword1!',
          roleId: await payrollStaffRoleId(),
        });

      const listRes = await agent.get('/api/v1/users');
      expect(listRes.status).toBe(200);
      expect(() => assertNoSensitiveKeys(listRes.body)).not.toThrow();

      const targetId = listRes.body.users.find(
        (user: { email: string }) => user.email === 'security-check-list@test.local',
      ).id;
      const detailRes = await agent.get(`/api/v1/users/${targetId}`);
      expect(detailRes.status).toBe(200);
      expect(() => assertNoSensitiveKeys(detailRes.body)).not.toThrow();
      expect(detailRes.body.user.passwordHash).toBeUndefined();
    });

    it('never includes passwordHash in the update response', async () => {
      const { agent, csrfToken } = await masterAdminAgent('users-security-update-admin@test.local');
      const createRes = await agent
        .post('/api/v1/users')
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'Security Update Target',
          email: 'security-check-update@test.local',
          password: 'AnotherPassword1!',
          roleId: await payrollStaffRoleId(),
        });

      const updateRes = await agent
        .patch(`/api/v1/users/${createRes.body.user.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Renamed Security Update Target' });

      expect(updateRes.status).toBe(200);
      expect(() => assertNoSensitiveKeys(updateRes.body)).not.toThrow();
    });

    it('database-level confirmation: the raw stored passwordHash is a real argon2 hash, never returned by any route', async () => {
      const { agent, csrfToken } = await masterAdminAgent('users-security-dbcheck-admin@test.local');
      const createRes = await agent
        .post('/api/v1/users')
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'DB Check Target',
          email: 'security-check-dbcheck@test.local',
          password: 'AnotherPassword1!',
          roleId: await payrollStaffRoleId(),
        });

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: createRes.body.user.id } });
      expect(stored.passwordHash).toMatch(/^\$argon2/);
      expect(JSON.stringify(createRes.body)).not.toContain(stored.passwordHash);
    });
  });
});
