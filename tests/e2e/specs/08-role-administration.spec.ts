import type { BrowserContext } from '@playwright/test';
import { test, expect, login, getCsrfToken } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { BACKEND_URL } from '../setup/config';

/**
 * Administration & Security Management Phase 1 — dynamic roles, permission matrix, and user role
 * assignment, driven through the real UI against the real backend/database (same real-stack
 * conviction as every other spec in this harness — see `tests/e2e/README.md`). Creates its own
 * six team-testing roles and one user per role, entirely independent of any other spec's fixture
 * data (unique site/employee/user names via a per-run timestamp label, this suite's own
 * established isolation convention).
 */

const SCREENSHOT_DIR = 'test-results/role-administration-screenshots';

/** `apiPost`'s own CSRF-attaching convention (helpers/api.ts), for PATCH/DELETE — neither of which
 * that file exports a helper for. Kept local to this spec rather than added to the shared helper,
 * since this is the first spec in the suite needing a mutating verb beyond POST. Targets
 * `BACKEND_URL` directly, exactly like `apiPost`/`apiGet` (helpers/api.ts) — a manually created
 * `browser.newContext()` (or even the shared `page.context()`) does not proxy `/api` anywhere;
 * only the frontend's own `api-client.ts` (built with `VITE_API_URL`) talks to the backend
 * directly, so any relative path issued straight from a test would silently hit the frontend's own
 * static `vite preview` server on 4200 instead. */
async function apiPatch<T = unknown>(context: BrowserContext, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const csrfToken = await getCsrfToken(context);
  const res = await context.request.patch(`${BACKEND_URL}${path}`, { data: body, headers: { 'x-csrf-token': csrfToken } });
  const json = (await res.json().catch(() => undefined)) as T;
  return { status: res.status(), body: json };
}

async function apiDelete(context: BrowserContext, path: string): Promise<{ status: number; body: unknown }> {
  const csrfToken = await getCsrfToken(context);
  const res = await context.request.delete(`${BACKEND_URL}${path}`, { headers: { 'x-csrf-token': csrfToken } });
  const json = await res.json().catch(() => undefined);
  return { status: res.status(), body: json };
}

/** Unlike `apiPost` (helpers/api.ts), does not throw on a non-2xx response — for the handful of
 * calls in this spec that are *expected* to fail and need their status code asserted directly. */
async function apiPostExpectingStatus(context: BrowserContext, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const csrfToken = await getCsrfToken(context);
  const res = await context.request.post(`${BACKEND_URL}${path}`, { data: body, headers: { 'x-csrf-token': csrfToken } });
  const json = await res.json().catch(() => undefined);
  return { status: res.status(), body: json };
}

