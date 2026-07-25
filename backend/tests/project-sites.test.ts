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

  // --- UAT Defect 1: a custom role granted sites:manage sees every site (Post-Phase-5
  // Stabilization Checkpoint 4D correction) -----------------------------------------------------
  //
  // Root cause: `listProjectSites` (project-sites.service.ts) used to grant unrestricted
  // visibility only to the literal seeded Master Admin `roleCode`, scoping every other role —
  // including a *custom* role explicitly granted `sites:manage` — to its `UserSiteAssignment`
  // rows. A brand-new custom role has none by default (nothing to assign it to before any site
  // exists), so a "Payroll Manager" custom role with `sites:manage` could create a site (mutation
  // was never scoped) but then see an empty list. `sites:manage` is one of this system's
  // `CRITICAL_ADMIN_PERMISSIONS` (shared/src/constants/permissions.ts), the same class as the
  // already-unscoped `users:manage`/`settings:manage` — the fix grants the same unrestricted
  // visibility to any role, custom or system, that currently holds it.
  describe('sites:manage grants global site visibility, regardless of role name/code (UAT Defect 1)', () => {
    async function customSitesManagerAgent(email: string, roleCode = 'TEST_CUSTOM_SITES_MANAGER') {
      return createAuthenticatedAgent(app, {
        email,
        password: PASSWORD,
        roleCode,
        permissionKeys: [PERMISSIONS.SITES_MANAGE],
        // Deliberately no siteIds — a fresh custom role has no assignments yet, exactly the
        // reported production scenario.
      });
    }

    /** `masterAdminAgent` (top of this file) deliberately holds only `sites:manage`, matching its
     * own existing tests' intent — editing a *role* (rename, etc.) needs `users:manage`
     * (roles.routes.ts), which this dedicated helper adds on top, only for the tests below that
     * actually need to perform a role edit. */
    async function roleEditingAdminAgent(email: string) {
      return createAuthenticatedAgent(app, {
        email,
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [PERMISSIONS.SITES_MANAGE, PERMISSIONS.USERS_MANAGE],
      });
    }

    it('a custom role with sites:manage and zero site assignments can list every existing site', async () => {
      const masterAdmin = await masterAdminAgent('sites-custom-admin@test.local');
      const existing = await masterAdmin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', masterAdmin.csrfToken)
        .send({ name: 'Test Site Pre-Existing For Custom Role' });

      const { agent } = await customSitesManagerAgent('sites-custom-manager@test.local');

      const listRes = await agent.get('/api/v1/sites');
      expect(listRes.status).toBe(200);
      const siteIds = listRes.body.sites.map((s: { id: string }) => s.id);
      expect(siteIds).toContain(existing.body.site.id);
    });

    it('can create a site and immediately retrieve it in its own subsequent list call', async () => {
      const { agent, csrfToken } = await customSitesManagerAgent('sites-custom-manager-create@test.local');

      const createRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Created By Custom Manager' });
      expect(createRes.status).toBe(201);

      const listRes = await agent.get('/api/v1/sites');
      const siteIds = listRes.body.sites.map((s: { id: string }) => s.id);
      expect(siteIds).toContain(createRes.body.site.id);
    });

    it('renaming the role does not change its holder\'s access', async () => {
      const { agent } = await customSitesManagerAgent('sites-custom-rename@test.local', 'TEST_RENAME_SITES_MANAGER');
      const preRenameRes = await agent.get('/api/v1/sites');
      expect(preRenameRes.status).toBe(200);

      // The rename itself needs users:manage (roles.routes.ts), which this custom role
      // deliberately doesn't hold — an administrator performs it, same as any real role edit would.
      const admin = await roleEditingAdminAgent('sites-custom-rename-admin@test.local');
      const role = await prisma.role.findFirstOrThrow({ where: { code: 'TEST_RENAME_SITES_MANAGER' } });
      const renameRes = await admin.agent
        .patch(`/api/v1/roles/${role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ name: 'Totally Different Name' });
      expect(renameRes.status).toBe(200);

      const postRenameRes = await agent.get('/api/v1/sites');
      expect(postRenameRes.status).toBe(200);
      expect(postRenameRes.body.sites.length).toBe(preRenameRes.body.sites.length);
    });

    it('a custom role named "Master Admin" gains no special access — only sites:manage matters, never the name', async () => {
      const { agent } = await createAuthenticatedAgent(app, {
        email: 'sites-fake-master-admin@test.local',
        password: PASSWORD,
        roleCode: 'TEST_FAKE_MASTER_ADMIN',
        // No sites:manage granted — only the role's *name* imitates the seeded Master Admin.
        permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      });

      // Rename this custom role's display name to literally "Master Admin" — Role.name is
      // administrator-editable free text; Role.code (the only identity that matters here) was
      // already generated at creation and never changes.
      const role = await prisma.role.findFirstOrThrow({ where: { code: 'TEST_FAKE_MASTER_ADMIN' } });
      const admin = await roleEditingAdminAgent('sites-fake-master-admin-actor@test.local');
      await admin.agent
        .patch(`/api/v1/roles/${role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ name: 'Master Admin' });

      const otherSite = await admin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', admin.csrfToken)
        .send({ name: 'Test Site Not Visible To Fake Master Admin' });

      const listRes = await agent.get('/api/v1/sites');
      expect(listRes.status).toBe(200);
      const siteIds = listRes.body.sites.map((s: { id: string }) => s.id);
      // Still scoped to nothing (no site assignments, no sites:manage) despite the name.
      expect(siteIds).not.toContain(otherSite.body.site.id);
    });

    it('Master Admin behavior is unchanged — still sees every site with no explicit assignments', async () => {
      const masterAdmin = await masterAdminAgent('sites-master-unchanged@test.local');
      const site = await masterAdmin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', masterAdmin.csrfToken)
        .send({ name: 'Test Site Master Unchanged Check' });

      const listRes = await masterAdmin.agent.get('/api/v1/sites');
      const siteIds = listRes.body.sites.map((s: { id: string }) => s.id);
      expect(siteIds).toContain(site.body.site.id);
    });

    it('a site-scoped user (no sites:manage) still only sees their assigned sites — no leak from the global-visibility fix', async () => {
      const masterAdmin = await masterAdminAgent('sites-no-leak-admin@test.local');
      const assignedSite = await masterAdmin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', masterAdmin.csrfToken)
        .send({ name: 'Test Site No Leak Assigned' });
      const otherSite = await masterAdmin.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', masterAdmin.csrfToken)
        .send({ name: 'Test Site No Leak Other' });

      const { agent } = await createAuthenticatedAgent(app, {
        email: 'sites-no-leak-staff@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
        siteIds: [assignedSite.body.site.id],
      });

      const listRes = await agent.get('/api/v1/sites');
      const siteIds = listRes.body.sites.map((s: { id: string }) => s.id);
      expect(siteIds).toContain(assignedSite.body.site.id);
      expect(siteIds).not.toContain(otherSite.body.site.id);
    });
  });

  // --- RBAC Creator Ownership checkpoint (2026-07-25) ---------------------------------------------
  //
  // Root cause: `createProjectSite` (project-sites.service.ts) never created a `UserSiteAssignment`
  // row for the creator. `sites:manage` is deliberately a global *administrative* permission
  // (create/edit/delete the site entity list) — it never widens a site-scoped *operational*
  // permission (`employees:create`, `payroll:entry`, ...), which is exactly why a scoped Payroll
  // Manager who created a site still couldn't do anything operational with it until a Master Admin
  // manually assigned it back. Fixed by `ensureCreatorSiteAssignment` (common/creator-access.ts),
  // called inside the same transaction as the site's own creation.
  describe('Creator auto-assignment on Project Site creation (RBAC Creator Ownership checkpoint)', () => {
    async function scopedPayrollManagerAgent(email: string, siteIds: string[] = []) {
      return createAuthenticatedAgent(app, {
        email,
        password: PASSWORD,
        roleCode: 'TEST_CREATOR_OWNERSHIP_MANAGER',
        permissionKeys: [PERMISSIONS.SITES_MANAGE, PERMISSIONS.EMPLOYEES_CREATE],
        siteIds,
      });
    }

    it('a scoped Payroll Manager who creates Site A automatically receives a UserSiteAssignment for it', async () => {
      const { agent, csrfToken, userId } = await scopedPayrollManagerAgent('creator-owns-site-a@test.local');

      const createRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Creator Owns A' });
      expect(createRes.status).toBe(201);
      const siteId = createRes.body.site.id;

      const assignment = await prisma.userSiteAssignment.findUnique({
        where: { userId_siteId: { userId, siteId } },
      });
      expect(assignment).not.toBeNull();

      expect(createRes.body.site.createdById).toBe(userId);
    });

    it('does not grant access to an unrelated Site B', async () => {
      const managerA = await scopedPayrollManagerAgent('creator-no-leak-a@test.local');
      const managerB = await scopedPayrollManagerAgent('creator-no-leak-b@test.local');

      await managerA.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', managerA.csrfToken)
        .send({ name: 'Test Site No Leak Own' });
      const siteBRes = await managerB.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', managerB.csrfToken)
        .send({ name: 'Test Site No Leak Other' });

      const leaked = await prisma.userSiteAssignment.findUnique({
        where: { userId_siteId: { userId: managerA.userId, siteId: siteBRes.body.site.id } },
      });
      expect(leaked).toBeNull();
    });

    it('another scoped user does not gain access merely because someone else created a site', async () => {
      const creator = await scopedPayrollManagerAgent('creator-owns-c@test.local');
      const bystander = await scopedPayrollManagerAgent('creator-bystander@test.local');

      const siteRes = await creator.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', creator.csrfToken)
        .send({ name: 'Test Site Creator Owns C' });

      const bystanderAssignment = await prisma.userSiteAssignment.findUnique({
        where: { userId_siteId: { userId: bystander.userId, siteId: siteRes.body.site.id } },
      });
      expect(bystanderAssignment).toBeNull();
    });

    it('the creator can immediately use the new site through the same accessible-site path operational modules use (create an Employee at it)', async () => {
      const { agent, csrfToken } = await scopedPayrollManagerAgent('creator-operational-use@test.local');

      const siteRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Operational Use' });
      const siteId = siteRes.body.site.id;

      const unit = await prisma.projectUnit.create({ data: { siteId, name: 'Creator Ownership Test Unit' } });

      // No re-login between site creation and this request — `attachUser` reloads `siteIds` fresh
      // from the database on every request (attach-user.ts), so this proves the fix takes effect
      // within the same session immediately, with no Master Admin intervention.
      const employeeRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send({
          name: 'Creator Ownership Test Employee',
          designation: 'Guard',
          siteId,
          unitId: unit.id,
          grossPay: '30000.00',
        });

      expect(employeeRes.status).toBe(201);

      // `createEmployee` (employees.service.ts) syncs new employees into whatever Draft cycle is
      // currently open (`syncEmployeeIntoCurrentDraftCycle`, payroll-processing.service.ts) —
      // real, expected behavior, not scoped by this suite's own fake year>=2900 convention since
      // it depends on whatever cycle already exists in the database. Cleaned up explicitly here so
      // it can never block a later test's `cleanTestData()` (`Employee`/`PayrollEntry`'s RESTRICT
      // FK), independent of that convention.
      await prisma.payrollEntry.deleteMany({ where: { employeeId: employeeRes.body.employee.id } });
    });

    it('creating a site twice for the same user never produces a duplicate UserSiteAssignment row for either site', async () => {
      const { agent, csrfToken, userId } = await scopedPayrollManagerAgent('creator-idempotent@test.local');

      const siteOneRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Idempotent One' });
      const siteTwoRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Idempotent Two' });

      const assignments = await prisma.userSiteAssignment.findMany({
        where: { userId, siteId: { in: [siteOneRes.body.site.id, siteTwoRes.body.site.id] } },
      });
      expect(assignments).toHaveLength(2);
    });

    it('a user without sites:manage still cannot create a site, regardless of this fix', async () => {
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'creator-no-permission@test.local',
        password: PASSWORD,
        roleCode: 'TEST_CREATOR_OWNERSHIP_NO_PERMISSION',
        permissionKeys: [PERMISSIONS.EMPLOYEES_CREATE],
      });

      const res = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Should Still Not Exist Creator Check' });

      expect(res.status).toBe(403);
    });

    it('Master Admin creating a site gets no UserSiteAssignment row — unrestricted access remains implicit, never row-backed', async () => {
      const { agent, csrfToken } = await masterAdminAgent('creator-master-admin@test.local');

      const siteRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Master Admin Creator' });

      const masterUser = await prisma.user.findUniqueOrThrow({ where: { email: 'creator-master-admin@test.local' } });
      const assignment = await prisma.userSiteAssignment.findUnique({
        where: { userId_siteId: { userId: masterUser.id, siteId: siteRes.body.site.id } },
      });
      expect(assignment).toBeNull();
      expect(siteRes.body.site.createdById).toBe(masterUser.id);
    });

    it('records a distinct project-site.creator_assigned audit entry, separate from project-site.created', async () => {
      const { agent, csrfToken, userId } = await scopedPayrollManagerAgent('creator-audit@test.local');

      const siteRes = await agent
        .post('/api/v1/sites')
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Test Site Creator Audit' });

      const entries = await prisma.auditLog.findMany({
        where: { entityId: siteRes.body.site.id, action: 'project-site.creator_assigned' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.actorUserId).toBe(userId);
    });
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
