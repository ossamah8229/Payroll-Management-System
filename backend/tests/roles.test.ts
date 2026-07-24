import { execSync } from 'node:child_process';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/**
 * Administration & Security Management Phase 1 — dynamic role administration
 * (docs/architecture/authentication.md). Every test drives the real HTTP stack (`createApp()`,
 * session cookies, CSRF, the real `requirePermission`/`requireAuth` middleware, real Postgres),
 * matching this suite's own established integration-test convention
 * (`project-sites.test.ts`/`users.test.ts`). Custom roles created here are named with a leading
 * "Test " so `cleanTestData` (helpers.ts) removes them between tests, the same convention already
 * used for `Test Site `/`TEST_`-coded fixtures.
 */
describe('Role Administration', () => {
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

  async function noPermissionAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_NO_ROLE_ADMIN_PERMISSION',
      permissionKeys: [],
    });
  }

  async function createTestRole(
    admin: Awaited<ReturnType<typeof masterAdminAgent>>,
    body: Record<string, unknown>,
  ) {
    return admin.agent.post('/api/v1/roles').set('x-csrf-token', admin.csrfToken).send(body);
  }

  // --- Role creation -----------------------------------------------------------------------------

  describe('Role creation', () => {
    it('creates a role with valid permissions', async () => {
      const admin = await masterAdminAgent('roles-create-admin@test.local');
      const res = await createTestRole(admin, {
        name: 'Test Reports Viewer',
        description: 'Read-only reports access',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      });

      expect(res.status).toBe(201);
      expect(res.body.role.name).toBe('Test Reports Viewer');
      expect(res.body.role.description).toBe('Read-only reports access');
      expect(res.body.role.isActive).toBe(true);
      expect(res.body.role.isSystemRole).toBe(false);
      expect(res.body.role.permissionKeys).toEqual([PERMISSIONS.REPORTS_VIEW]);
      expect(res.body.role.assignedUserCount).toBe(0);

      const entries = await prisma.auditLog.findMany({ where: { action: 'role.created', entityId: res.body.role.id } });
      expect(entries).toHaveLength(1);
    });

    it('accepts any arbitrary administrator-chosen role name', async () => {
      const admin = await masterAdminAgent('roles-create-arbitrary-admin@test.local');
      const res = await createTestRole(admin, {
        name: 'Test Lahore Payroll Officer',
        permissionKeys: [],
      });

      expect(res.status).toBe(201);
      expect(res.body.role.name).toBe('Test Lahore Payroll Officer');
      // The generated code is an internal detail, never the seeded MASTER_ADMIN/PAYROLL_STAFF/
      // FINANCE enum — proving no fixed role-name/code list blocks an arbitrary name.
      expect(res.body.role.code).not.toBe(ROLE_CODES.MASTER_ADMIN);
    });

    it('rejects a duplicate name case-insensitively', async () => {
      const admin = await masterAdminAgent('roles-create-dup-admin@test.local');
      await createTestRole(admin, { name: 'Test Duplicate Role', permissionKeys: [] });

      const res = await createTestRole(admin, { name: 'test DUPLICATE role', permissionKeys: [] });
      expect(res.status).toBe(400);
    });

    it('rejects a blank name', async () => {
      const admin = await masterAdminAgent('roles-create-blank-admin@test.local');
      const res = await createTestRole(admin, { name: '   ', permissionKeys: [] });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown permission key', async () => {
      const admin = await masterAdminAgent('roles-create-unknown-perm-admin@test.local');
      const res = await createTestRole(admin, {
        name: 'Test Unknown Permission Role',
        permissionKeys: ['not:a-real-permission'],
      });
      expect(res.status).toBe(400);

      const created = await prisma.role.findFirst({ where: { name: 'Test Unknown Permission Role' } });
      expect(created).toBeNull();
    });

    it('rejects an unauthorized user (no users:manage)', async () => {
      const nonAdmin = await noPermissionAgent('roles-create-unauthorized@test.local');
      const res = await createTestRole(nonAdmin, { name: 'Test Should Not Exist', permissionKeys: [] });
      expect(res.status).toBe(403);
    });

    it('a newly created role immediately works for authorization — no restart, no re-seed', async () => {
      const admin = await masterAdminAgent('roles-create-immediate-admin@test.local');
      const createRes = await createTestRole(admin, {
        name: 'Test Immediate Auth Role',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      });
      const roleId = createRes.body.role.id;

      const user = await createAuthenticatedAgent(app, {
        email: 'roles-create-immediate-user@test.local',
        password: PASSWORD,
        roleCode: 'TEST_IMMEDIATE_PLACEHOLDER',
        permissionKeys: [],
      });
      // Reassign to the brand-new custom role directly (bypassing the update-user endpoint here —
      // this test is about the role's own permission working immediately, not the reassignment
      // flow itself, which is covered separately below).
      await prisma.user.update({ where: { id: user.userId }, data: { roleId } });

      // Fresh agent (new session) to avoid any doubt about session-vs-DB-load timing.
      const freshAgent = await createAuthenticatedAgent(app, {
        email: 'roles-create-immediate-user2@test.local',
        password: PASSWORD,
        roleCode: 'TEST_IMMEDIATE_PLACEHOLDER_2',
        permissionKeys: [],
      });
      await prisma.user.update({ where: { id: freshAgent.userId }, data: { roleId } });
      const meRes = await freshAgent.agent.get('/api/v1/auth/me');
      expect(meRes.body.user.permissions).toContain(PERMISSIONS.REPORTS_VIEW);
    });
  });

  // --- Role editing --------------------------------------------------------------------------

  describe('Role editing', () => {
    it('renames a role safely', async () => {
      const admin = await masterAdminAgent('roles-rename-admin@test.local');
      const createRes = await createTestRole(admin, { name: 'Test Old Name', permissionKeys: [] });

      const res = await admin.agent
        .patch(`/api/v1/roles/${createRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ name: 'Test New Name' });

      expect(res.status).toBe(200);
      expect(res.body.role.name).toBe('Test New Name');
      expect(res.body.role.id).toBe(createRes.body.role.id);

      const entries = await prisma.auditLog.findMany({ where: { action: 'role.renamed', entityId: createRes.body.role.id } });
      expect(entries).toHaveLength(1);
    });

    it('changes the description', async () => {
      const admin = await masterAdminAgent('roles-description-admin@test.local');
      const createRes = await createTestRole(admin, { name: 'Test Description Role', permissionKeys: [] });

      const res = await admin.agent
        .patch(`/api/v1/roles/${createRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ description: 'An updated description' });

      expect(res.status).toBe(200);
      expect(res.body.role.description).toBe('An updated description');
    });

    it('adds permissions', async () => {
      const admin = await masterAdminAgent('roles-add-perm-admin@test.local');
      const createRes = await createTestRole(admin, {
        name: 'Test Add Permission Role',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      });

      const res = await admin.agent
        .patch(`/api/v1/roles/${createRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYSLIPS_VIEW] });

      expect(res.status).toBe(200);
      expect(res.body.role.permissionKeys.sort()).toEqual([PERMISSIONS.PAYSLIPS_VIEW, PERMISSIONS.REPORTS_VIEW].sort());

      const entries = await prisma.auditLog.findMany({
        where: { action: 'role.permissions_changed', entityId: createRes.body.role.id },
      });
      expect(entries).toHaveLength(1);
      const metadata = entries[0]!.metadata as { added: string[]; removed: string[] };
      expect(metadata.added).toEqual([PERMISSIONS.PAYSLIPS_VIEW]);
      expect(metadata.removed).toEqual([]);
    });

    it('removes permissions', async () => {
      const admin = await masterAdminAgent('roles-remove-perm-admin@test.local');
      const createRes = await createTestRole(admin, {
        name: 'Test Remove Permission Role',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYSLIPS_VIEW],
      });

      const res = await admin.agent
        .patch(`/api/v1/roles/${createRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ permissionKeys: [PERMISSIONS.REPORTS_VIEW] });

      expect(res.status).toBe(200);
      expect(res.body.role.permissionKeys).toEqual([PERMISSIONS.REPORTS_VIEW]);
    });

    it('replaces permissions atomically — no partial update on an unknown key', async () => {
      const admin = await masterAdminAgent('roles-atomic-admin@test.local');
      const createRes = await createTestRole(admin, {
        name: 'Test Atomic Role',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      });

      const res = await admin.agent
        .patch(`/api/v1/roles/${createRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ permissionKeys: [PERMISSIONS.PAYSLIPS_VIEW, 'not:a-real-permission'] });

      expect(res.status).toBe(400);

      const reloaded = await prisma.role.findUniqueOrThrow({
        where: { id: createRes.body.role.id },
        include: { rolePermissions: { include: { permission: true } } },
      });
      // Original grant is completely untouched — never partially replaced.
      expect(reloaded.rolePermissions.map((rp) => rp.permission.key)).toEqual([PERMISSIONS.REPORTS_VIEW]);
    });

    it('deactivates an unused role', async () => {
      const admin = await masterAdminAgent('roles-deactivate-admin@test.local');
      const createRes = await createTestRole(admin, { name: 'Test Deactivate Role', permissionKeys: [] });

      const res = await admin.agent
        .patch(`/api/v1/roles/${createRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.role.isActive).toBe(false);

      const entries = await prisma.auditLog.findMany({ where: { action: 'role.deactivated', entityId: createRes.body.role.id } });
      expect(entries).toHaveLength(1);
    });

    it('an inactive role cannot be assigned to a new user', async () => {
      const admin = await masterAdminAgent('roles-inactive-assign-admin@test.local');
      const createRes = await createTestRole(admin, { name: 'Test Inactive Assign Role', permissionKeys: [] });
      await admin.agent
        .patch(`/api/v1/roles/${createRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ isActive: false });

      const res = await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Should Not Be Created',
          email: 'roles-inactive-assign-user@test.local',
          password: 'SomePassword1!',
          roleId: createRes.body.role.id,
        });

      expect(res.status).toBe(400);
    });

    it('a system role cannot be deactivated if it is the final full administrator', async () => {
      const admin = await masterAdminAgent('roles-system-final-admin@test.local');
      const masterRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.MASTER_ADMIN } });

      const res = await admin.agent
        .patch(`/api/v1/roles/${masterRole.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ isActive: false });

      expect(res.status).toBe(400);
      const reloaded = await prisma.role.findUniqueOrThrow({ where: { id: masterRole.id } });
      expect(reloaded.isActive).toBe(true);
    });
  });

  // --- Role duplication ------------------------------------------------------------------------

  describe('Role duplication', () => {
    it('copies permissions to a new role, leaving the original unchanged', async () => {
      const admin = await masterAdminAgent('roles-duplicate-admin@test.local');
      const sourceRes = await createTestRole(admin, {
        name: 'Test Duplicate Source',
        description: 'Original description',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYSLIPS_VIEW],
      });

      const res = await admin.agent
        .post(`/api/v1/roles/${sourceRes.body.role.id}/duplicate`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ newName: 'Test Duplicate Result' });

      expect(res.status).toBe(201);
      expect(res.body.role.id).not.toBe(sourceRes.body.role.id);
      expect(res.body.role.name).toBe('Test Duplicate Result');
      expect(res.body.role.permissionKeys.sort()).toEqual(
        [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYSLIPS_VIEW].sort(),
      );

      const sourceReloaded = await prisma.role.findUniqueOrThrow({
        where: { id: sourceRes.body.role.id },
        include: { rolePermissions: { include: { permission: true } } },
      });
      expect(sourceReloaded.name).toBe('Test Duplicate Source');
      expect(sourceReloaded.rolePermissions.map((rp) => rp.permission.key).sort()).toEqual(
        [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYSLIPS_VIEW].sort(),
      );

      const entries = await prisma.auditLog.findMany({ where: { action: 'role.duplicated', entityId: res.body.role.id } });
      expect(entries).toHaveLength(1);
    });

    it('rejects a duplicate-name new role', async () => {
      const admin = await masterAdminAgent('roles-duplicate-name-admin@test.local');
      const sourceRes = await createTestRole(admin, { name: 'Test Duplicate Name Source', permissionKeys: [] });
      await createTestRole(admin, { name: 'Test Existing Target Name', permissionKeys: [] });

      const res = await admin.agent
        .post(`/api/v1/roles/${sourceRes.body.role.id}/duplicate`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ newName: 'Test Existing Target Name' });

      expect(res.status).toBe(400);
    });
  });

  // --- Role deletion/retirement ------------------------------------------------------------------

  describe('Role deletion', () => {
    it('a role assigned to a user cannot be deleted', async () => {
      const admin = await masterAdminAgent('roles-delete-assigned-admin@test.local');
      const roleRes = await createTestRole(admin, { name: 'Test Assigned Role', permissionKeys: [] });

      await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Role Holder',
          email: 'roles-delete-assigned-user@test.local',
          password: 'SomePassword1!',
          roleId: roleRes.body.role.id,
        });

      const res = await admin.agent.delete(`/api/v1/roles/${roleRes.body.role.id}`).set('x-csrf-token', admin.csrfToken);
      expect(res.status).toBe(400);

      const stillThere = await prisma.role.findUnique({ where: { id: roleRes.body.role.id } });
      expect(stillThere).not.toBeNull();
    });

    it('a system role cannot be deleted', async () => {
      const admin = await masterAdminAgent('roles-delete-system-admin@test.local');
      const financeRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.FINANCE } });

      const res = await admin.agent.delete(`/api/v1/roles/${financeRole.id}`).set('x-csrf-token', admin.csrfToken);
      expect(res.status).toBe(400);

      const stillThere = await prisma.role.findUnique({ where: { id: financeRole.id } });
      expect(stillThere).not.toBeNull();
    });

    it('an unused custom role can be deleted', async () => {
      const admin = await masterAdminAgent('roles-delete-unused-admin@test.local');
      const roleRes = await createTestRole(admin, { name: 'Test Unused Role', permissionKeys: [] });

      const res = await admin.agent.delete(`/api/v1/roles/${roleRes.body.role.id}`).set('x-csrf-token', admin.csrfToken);
      expect(res.status).toBe(204);

      const stillThere = await prisma.role.findUnique({ where: { id: roleRes.body.role.id } });
      expect(stillThere).toBeNull();

      const entries = await prisma.auditLog.findMany({ where: { action: 'role.deleted', entityId: roleRes.body.role.id } });
      expect(entries).toHaveLength(1);
    });
  });

  // --- Permission catalog ------------------------------------------------------------------------

  describe('Permission catalog', () => {
    it('returns every real Permission row, enriched with group/label/action', async () => {
      const admin = await masterAdminAgent('roles-catalog-admin@test.local');
      const res = await admin.agent.get('/api/v1/roles/permissions');

      expect(res.status).toBe(200);
      expect(res.body.permissions.length).toBeGreaterThanOrEqual(18);
      const entry = res.body.permissions.find((p: { key: string }) => p.key === PERMISSIONS.USERS_MANAGE);
      expect(entry).toMatchObject({ key: PERMISSIONS.USERS_MANAGE, group: 'Users' });
      expect(typeof entry.label).toBe('string');
    });

    it('rejects an unauthorized caller', async () => {
      const nonAdmin = await noPermissionAgent('roles-catalog-unauthorized@test.local');
      const res = await nonAdmin.agent.get('/api/v1/roles/permissions');
      expect(res.status).toBe(403);
    });
  });

  // --- Final-active-administrator safeguard -----------------------------------------------------

  describe('Final-administrator safeguard', () => {
    it('blocks removing a critical permission from the only qualifying role', async () => {
      const admin = await masterAdminAgent('roles-final-admin-perm-admin@test.local');
      const masterRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.MASTER_ADMIN } });

      const res = await admin.agent
        .patch(`/api/v1/roles/${masterRole.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ permissionKeys: [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.SITES_MANAGE, PERMISSIONS.AUDIT_LOG_VIEW] }); // drops users:manage

      expect(res.status).toBe(400);
      const reloaded = await prisma.role.findUniqueOrThrow({
        where: { id: masterRole.id },
        include: { rolePermissions: { include: { permission: true } } },
      });
      expect(reloaded.rolePermissions.map((rp) => rp.permission.key)).toContain(PERMISSIONS.USERS_MANAGE);
    });

    it('allows the change once a second qualifying administrator exists', async () => {
      const admin = await masterAdminAgent('roles-final-admin-second-admin@test.local');
      const masterRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.MASTER_ADMIN } });

      // A second full administrator, via a distinct custom role.
      const secondAdminRole = await createTestRole(admin, {
        name: 'Test Second Full Admin',
        permissionKeys: [
          PERMISSIONS.USERS_MANAGE,
          PERMISSIONS.SETTINGS_MANAGE,
          PERMISSIONS.SITES_MANAGE,
          PERMISSIONS.AUDIT_LOG_VIEW,
        ],
      });
      await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Second Admin',
          email: 'roles-final-admin-second-user@test.local',
          password: 'SomePassword1!',
          roleId: secondAdminRole.body.role.id,
        });

      const res = await admin.agent
        .patch(`/api/v1/roles/${masterRole.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ isActive: false });

      expect(res.status).toBe(200);

      // Restore for cleanup hygiene, in case a later test in this file re-reads the seeded state.
      await prisma.role.update({ where: { id: masterRole.id }, data: { isActive: true } });
    });

    it('does not block a change to a role that never granted full administrative capability', async () => {
      const admin = await masterAdminAgent('roles-final-admin-noop-admin@test.local');
      const roleRes = await createTestRole(admin, { name: 'Test Non Admin Role', permissionKeys: [PERMISSIONS.REPORTS_VIEW] });

      const res = await admin.agent
        .patch(`/api/v1/roles/${roleRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ isActive: false });

      expect(res.status).toBe(200);
    });
  });

  // --- User assignment ---------------------------------------------------------------------------

  describe('User assignment with custom roles', () => {
    it('creates a user with a custom role', async () => {
      const admin = await masterAdminAgent('roles-user-create-admin@test.local');
      const roleRes = await createTestRole(admin, {
        name: 'Test Employee Registry Tester',
        permissionKeys: [PERMISSIONS.EMPLOYEES_VIEW],
      });

      const res = await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Custom Role User',
          email: 'roles-user-create-target@test.local',
          password: 'SomePassword1!',
          roleId: roleRes.body.role.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role.id).toBe(roleRes.body.role.id);
      expect(res.body.user.role.name).toBe('Test Employee Registry Tester');
    });

    it('changes a user from one custom role to another', async () => {
      const admin = await masterAdminAgent('roles-user-reassign-admin@test.local');
      const roleA = await createTestRole(admin, { name: 'Test Role A', permissionKeys: [PERMISSIONS.REPORTS_VIEW] });
      const roleB = await createTestRole(admin, { name: 'Test Role B', permissionKeys: [PERMISSIONS.PAYSLIPS_VIEW] });

      const userRes = await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Reassign Me',
          email: 'roles-user-reassign-target@test.local',
          password: 'SomePassword1!',
          roleId: roleA.body.role.id,
        });

      const res = await admin.agent
        .patch(`/api/v1/users/${userRes.body.user.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ roleId: roleB.body.role.id });

      expect(res.status).toBe(200);
      expect(res.body.user.role.id).toBe(roleB.body.role.id);

      const entries = await prisma.auditLog.findMany({
        where: { action: 'user.role_changed', entityId: userRes.body.user.id },
      });
      expect(entries).toHaveLength(1);
      const metadata = entries[0]!.metadata as { previousRole: { id: string }; newRole: { id: string } };
      expect(metadata.previousRole.id).toBe(roleA.body.role.id);
      expect(metadata.newRole.id).toBe(roleB.body.role.id);
    });

    it('rejects assigning an inactive role', async () => {
      const admin = await masterAdminAgent('roles-user-inactive-admin@test.local');
      const roleRes = await createTestRole(admin, { name: 'Test Inactive Target Role', permissionKeys: [] });
      await admin.agent
        .patch(`/api/v1/roles/${roleRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ isActive: false });

      const res = await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Should Fail',
          email: 'roles-user-inactive-target@test.local',
          password: 'SomePassword1!',
          roleId: roleRes.body.role.id,
        });

      expect(res.status).toBe(400);
    });

    it('rejects an unknown roleId', async () => {
      const admin = await masterAdminAgent('roles-user-unknown-admin@test.local');
      const res = await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Should Fail',
          email: 'roles-user-unknown-target@test.local',
          password: 'SomePassword1!',
          roleId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(400);
    });

    it('final-administrator safeguard blocks reassigning the last full administrator away', async () => {
      const admin = await masterAdminAgent('roles-user-final-admin-admin@test.local');
      const nonAdminRole = await createTestRole(admin, { name: 'Test Non Admin Target Role', permissionKeys: [] });

      // The acting admin cannot reassign *their own* role either way (a separate, always-on
      // self-protection rule) — reassign a *different* Master Admin user instead to isolate the
      // final-administrator check itself.
      const secondMasterAdmin = await createAuthenticatedAgent(app, {
        email: 'roles-user-final-admin-second@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.MASTER_ADMIN,
        permissionKeys: [
          PERMISSIONS.USERS_MANAGE,
          PERMISSIONS.SETTINGS_MANAGE,
          PERMISSIONS.SITES_MANAGE,
          PERMISSIONS.AUDIT_LOG_VIEW,
        ],
      });

      const res = await admin.agent
        .patch(`/api/v1/users/${secondMasterAdmin.userId}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ roleId: nonAdminRole.body.role.id });

      // Both users hold the real, seeded MASTER_ADMIN role — reassigning one away still leaves
      // the acting admin (also Master Admin) qualifying, so this specific case is expected to
      // succeed. The dedicated block-case is covered next, with the acting admin excluded from
      // qualifying via a distinct role so only the target qualifies.
      expect(res.status).toBe(200);
    });

    it('final-administrator safeguard: blocks deactivating the sole qualifying user', async () => {
      // The acting session here deliberately holds only users:manage (enough to call this API),
      // never the full critical set itself — so it never counts as a qualifying administrator on
      // its own, and setting up "exactly one other qualifier" doesn't require touching this
      // session's own access at all.
      const admin = await masterAdminAgent('roles-user-final-deactivate-admin@test.local');
      const actingRole = await createTestRole(admin, {
        name: 'Test Acting Non-Qualifying Admin Role',
        permissionKeys: [PERMISSIONS.USERS_MANAGE],
      });
      const acting = await createAuthenticatedAgent(app, {
        email: 'roles-user-final-deactivate-acting@test.local',
        password: PASSWORD,
        roleCode: 'TEST_ACTING_PLACEHOLDER',
        permissionKeys: [],
      });
      await prisma.user.update({ where: { id: acting.userId }, data: { roleId: actingRole.body.role.id } });

      const soleAdminRole = await createTestRole(admin, {
        name: 'Test Sole Qualifying Admin Role',
        permissionKeys: [
          PERMISSIONS.USERS_MANAGE,
          PERMISSIONS.SETTINGS_MANAGE,
          PERMISSIONS.SITES_MANAGE,
          PERMISSIONS.AUDIT_LOG_VIEW,
        ],
      });
      const soleAdminUserRes = await admin.agent
        .post('/api/v1/users')
        .set('x-csrf-token', admin.csrfToken)
        .send({
          name: 'Sole Qualifying Admin',
          email: 'roles-user-final-deactivate-target@test.local',
          password: 'SomePassword1!',
          roleId: soleAdminRole.body.role.id,
        });

      // Neutralize every *other* real qualifier in this shared dev database — the seeded
      // admin@broomservices.pk Master Admin account, and this test's own `admin` fixture (also a
      // real Master-Admin-role user, independently qualifying) — via direct DB writes (bypassing
      // the API's own safeguard deliberately, purely to establish the "exactly one qualifier"
      // precondition, never to test these writes themselves). Both restored in `finally`.
      const seededAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@broomservices.pk' } });
      await prisma.user.update({ where: { id: seededAdmin.id }, data: { isActive: false } });
      await prisma.user.update({ where: { id: admin.userId }, data: { isActive: false } });

      try {
        const res = await acting.agent
          .patch(`/api/v1/users/${soleAdminUserRes.body.user.id}`)
          .set('x-csrf-token', acting.csrfToken)
          .send({ isActive: false });

        expect(res.status).toBe(400);
        const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: soleAdminUserRes.body.user.id } });
        expect(stillActive.isActive).toBe(true);
      } finally {
        await prisma.user.update({ where: { id: seededAdmin.id }, data: { isActive: true } });
        await prisma.user.update({ where: { id: admin.userId }, data: { isActive: true } });
      }
    });
  });

  // --- Authorization with custom roles (the team-testing battery) --------------------------------

  describe('Authorization with custom roles', () => {
    async function agentWithCustomRole(admin: Awaited<ReturnType<typeof masterAdminAgent>>, name: string, permissionKeys: string[], email: string) {
      const roleRes = await createTestRole(admin, { name, permissionKeys });
      return createAuthenticatedAgent(app, {
        email,
        password: PASSWORD,
        // A dedicated placeholder role is created then immediately swapped for the real custom
        // role id via a direct DB update — createAuthenticatedAgent only knows roleCode, not
        // roleId, so this is the simplest way to log in as a user holding the exact custom role
        // just created through the real API.
        roleCode: `TEST_PLACEHOLDER_${Math.random().toString(36).slice(2, 8)}`,
        permissionKeys: [],
      }).then(async (result) => {
        await prisma.user.update({ where: { id: result.userId }, data: { roleId: roleRes.body.role.id } });
        return result;
      });
    }

    it('"Employee Registry Tester" can view employees but not manage sites', async () => {
      const admin = await masterAdminAgent('roles-battery-employee-admin@test.local');
      const tester = await agentWithCustomRole(
        admin,
        'Test Employee Registry Tester Role',
        [PERMISSIONS.EMPLOYEES_VIEW],
        'roles-battery-employee-tester@test.local',
      );

      expect((await tester.agent.get('/api/v1/employees')).status).toBe(200);
      expect((await tester.agent.get('/api/v1/sites')).status).toBe(200); // sites lookup is any-of, but SITES_MANAGE mutation isn't held
      const mutationRes = await tester.agent
        .post('/api/v1/sites')
        .set('x-csrf-token', tester.csrfToken)
        .send({ name: 'Test Site Should Not Be Created' });
      expect(mutationRes.status).toBe(403);
    });

    it('"Reports Viewer" cannot access payroll entry or user administration', async () => {
      const admin = await masterAdminAgent('roles-battery-reports-admin@test.local');
      const tester = await agentWithCustomRole(
        admin,
        'Test Reports Viewer Role',
        [PERMISSIONS.REPORTS_VIEW],
        'roles-battery-reports-tester@test.local',
      );

      expect((await tester.agent.get('/api/v1/users')).status).toBe(403);
      expect((await tester.agent.get('/api/v1/employees')).status).toBe(403);
    });

    it('"Read-Only Auditor" (audit-log:view only) cannot mutate anything', async () => {
      const admin = await masterAdminAgent('roles-battery-auditor-admin@test.local');
      const tester = await agentWithCustomRole(
        admin,
        'Test Read-Only Auditor Role',
        [PERMISSIONS.AUDIT_LOG_VIEW],
        'roles-battery-auditor-tester@test.local',
      );

      expect(
        (
          await tester.agent
            .patch('/api/v1/settings/company')
            .set('x-csrf-token', tester.csrfToken)
            .send({ companyName: 'Should Not Change' })
        ).status,
      ).toBe(403);
    });

    it('removing a permission from a custom role takes effect on the very next request, same session', async () => {
      const admin = await masterAdminAgent('roles-battery-revoke-admin@test.local');
      const roleRes = await createTestRole(admin, {
        name: 'Test Revocable Role',
        permissionKeys: [PERMISSIONS.REPORTS_VIEW],
      });
      const tester = await createAuthenticatedAgent(app, {
        email: 'roles-battery-revoke-tester@test.local',
        password: PASSWORD,
        roleCode: 'TEST_REVOKE_PLACEHOLDER',
        permissionKeys: [],
      });
      await prisma.user.update({ where: { id: tester.userId }, data: { roleId: roleRes.body.role.id } });

      expect((await tester.agent.get('/api/v1/auth/me')).body.user.permissions).toContain(PERMISSIONS.REPORTS_VIEW);

      await admin.agent
        .patch(`/api/v1/roles/${roleRes.body.role.id}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ permissionKeys: [] });

      const meRes = await tester.agent.get('/api/v1/auth/me');
      expect(meRes.body.user.permissions).not.toContain(PERMISSIONS.REPORTS_VIEW);
    });

    it('renaming a role does not change its holder\'s authorization at all', async () => {
      const admin = await masterAdminAgent('roles-battery-rename-admin@test.local');
      const tester = await agentWithCustomRole(
        admin,
        'Test HR Data Team Old Name',
        [PERMISSIONS.EMPLOYEES_VIEW],
        'roles-battery-rename-tester@test.local',
      );

      const roleId = (await tester.agent.get('/api/v1/auth/me')).body.user.roleId;
      const before = await tester.agent.get('/api/v1/employees');
      expect(before.status).toBe(200);

      await admin.agent
        .patch(`/api/v1/roles/${roleId}`)
        .set('x-csrf-token', admin.csrfToken)
        .send({ name: 'Test HR Data Team New Name' });

      const after = await tester.agent.get('/api/v1/employees');
      expect(after.status).toBe(200);
      // Same permission set, same access — the rename itself changed nothing authorization-wise.
      const meAfter = await tester.agent.get('/api/v1/auth/me');
      expect(meAfter.body.user.permissions).toContain(PERMISSIONS.EMPLOYEES_VIEW);
    });
  });

  // --- Seed behavior -------------------------------------------------------------------------

  describe('Seed idempotency', () => {
    it('re-running seed does not overwrite an administrator-edited role\'s permissions', async () => {
      const financeRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.FINANCE } });
      const originalPermission = await prisma.permission.findUniqueOrThrow({ where: { key: PERMISSIONS.PAYROLL_VIEW } });

      // Simulate an administrator's edit: remove payroll:view from Finance.
      await prisma.rolePermission.deleteMany({
        where: { roleId: financeRole.id, permissionId: originalPermission.id },
      });

      execSync('npx prisma db seed', { cwd: `${__dirname}/..`, stdio: 'pipe' });

      const reloaded = await prisma.role.findUniqueOrThrow({
        where: { id: financeRole.id },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const keys = reloaded.rolePermissions.map((rp) => rp.permission.key);
      expect(keys).not.toContain(PERMISSIONS.PAYROLL_VIEW);

      // Restore, so this test doesn't leave the shared dev database's Finance role permanently
      // altered for whatever runs next.
      await prisma.rolePermission.create({ data: { roleId: financeRole.id, permissionId: originalPermission.id } });
    }, 30000);

    it('a custom role survives re-running seed', async () => {
      const custom = await prisma.role.create({
        data: { code: 'TEST_SEED_SURVIVES', name: 'Test Seed Survives Role', isSystemRole: false },
      });

      execSync('npx prisma db seed', { cwd: `${__dirname}/..`, stdio: 'pipe' });

      const stillThere = await prisma.role.findUnique({ where: { id: custom.id } });
      expect(stillThere).not.toBeNull();
      expect(stillThere!.name).toBe('Test Seed Survives Role');
    }, 30000);

    // Terminology audit (Corrections/RBAC completion checkpoint) — "Master User" is this system's
    // live, user-facing display name for the MASTER_ADMIN role/account (docs/architecture/
    // authentication.md: renamed 2026-07-05), but the rename never reached seed.ts until this
    // checkpoint — every database seeded before it still showed "Master Admin" in Settings ->
    // Roles, the sidebar footer, and anywhere else Role.name/User.name renders. Never the role
    // CODE, which stays MASTER_ADMIN everywhere and grants no authorization based on either name.
    it('seeds the Master Admin role and account with the "Master User" display name, never the role code', async () => {
      const masterRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.MASTER_ADMIN } });
      expect(masterRole.name).toBe('Master User');
      expect(masterRole.code).toBe('MASTER_ADMIN');

      const masterUser = await prisma.user.findFirstOrThrow({ where: { roleId: masterRole.id } });
      expect(masterUser.name).toBe('Master User');
    });

    it('re-running seed does not revert an administrator-renamed Master role back to "Master User"', async () => {
      const masterRole = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.MASTER_ADMIN } });
      await prisma.role.update({ where: { id: masterRole.id }, data: { name: 'Chief Administrator' } });

      execSync('npx prisma db seed', { cwd: `${__dirname}/..`, stdio: 'pipe' });

      const reloaded = await prisma.role.findUniqueOrThrow({ where: { id: masterRole.id } });
      expect(reloaded.name).toBe('Chief Administrator');

      // Restore, so this test doesn't leave the shared dev database's Master role permanently
      // renamed for whatever runs next.
      await prisma.role.update({ where: { id: masterRole.id }, data: { name: 'Master User' } });
    }, 30000);
  });
});