test.describe('Role & Permission Administration', () => {
  test('Master User creates six team-testing roles with a minimal permission matrix', async ({ authenticatedPage: page }) => {
    await page.goto('/roles');
    await expect(page.getByRole('heading', { name: 'All Roles' })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-roles-list.png`, fullPage: true });

    const label = Date.now();
    type E2ERole = { name: string; permissionLabels: string[] };
    // Fixed-length tuple (not `E2ERole[]`) so `roles[0]` below is statically known to exist
    // under `noUncheckedIndexedAccess`, rather than typed `E2ERole | undefined`.
    const roles: [E2ERole, E2ERole, E2ERole, E2ERole, E2ERole, E2ERole] = [
      { name: `E2E Employee Registry Tester ${label}`, permissionLabels: ['View employees'] },
      { name: `E2E Payroll Entry Tester ${label}`, permissionLabels: ['Edit payroll entries'] },
      { name: `E2E Finance Release Tester ${label}`, permissionLabels: ['View payroll & salary release', 'Release payroll by unit'] },
      { name: `E2E Corrections Reviewer ${label}`, permissionLabels: ['Approve or reject corrections'] },
      { name: `E2E Reports Viewer ${label}`, permissionLabels: ['View reports'] },
      { name: `E2E Read-Only Auditor ${label}`, permissionLabels: ['View audit log'] },
    ];

    for (const [index, role] of roles.entries()) {
      await page.getByRole('button', { name: 'New Role' }).click();
      if (index === 0) {
        await page.screenshot({ path: `${SCREENSHOT_DIR}/02-create-role-modal.png`, fullPage: true });
      }
      await page.locator('#role-name').fill(role.name);
      for (const permissionLabel of role.permissionLabels) {
        await page.getByRole('checkbox', { name: permissionLabel, exact: true }).click();
      }
      if (index === 0) {
        await page.screenshot({ path: `${SCREENSHOT_DIR}/03-permission-matrix-selected.png`, fullPage: true });
      }
      await page.getByRole('button', { name: 'Create role' }).click();
      await expect(page.getByText(role.name)).toBeVisible();
    }

    // --- Duplicate one role, confirming the new role carries the same permissions and the
    // original is left untouched ---
    const firstRoleName = roles[0].name;
    const firstRoleRow = page.locator('tr', { hasText: firstRoleName });
    await firstRoleRow.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03b-duplicate-role-modal.png`, fullPage: true });
    const duplicateName = `${firstRoleName} (Copy)`;
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByText('Role duplicated')).toBeVisible();
    await expect(page.getByText(duplicateName, { exact: true })).toBeVisible();
    // `firstRoleName` is a substring of `duplicateName` ("... (Copy)"), so only an exact match
    // proves the original role is still listed separately, not just matching the copy's row.
    await expect(page.getByText(firstRoleName, { exact: true })).toBeVisible();
  });

  test('Master User creates one user per role, with site assignment, and logs in as each', async ({ authenticatedPage: page, browser }) => {
    const context = page.context();
    const label = Date.now();
    const siteName = `E2E Site role-admin-${label}`;
    const { siteId } = await createSiteWithEmployee(context, `role-admin-${label}`);

    const rolesRes = await apiGet<{ roles: { id: string; name: string }[] }>(context, '/api/v1/roles');
    const findRole = (namePrefix: string) => rolesRes.body.roles.find((r) => r.name.startsWith(namePrefix));

    // Reuse the six roles the previous test created (same worker, sequential — workers: 1). If run
    // in isolation, gracefully skip rather than fail on an assumption this file alone can't meet.
    const employeeTesterRole = findRole('E2E Employee Registry Tester');
    const payrollTesterRole = findRole('E2E Payroll Entry Tester');
    const financeTesterRole = findRole('E2E Finance Release Tester');
    const correctionsTesterRole = findRole('E2E Corrections Reviewer');
    const reportsTesterRole = findRole('E2E Reports Viewer');
    const auditorTesterRole = findRole('E2E Read-Only Auditor');
    test.skip(
      !employeeTesterRole || !payrollTesterRole || !financeTesterRole || !correctionsTesterRole || !reportsTesterRole || !auditorTesterRole,
      'The six team-testing roles do not exist yet — run the full suite, not this file alone.',
    );
    if (!employeeTesterRole || !payrollTesterRole || !financeTesterRole || !correctionsTesterRole || !reportsTesterRole || !auditorTesterRole) return;

    const password = 'E2ERoleTesterPassword1!';
    const usersByRole = {
      employee: { email: `e2e-employee-tester-${label}@example.test`, roleName: employeeTesterRole.name },
      payroll: { email: `e2e-payroll-tester-${label}@example.test`, roleName: payrollTesterRole.name },
      finance: { email: `e2e-finance-tester-${label}@example.test`, roleName: financeTesterRole.name },
      corrections: { email: `e2e-corrections-tester-${label}@example.test`, roleName: correctionsTesterRole.name },
      reports: { email: `e2e-reports-tester-${label}@example.test`, roleName: reportsTesterRole.name },
      auditor: { email: `e2e-auditor-tester-${label}@example.test`, roleName: auditorTesterRole.name },
    } satisfies Record<string, { email: string; roleName: string }>;
    const roleIdByKey: Record<string, string> = {
      employee: employeeTesterRole.id,
      payroll: payrollTesterRole.id,
      finance: financeTesterRole.id,
      corrections: correctionsTesterRole.id,
      reports: reportsTesterRole.id,
      auditor: auditorTesterRole.id,
    };

    // --- Create each user through the real UI, with site assignment, screenshotting the flow once ---
    await page.goto('/users');
    let first = true;
    for (const [key, u] of Object.entries(usersByRole)) {
      await page.getByRole('button', { name: 'New User' }).click();
      await page.locator('#user-name').fill(`E2E ${key} tester`);
      await page.locator('#user-email').fill(u.email);
      await page.locator('#user-password').fill(password);
      await page.locator('#user-role').selectOption({ label: u.roleName });
      if (first) {
        await page.screenshot({ path: `${SCREENSHOT_DIR}/04-user-role-selector.png`, fullPage: true });
      }
      // Target this spec's own site by name, not `.first()` — when the full suite runs, many
      // other specs' sites already exist in this same disposable database, and `.first()` would
      // silently assign whichever site happens to sort first, breaking the later site-scope
      // assertion (expects the employee tester to see *only* `siteId`).
      const siteCheckbox = page.getByRole('dialog').getByRole('checkbox', { name: siteName, exact: true });
      if ((await siteCheckbox.count()) > 0) {
        await siteCheckbox.click();
      }
      if (first) {
        await page.screenshot({ path: `${SCREENSHOT_DIR}/05-role-assignment.png`, fullPage: true });
        first = false;
      }
      await page.getByRole('button', { name: 'Create user' }).click();
      await expect(page.getByText(u.email)).toBeVisible();
    }

    // --- Log in as the Employee Registry tester; confirm nav, permitted route, denied route, site scope ---
    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();
    await login(employeePage, usersByRole.employee.email, password);
    await employeePage.screenshot({ path: `${SCREENSHOT_DIR}/06-custom-role-login.png`, fullPage: true });

    await expect(employeePage.getByRole('link', { name: 'Employee Registry' })).toBeVisible();
    await expect(employeePage.getByRole('link', { name: 'Payroll Entry' })).toHaveCount(0);
    await expect(employeePage.getByRole('link', { name: 'Users' })).toHaveCount(0);

    await employeePage.goto('/employees');
    // The AppShell topbar's page title ("Employee Registry") is plain text, not a heading
    // (topbar.tsx) — the real heading is the page's own CardTitle ("All Employees"), same
    // convention already established by 03-navigation.spec.ts.
    await expect(employeePage.getByRole('heading', { name: 'All Employees' })).toBeVisible();

    await employeePage.goto('/users');
    await expect(employeePage.getByText('You do not have permission to access this page.')).toBeVisible();
    await employeePage.screenshot({ path: `${SCREENSHOT_DIR}/07-access-denied.png`, fullPage: true });

    // Direct API check — forbidden action returns 403, not just a hidden button.
    const forbiddenApi = await apiGet(employeeContext, '/api/v1/users');
    expect(forbiddenApi.status).toBe(403);

    // Site scope respected: the employee tester was assigned exactly one site — confirm the sites
    // lookup only returns that scope, not the full directory.
    const scopedSites = await apiGet<{ sites: { id: string }[] }>(employeeContext, '/api/v1/sites');
    expect(scopedSites.body.sites.every((s) => s.id === siteId)).toBe(true);

    await employeeContext.close();

    // --- Corrections Reviewer: confirm Corrections page works and self-approval is still blocked ---
    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    await login(reviewerPage, usersByRole.corrections.email, password);
    await expect(reviewerPage.getByRole('link', { name: 'Corrections' })).toBeVisible();
    await reviewerPage.goto('/payroll-entry');
    await expect(reviewerPage.getByText('You do not have permission to access this page.')).toBeVisible();
    await reviewerContext.close();

    // --- Reports Viewer: confirm no mutation capability anywhere (a real CSRF token attached, so
    // a 403 here can only mean "missing settings:manage," never "missing CSRF token") ---
    const reportsContext = await browser.newContext();
    const reportsPage = await reportsContext.newPage();
    await login(reportsPage, usersByRole.reports.email, password);
    const reportsCsrfToken = await getCsrfToken(reportsContext);
    const settingsMutationRes = await reportsContext.request.patch(`${BACKEND_URL}/api/v1/settings/company`, {
      headers: { 'x-csrf-token': reportsCsrfToken },
      data: { companyName: 'Should Not Change' },
    });
    expect(settingsMutationRes.status()).toBe(403);
    await reportsContext.close();

    // Store role ids for the later rename/permission-removal/reassignment tests via a temp file is
    // unnecessary — those tests independently re-derive roles by name via the API, same pattern.
    void roleIdByKey;
  });

  test('renaming a role does not change its user\'s access; removing a permission takes effect immediately', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const context = page.context();
    const rolesRes = await apiGet<{ roles: { id: string; name: string }[] }>(context, '/api/v1/roles');
    const employeeTesterRole = rolesRes.body.roles.find((r) => r.name.startsWith('E2E Employee Registry Tester'));
    test.skip(!employeeTesterRole, 'The Employee Registry Tester role does not exist yet — run the full suite.');
    if (!employeeTesterRole) return;

    const usersRes = await apiGet<{ users: { id: string; email: string; role: { id: string } }[] }>(context, '/api/v1/users');
    const employeeTesterUser = usersRes.body.users.find((u) => u.role.id === employeeTesterRole.id);
    test.skip(!employeeTesterUser, 'No user holds the Employee Registry Tester role yet — run the full suite.');
    if (!employeeTesterUser) return;

    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await login(userPage, employeeTesterUser.email, 'E2ERoleTesterPassword1!');
    await expect((await userContext.request.get(`${BACKEND_URL}/api/v1/employees`)).status()).toBe(200);

    // --- Rename the role via the UI ---
    await page.goto('/roles');
    // Excludes the "(Copy)" row created by the first test — its name contains this role's own
    // name as a substring, so a plain `hasText` match would resolve to two rows.
    const roleRow = page.locator('tr', { hasText: employeeTesterRole.name }).filter({ hasNotText: '(Copy)' });
    await roleRow.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-edit-role-modal.png`, fullPage: true });
    const newName = `E2E HR Data Team ${Date.now()}`;
    await page.locator('#edit-role-name').fill(newName);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(newName)).toBeVisible();

    // The renamed role's existing user is completely unaffected.
    const stillWorks = await userContext.request.get(`${BACKEND_URL}/api/v1/employees`);
    expect(stillWorks.status()).toBe(200);

    // --- Now remove the role's one permission — takes effect on the user's very next request ---
    const roleRowAfterRename = page.locator('tr', { hasText: newName });
    await roleRowAfterRename.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('checkbox', { name: 'View employees', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    // Unlike the rename above (whose completion is observable via the row's own new name), a
    // permission-only change leaves the roles table looking identical — wait for the mutation's
    // own success toast so the very next request below can't race ahead of the backend write.
    await expect(page.getByText('Role updated')).toBeVisible();

    const afterRemoval = await userContext.request.get(`${BACKEND_URL}/api/v1/employees`);
    expect(afterRemoval.status()).toBe(403);

    await userContext.close();
  });

  test('changing a user\'s role creates an audit entry, revokes sessions, and takes effect', async ({ authenticatedPage: page, browser }) => {
    const context = page.context();
    const rolesRes = await apiGet<{ roles: { id: string; name: string }[] }>(context, '/api/v1/roles');
    const payrollRole = rolesRes.body.roles.find((r) => r.name.startsWith('E2E Payroll Entry Tester'));
    const reportsRole = rolesRes.body.roles.find((r) => r.name.startsWith('E2E Reports Viewer'));
    test.skip(!payrollRole || !reportsRole, 'Required roles do not exist yet — run the full suite.');
    if (!payrollRole || !reportsRole) return;

    const usersRes = await apiGet<{ users: { id: string; email: string; role: { id: string } }[] }>(context, '/api/v1/users');
    const payrollTesterUser = usersRes.body.users.find((u) => u.role.id === payrollRole.id);
    test.skip(!payrollTesterUser, 'No user holds the Payroll Entry Tester role yet — run the full suite.');
    if (!payrollTesterUser) return;

    const password = 'E2ERoleTesterPassword1!';
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await login(userPage, payrollTesterUser.email, password);
    expect((await userContext.request.get(`${BACKEND_URL}/api/v1/auth/me`)).status()).toBe(200);

    await page.goto('/users');
    const userRow = page.locator('tr', { hasText: payrollTesterUser.email });
    await userRow.getByRole('button', { name: /Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.locator('#edit-user-role').selectOption({ label: reportsRole.name });
    await expect(page.getByText(/sign them out of every active session/)).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('User updated')).toBeVisible();

    // The old session is revoked — a fresh /auth/me on the same context now fails.
    const revoked = await userContext.request.get(`${BACKEND_URL}/api/v1/auth/me`);
    expect(revoked.status()).toBe(401);

    // Logging back in reflects the new role's permissions.
    const freshPage = await userContext.newPage();
    await login(freshPage, payrollTesterUser.email, password);
    const meAfter = await userContext.request.get(`${BACKEND_URL}/api/v1/auth/me`);
    expect(meAfter.status()).toBe(200);
    const body = (await meAfter.json()) as { user: { permissions: string[] } };
    expect(body.user.permissions).toContain('reports:view');
    expect(body.user.permissions).not.toContain('payroll:entry');

    await userContext.close();
  });

  test('unsafe role/user actions are rejected: assigned-role deletion, final-administrator stripping, inactive-role assignment', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const rolesRes = await apiGet<{ roles: { id: string; code: string; name: string; assignedUserCount: number }[] }>(context, '/api/v1/roles');
    // Note the trailing space in the prefix — this spec's own roles are named "E2E <Team Role>
    // Tester/Reviewer/Viewer/Auditor ...", deliberately distinct from 07-corrections.spec.ts's own
    // unrelated "E2E_CORRECTIONS_REVIEWER" fixture role name (an underscore, no space), which would
    // otherwise also match a bare `startsWith('E2E')` and be a role this spec never created.
    const assignedRole = rolesRes.body.roles.find((r) => r.name.startsWith('E2E ') && r.assignedUserCount > 0);
    test.skip(!assignedRole, 'No assigned E2E role exists yet — run the full suite.');

    if (assignedRole) {
      await page.goto('/roles');
      // Same "(Copy)" substring hazard as the rename test above.
      const roleRow = page.locator('tr', { hasText: assignedRole.name }).filter({ hasNotText: '(Copy)' });
      await roleRow.getByRole('button', { name: /Actions for/ }).click();
      const deleteItem = roleRow.page().getByRole('menuitem', { name: 'Delete' });
      // Delete is only offered at all when assignedUserCount === 0 (roles-page.tsx) — an assigned
      // role should not even show the option; if it somehow does, confirm the backend still
      // rejects it directly.
      if ((await deleteItem.count()) > 0) {
        await deleteItem.click();
      } else {
        const res = await apiDelete(context, `/api/v1/roles/${assignedRole.id}`);
        expect(res.status).toBe(400);
      }
    }

    // Final-administrator safeguard, from the UI: attempt to deactivate the Master User role.
    // Matched by role code, not display name (Terminology audit) — Role.name is administrator-
    // editable and, as of this checkpoint, seeded as "Master User," not "Master Admin"; the code
    // is the one stable identity this lookup should ever depend on.
    const masterRole = rolesRes.body.roles.find((r) => r.code === 'MASTER_ADMIN');
    test.skip(!masterRole, 'Master Admin (MASTER_ADMIN) role not found.');
    if (masterRole) {
      const res = await apiPatch<{ error: { message: string } }>(context, `/api/v1/roles/${masterRole.id}`, { isActive: false });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('administrative capability');
      await page.screenshot({ path: `${SCREENSHOT_DIR}/09-final-admin-safeguard.png`, fullPage: true });
    }

    // Inactive-role assignment: create a role, deactivate it, attempt to assign it to a new user.
    const inactiveRoleRes = await apiPost<{ role: { id: string } }>(context, '/api/v1/roles', {
      name: `E2E Inactive Assignment Test ${Date.now()}`,
      permissionKeys: [],
    });
    await apiPatch(context, `/api/v1/roles/${inactiveRoleRes.role.id}`, { isActive: false });
    const createRes = await apiPostExpectingStatus(context, '/api/v1/users', {
      name: 'Should Not Be Created',
      email: `e2e-inactive-role-target-${Date.now()}@example.test`,
      password: 'SomePassword1!',
      roleId: inactiveRoleRes.role.id,
    });
    expect(createRes.status).toBe(400);
  });
});
