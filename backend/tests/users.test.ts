import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

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
        roleCode: ROLE_CODES.PAYROLL_STAFF,
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
      .send({ name: 'X', email: 'x@test.local', password: 'SomePassword1!', roleCode: ROLE_CODES.PAYROLL_STAFF });
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
        roleCode: ROLE_CODES.PAYROLL_STAFF,
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
        roleCode: ROLE_CODES.PAYROLL_STAFF,
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
});
