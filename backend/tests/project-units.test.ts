import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

describe('Project Units', () => {
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

  async function createTestSite(name: string, unitLabel?: string) {
    return prisma.projectSite.create({ data: { name, ...(unitLabel && { unitLabel }) } });
  }

  it('lets Master Admin create a project unit under a site', async () => {
    const { agent, csrfToken } = await masterAdminAgent('units-create@test.local');
    const site = await createTestSite('Test Site Unit Alpha', 'Department');

    const res = await agent
      .post(`/api/v1/sites/${site.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Finance', code: 'FIN-01' });

    expect(res.status).toBe(201);
    expect(res.body.unit.name).toBe('Finance');
    expect(res.body.unit.code).toBe('FIN-01');
    expect(res.body.unit.siteId).toBe(site.id);
    expect(res.body.unit.isActive).toBe(true);

    const entries = await prisma.auditLog.findMany({ where: { action: 'project-unit.created' } });
    expect(entries.some((entry) => entry.entityId === res.body.unit.id)).toBe(true);
  });

  it('rejects unit creation from a user without sites:manage', async () => {
    const site = await createTestSite('Test Site Unit Unauthorized');
    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'units-unauthorized@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [],
      siteIds: [site.id],
    });

    const res = await agent
      .post(`/api/v1/sites/${site.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Should Not Be Created' });

    expect(res.status).toBe(403);
  });

  it('rejects a duplicate unit name within the same site with 409', async () => {
    const { agent, csrfToken } = await masterAdminAgent('units-dup@test.local');
    const site = await createTestSite('Test Site Unit Beta');

    await agent
      .post(`/api/v1/sites/${site.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Warehouse' });
    const res = await agent
      .post(`/api/v1/sites/${site.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Warehouse' });

    expect(res.status).toBe(409);
  });

  it('allows the same unit name under two different sites', async () => {
    const { agent, csrfToken } = await masterAdminAgent('units-samename@test.local');
    const siteA = await createTestSite('Test Site Unit Gamma A');
    const siteB = await createTestSite('Test Site Unit Gamma B');

    const resA = await agent
      .post(`/api/v1/sites/${siteA.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Finance' });
    const resB = await agent
      .post(`/api/v1/sites/${siteB.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Finance' });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it('rejects assigning a unit to a nonexistent site', async () => {
    const { agent, csrfToken } = await masterAdminAgent('units-badsite@test.local');

    const res = await agent
      .post('/api/v1/sites/00000000-0000-0000-0000-000000000000/units')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Orphan Unit' });

    expect(res.status).toBe(404);
  });

  it('updates a unit', async () => {
    const { agent, csrfToken } = await masterAdminAgent('units-update@test.local');
    const site = await createTestSite('Test Site Unit Delta');

    const createRes = await agent
      .post(`/api/v1/sites/${site.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Sales' });

    const updateRes = await agent
      .patch(`/api/v1/units/${createRes.body.unit.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ code: 'SLS-02' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.unit.code).toBe('SLS-02');
  });

  it('deletes a unit with nothing referencing it', async () => {
    const { agent, csrfToken } = await masterAdminAgent('units-delete@test.local');
    const site = await createTestSite('Test Site Unit Epsilon');

    const createRes = await agent
      .post(`/api/v1/sites/${site.id}/units`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'To Be Deleted' });

    const deleteRes = await agent
      .delete(`/api/v1/units/${createRes.body.unit.id}`)
      .set('x-csrf-token', csrfToken);

    expect(deleteRes.status).toBe(204);

    const found = await prisma.projectUnit.findUnique({ where: { id: createRes.body.unit.id } });
    expect(found).toBeNull();
  });

  it("scopes the unit list to a Payroll Staff user's assigned site", async () => {
    const masterAdmin = await masterAdminAgent('units-scope-admin@test.local');
    const assignedSite = await createTestSite('Test Site Unit Assigned');
    const unassignedSite = await createTestSite('Test Site Unit Unassigned');

    await masterAdmin.agent
      .post(`/api/v1/sites/${assignedSite.id}/units`)
      .set('x-csrf-token', masterAdmin.csrfToken)
      .send({ name: 'Reachable Unit' });

    const { agent } = await createAuthenticatedAgent(app, {
      email: 'units-scope-staff@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [],
      siteIds: [assignedSite.id],
    });

    const allowedRes = await agent.get(`/api/v1/sites/${assignedSite.id}/units`);
    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body.units.some((u: { name: string }) => u.name === 'Reachable Unit')).toBe(true);

    const deniedRes = await agent.get(`/api/v1/sites/${unassignedSite.id}/units`);
    expect(deniedRes.status).toBe(403);
  });
});
