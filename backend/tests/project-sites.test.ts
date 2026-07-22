import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

describe('Project Sites', () => {
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
      permissionKeys: [PERMISSIONS.SITES_MANAGE],
    });
  }

  it('lets Master Admin create a project site', async () => {
    const { agent, csrfToken } = await masterAdminAgent('sites-create@test.local');

    const res = await agent
      .post('/api/v1/sites')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Test Site Alpha' });

    expect(res.status).toBe(201);
    expect(res.body.site.name).toBe('Test Site Alpha');
    expect(res.body.site.isActive).toBe(true);

    const entries = await prisma.auditLog.findMany({ where: { action: 'project-site.created' } });
    expect(entries.some((entry) => entry.entityId === res.body.site.id)).toBe(true);
  });

  it('rejects site creation from a user without sites:manage', async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'sites-unauthorized@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [],
    });

    const res = await agent
      .post('/api/v1/sites')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Test Site Should Not Exist' });

    expect(res.status).toBe(403);
  });

  it('rejects a duplicate site name with 409', async () => {
    const { agent, csrfToken } = await masterAdminAgent('sites-dup@test.local');

    await agent.post('/api/v1/sites').set('x-csrf-token', csrfToken).send({ name: 'Test Site Beta' });
    const res = await agent
      .post('/api/v1/sites')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Test Site Beta' });

    expect(res.status).toBe(409);
  });

  it('updates a site', async () => {
    const { agent, csrfToken } = await masterAdminAgent('sites-update@test.local');

    const createRes = await agent
      .post('/api/v1/sites')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Test Site Gamma' });

    const updateRes = await agent
      .patch(`/api/v1/sites/${createRes.body.site.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ unitLabel: 'Department' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.site.unitLabel).toBe('Department');
  });

  it('deletes a site with no employees assigned', async () => {
    const { agent, csrfToken } = await masterAdminAgent('sites-delete@test.local');

    const createRes = await agent
      .post('/api/v1/sites')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Test Site Delta' });

    const deleteRes = await agent
      .delete(`/api/v1/sites/${createRes.body.site.id}`)
      .set('x-csrf-token', csrfToken);

    expect(deleteRes.status).toBe(204);

    const found = await prisma.projectSite.findUnique({ where: { id: createRes.body.site.id } });
    expect(found).toBeNull();
  });

  it('blocks deleting a site while an employee is still assigned to it', async () => {
    const { agent, csrfToken } = await masterAdminAgent('sites-delete-blocked@test.local');

    const createRes = await agent
      .post('/api/v1/sites')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Test Site Epsilon' });
    const siteId = createRes.body.site.id;

    const unit = await prisma.projectUnit.create({ data: { siteId, name: 'Deletion Block Unit' } });
    await prisma.employee.create({
      data: {
        name: 'Test Employee For Deletion Block',
        designation: 'Guard',
        siteId,
        unitId: unit.id,
        grossPay: '30000.00',
      },
    });

    const deleteRes = await agent.delete(`/api/v1/sites/${siteId}`).set('x-csrf-token', csrfToken);

    expect(deleteRes.status).toBe(400);

    const stillThere = await prisma.projectSite.findUnique({ where: { id: siteId } });
    expect(stillThere).not.toBeNull();
  });

  it('blocks deleting a site while a Project Unit still belongs to it', async () => {
    const { agent, csrfToken } = await masterAdminAgent('sites-delete-blocked-unit@test.local');

    const createRes = await agent
      .post('/api/v1/sites')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Test Site Zeta' });
    const siteId = createRes.body.site.id;

    await prisma.projectUnit.create({ data: { siteId, name: 'Test Unit For Deletion Block' } });

    const deleteRes = await agent.delete(`/api/v1/sites/${siteId}`).set('x-csrf-token', csrfToken);

    expect(deleteRes.status).toBe(400);

    const stillThere = await prisma.projectSite.findUnique({ where: { id: siteId } });
    expect(stillThere).not.toBeNull();
  });

  it('scopes the site list to a Payroll Staff user\'s assigned sites only', async () => {
    const masterAdmin = await masterAdminAgent('sites-scope-admin@test.local');

    const siteA = await masterAdmin.agent
      .post('/api/v1/sites')
      .set('x-csrf-token', masterAdmin.csrfToken)
      .send({ name: 'Test Site Assigned' });
    const siteB = await masterAdmin.agent
      .post('/api/v1/sites')
      .set('x-csrf-token', masterAdmin.csrfToken)
      .send({ name: 'Test Site Unassigned' });

    const { agent } = await createAuthenticatedAgent(app, {
      email: 'sites-scope-staff@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      // A real Payroll Staff account always holds payroll:entry — this is the permission that
      // qualifies them for the site-lookup gate below, not sites:manage.
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds: [siteA.body.site.id],
    });

    const listRes = await agent.get('/api/v1/sites');
    const siteIds = listRes.body.sites.map((site: { id: string }) => site.id);

    expect(siteIds).toContain(siteA.body.site.id);
    expect(siteIds).not.toContain(siteB.body.site.id);
  });

  // --- Site-lookup read authorization (Post-Phase-5 Stabilization Checkpoint 4B remediation) -------
  //
  // GET /sites and GET /sites/:id previously carried no permission gate at all (any authenticated
  // user, any role). These tests cover the any-of gate now in front of both routes
  // (project-sites.routes.ts's SITE_LOOKUP_PERMISSIONS) — every permission with a real site-data
  // consumer still works, and a role holding none of them is rejected before ever reaching the
  // (already-scoped) list.

  describe('Site-lookup read authorization', () => {
    it('allows a caller holding only payroll:view (Finance) to list sites', async () => {
      const { agent } = await createAuthenticatedAgent(app, {
        email: 'sites-lookup-finance@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.FINANCE,
        permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      });

      const res = await agent.get('/api/v1/sites');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sites)).toBe(true);
    });

    it('allows a caller holding only corrections:approve (a reviewer) to list sites, scoped to their own assignment', async () => {
      const masterAdmin = await masterAdminAgent('sites-lookup-reviewer-admin@test.local');
      const site = await masterAdmin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', masterAdmin.csrfToken)
        .send({ name: 'Test Site Reviewer Scope' });

      const { agent } = await createAuthenticatedAgent(app, {
        email: 'sites-lookup-reviewer@test.local',
        password: PASSWORD,
        // A dedicated TEST_-prefixed role, not ROLE_CODES.PAYROLL_STAFF — granting
        // corrections:approve to the real, shared Payroll Staff role here would permanently leak
        // into every other test file in the same suite run (RolePermission grants accumulate via
        // upsert; cleanTestData never revokes a real seeded role's own grants), exactly the kind of
        // cross-file contamination corrections-service.test.ts's own "non-requester without
        // corrections:approve" test depends on NOT having happened.
        roleCode: 'TEST_SITE_LOOKUP_REVIEWER',
        permissionKeys: [PERMISSIONS.CORRECTIONS_APPROVE],
        siteIds: [site.body.site.id],
      });

      const res = await agent.get('/api/v1/sites');
      expect(res.status).toBe(200);
      const siteIds = res.body.sites.map((s: { id: string }) => s.id);
      expect(siteIds).toEqual([site.body.site.id]);
    });

    it('rejects a caller holding none of the qualifying permissions (403), not an empty 200', async () => {
      const { agent } = await createAuthenticatedAgent(app, {
        email: 'sites-lookup-unauthorized@test.local',
        password: PASSWORD,
        // A dedicated TEST_-prefixed role code (this suite's own established convention,
        // e.g. payroll-entry.test.ts's TEST_NO_PAYROLL_ENTRY) rather than a real seeded role code
        // — RolePermission grants on ROLE_CODES.PAYROLL_STAFF/FINANCE/MASTER_ADMIN accumulate
        // across the whole suite's run (upsert never revokes), so a real role code can't reliably
        // stay scoped to "holds only this one permission" once other test files have run.
        roleCode: 'TEST_NO_SITE_LOOKUP_PERMISSION',
        // tasks:manage has no site-data consumer at all — deliberately excluded from the gate.
        permissionKeys: [PERMISSIONS.TASKS_MANAGE],
      });

      const res = await agent.get('/api/v1/sites');
      expect(res.status).toBe(403);
      expect(res.body.sites).toBeUndefined();
    });

    it('rejects an unauthenticated caller (401)', async () => {
      const res = await request(app).get('/api/v1/sites');
      expect(res.status).toBe(401);
    });

    it('Master Admin still sees every site regardless of the gate', async () => {
      const masterAdmin = await masterAdminAgent('sites-lookup-master@test.local');
      await masterAdmin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', masterAdmin.csrfToken)
        .send({ name: 'Test Site Master Visible' });

      const res = await masterAdmin.agent.get('/api/v1/sites');
      expect(res.status).toBe(200);
      expect(res.body.sites.some((s: { name: string }) => s.name === 'Test Site Master Visible')).toBe(true);
    });

    it('site mutation still requires sites:manage even for a caller who can list sites', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'sites-lookup-mutation-blocked@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.FINANCE,
        permissionKeys: [PERMISSIONS.PAYROLL_VIEW],
      });

      const listRes = await agent.get('/api/v1/sites');
      expect(listRes.status).toBe(200);

      const createRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Should Still Not Exist' });
      expect(createRes.status).toBe(403);
    });

    it('GET /sites/:id honors the same gate', async () => {
      const masterAdmin = await masterAdminAgent('sites-lookup-detail-admin@test.local');
      const site = await masterAdmin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', masterAdmin.csrfToken)
        .send({ name: 'Test Site Detail Gate' });

      const { agent } = await createAuthenticatedAgent(app, {
        email: 'sites-lookup-detail-unauthorized@test.local',
        password: PASSWORD,
        roleCode: 'TEST_NO_SITE_LOOKUP_PERMISSION',
        permissionKeys: [PERMISSIONS.TASKS_MANAGE],
      });

      const res = await agent.get(`/api/v1/sites/${site.body.site.id}`);
      expect(res.status).toBe(403);
    });
  });
});
