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
      .send({ branchCode: 'BR-01' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.site.branchCode).toBe('BR-01');
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

    await prisma.employee.create({
      data: {
        name: 'Test Employee For Deletion Block',
        designation: 'Guard',
        siteId,
        grossPay: '30000.00',
      },
    });

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
      permissionKeys: [],
      siteIds: [siteA.body.site.id],
    });

    const listRes = await agent.get('/api/v1/sites');
    const siteIds = listRes.body.sites.map((site: { id: string }) => site.id);

    expect(siteIds).toContain(siteA.body.site.id);
    expect(siteIds).not.toContain(siteB.body.site.id);
  });
});
