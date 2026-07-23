import { test, expect, login, getCsrfToken } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { BACKEND_URL } from '../setup/config';

/**
 * UAT Defect 1 (Post-Phase-5 Stabilization Checkpoint 4D correction) — a custom "Payroll Manager"
 * role granted `sites:manage` could previously create a Project Site but never see it, or any
 * other site, in the Sites list (`listProjectSites`, `backend/src/modules/project-sites/
 * project-sites.service.ts`, scoped visibility to the literal seeded Master Admin `roleCode` only).
 * Fixed by granting the same unrestricted visibility to any role — system or custom — currently
 * holding `sites:manage`, one of this system's `CRITICAL_ADMIN_PERMISSIONS`. This spec drives the
 * full real-stack reproduction and fix verification through the real UI: real backend, real
 * database, real permissions, real CSRF.
 */
test.describe('Custom-role Sites visibility (UAT Defect 1)', () => {
  test('a custom Payroll Manager role with sites:manage sees existing sites, sees a newly created one without logout, and loses access the moment the permission is removed', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const label = Date.now();

    // --- Pre-existing sites, created before the custom role even exists — the exact "existing
    // sites do not appear" symptom from the UAT report. ---
    const existingSiteA = await apiPost<{ site: { id: string; name: string } }>(
      adminPage.context(),
      '/api/v1/sites',
      { name: `E2E Site Visibility Existing A ${label}` },
    );
    const existingSiteB = await apiPost<{ site: { id: string; name: string } }>(
      adminPage.context(),
      '/api/v1/sites',
      { name: `E2E Site Visibility Existing B ${label}` },
    );

    // --- Create the custom role through the real Roles & Permissions UI ---
    await adminPage.goto('/roles');
    await adminPage.getByRole('button', { name: 'New Role' }).click();
    await adminPage.locator('#role-name').fill(`E2E Payroll Manager ${label}`);
    await adminPage.getByRole('checkbox', { name: 'Manage project sites & units', exact: true }).click();
    await adminPage.getByRole('button', { name: 'Create role' }).click();
    await expect(adminPage.getByText(`E2E Payroll Manager ${label}`)).toBeVisible();

    // --- Create a user assigned to that role, with one representative site assignment (the
    // assignment is not what should be granting visibility here — sites:manage alone must). ---
    const email = `e2e-payroll-manager-${label}@example.test`;
    const password = 'E2EPayrollManagerPassword1!';
    await adminPage.goto('/users');
    await adminPage.getByRole('button', { name: 'New User' }).click();
    await adminPage.locator('#user-name').fill('E2E Payroll Manager');
    await adminPage.locator('#user-email').fill(email);
    await adminPage.locator('#user-password').fill(password);
    await adminPage.locator('#user-role').selectOption({ label: `E2E Payroll Manager ${label}` });
    const assignedSiteCheckbox = adminPage
      .getByRole('dialog')
      .getByRole('checkbox', { name: existingSiteA.site.name, exact: true });
    if ((await assignedSiteCheckbox.count()) > 0) {
      await assignedSiteCheckbox.click();
    }
    await adminPage.getByRole('button', { name: 'Create user' }).click();
    await expect(adminPage.getByText(email)).toBeVisible();

    // --- Log in as the Payroll Manager ---
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    // 1-2. Sites navigation appears.
    await expect(page.getByRole('link', { name: 'Project Sites' })).toBeVisible();

    // 3. Both pre-existing sites appear — the core reported defect.
    await page.goto('/sites');
    await expect(page.getByRole('heading', { name: 'All Sites' })).toBeVisible();
    await expect(page.getByText(existingSiteA.site.name)).toBeVisible();
    await expect(page.getByText(existingSiteB.site.name)).toBeVisible();
    // Never rendered as a genuine empty state — "No project sites yet" must not appear.
    await expect(page.getByText('No project sites yet')).toHaveCount(0);

    // 4. User creates a site.
    const createdSiteName = `E2E Site Visibility Created By Manager ${label}`;
    await page.getByRole('button', { name: 'New Site' }).click();
    await page.locator('#site-name').fill(createdSiteName);
    await page.getByRole('button', { name: 'Create site' }).click();
    await expect(page.getByText('Site created')).toBeVisible();

    // 5. Expected site list updates without logout — the create mutation's own query
    // invalidation (use-project-sites.ts) refetches the list in place.
    await expect(page.getByText(createdSiteName)).toBeVisible();

    // 6. Browser refresh preserves correct data.
    await page.reload();
    await expect(page.getByText(existingSiteA.site.name)).toBeVisible();
    await expect(page.getByText(existingSiteB.site.name)).toBeVisible();
    await expect(page.getByText(createdSiteName)).toBeVisible();

    // 7. Direct API response matches the UI.
    const apiSites = await apiGet<{ sites: { id: string; name: string }[] }>(context, '/api/v1/sites');
    const apiSiteNames = apiSites.body.sites.map((s) => s.name);
    expect(apiSiteNames).toEqual(expect.arrayContaining([existingSiteA.site.name, existingSiteB.site.name, createdSiteName]));

    // 9. Renaming the role does not alter access (verified before removing the permission below).
    const rolesRes = await apiGet<{ roles: { id: string; name: string }[] }>(adminPage.context(), '/api/v1/roles');
    const role = rolesRes.body.roles.find((r) => r.name === `E2E Payroll Manager ${label}`);
    if (!role) throw new Error('Expected the just-created Payroll Manager role to exist');

    const renameCsrfToken = await getCsrfToken(adminPage.context());
    const renameRes = await adminPage.context().request.patch(`${BACKEND_URL}/api/v1/roles/${role.id}`, {
      headers: { 'x-csrf-token': renameCsrfToken },
      data: { name: `E2E Payroll Manager Renamed ${label}` },
    });
    expect(renameRes.status()).toBe(200);

    await page.reload();
    await expect(page.getByText(existingSiteA.site.name)).toBeVisible();
    await expect(page.getByText(createdSiteName)).toBeVisible();

    // 8. Removing the permission removes access — same session, next request, no forced logout.
    const revokeCsrfToken = await getCsrfToken(adminPage.context());
    const revokeRes = await adminPage.context().request.patch(`${BACKEND_URL}/api/v1/roles/${role.id}`, {
      headers: { 'x-csrf-token': revokeCsrfToken },
      data: { permissionKeys: [] },
    });
    expect(revokeRes.status()).toBe(200);

    const revokedSitesRes = await apiGet(context, '/api/v1/sites');
    expect(revokedSitesRes.status).toBe(403);

    // An authorization error is never rendered as a legitimate empty state. With the permission
    // gone, the route-level guard (RequirePermission, App.tsx) intercepts before the Sites page
    // component ever mounts, showing the shared "access denied" page — a stronger version of the
    // same invariant than the page's own inline error state (project-sites-page.tsx) covers for a
    // query that fails while the page is already mounted (e.g. a mid-session/backend error rather
    // than a route-guard-caught permission loss). Either way, "No project sites yet" must never
    // appear for this reason.
    await page.reload();
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await expect(page.getByText('No project sites yet')).toHaveCount(0);

    await context.close();
  });

  // UAT Defect 2 (System-Wide RBAC Consistency remediation) — the reported production
  // contradiction: a custom role with `sites:manage` could list every Project Site (the fix
  // above) but got "You do not have access to this project site" creating a Branch/Unit under one,
  // since `requireSiteAccess` (the Project Units route middleware) only bypassed for the literal
  // Master Admin role code, never for the `sites:manage` permission `listProjectSites` already
  // recognized. Fixed by teaching `requireSiteAccess` the same permission-based global-authority
  // rule (`common/authz-policy.ts`'s `assertSiteAccess`), applied consistently to both the Unit
  // list and Unit create routes. Driven through the real UI end to end, not just the API.
  test('a custom Payroll Manager role with sites:manage can list, create, and rename a Branch under any site — not just an assigned one', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const label = Date.now();

    const site = await apiPost<{ site: { id: string; name: string; unitLabel: string } }>(
      adminPage.context(),
      '/api/v1/sites',
      { name: `E2E Branch Global Authority Site ${label}` },
    );

    const role = await apiPost<{ role: { id: string } }>(adminPage.context(), '/api/v1/roles', {
      name: `E2E Branch Global Authority Role ${label}`,
      permissionKeys: ['sites:manage'],
    });

    const email = `e2e-branch-global-authority-${label}@example.test`;
    const password = 'E2EBranchGlobalAuthority1!';
    // Deliberately no siteIds — this user's only path to site visibility/authority is
    // sites:manage, exactly the reported production persona.
    await apiPost(adminPage.context(), '/api/v1/users', {
      name: 'E2E Branch Global Authority',
      email,
      password,
      roleId: role.role.id,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    await page.goto('/sites');
    await expect(page.getByText(site.site.name)).toBeVisible();

    // Open the site's own "Manage Branches" action — the previously-broken read path.
    await page.getByRole('button', { name: `Actions for ${site.site.name}` }).click();
    await page.getByRole('menuitem', { name: /^Manage Branch/ }).click();
    await expect(page.getByText('No branches yet')).toBeVisible();

    // Create a Branch under this unassigned-but-sites:manage-visible site — the exact previously
    // 403'ing action.
    await page.getByRole('button', { name: 'New Branch' }).click();
    const branchName = `E2E Branch Created ${label}`;
    await page.locator('#unit-name').fill(branchName);
    await page.getByRole('button', { name: 'Create branch' }).click();
    await expect(page.getByText('Branch created', { exact: true })).toBeVisible();
    await expect(page.getByText(branchName)).toBeVisible();

    // Rename it — the same previously-403'ing scope applies to update too, though update was
    // already permission-only gated; asserted here for full-flow regression coverage.
    await page.getByRole('button', { name: `Actions for ${branchName}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const renamedBranchName = `${branchName} Renamed`;
    await page.locator('#unit-name').fill(renamedBranchName);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(renamedBranchName)).toBeVisible();

    // Direct API confirms the same, from a fresh request — not just an optimistic UI update.
    const unitsRes = await apiGet<{ units: { name: string }[] }>(context, `/api/v1/sites/${site.site.id}/units`);
    expect(unitsRes.body.units.some((u) => u.name === renamedBranchName)).toBe(true);

    await context.close();
  });

  test('an unauthorized user cannot enumerate sites at all', async ({ authenticatedPage: adminPage, browser }) => {
    const label = Date.now();
    await apiPost(adminPage.context(), '/api/v1/sites', { name: `E2E Site No Enumeration ${label}` });

    // A dedicated custom role with zero permissions — none of SITE_LOOKUP_PERMISSIONS
    // (project-sites.routes.ts) qualify, unlike the real seeded Payroll Staff/Finance roles, which
    // already hold a qualifying permission (payroll:entry/payroll:view) by default and can't be
    // stripped here without affecting every other spec sharing that same seeded role.
    const role = await apiPost<{ role: { id: string } }>(adminPage.context(), '/api/v1/roles', {
      name: `E2E No Site Access Role ${label}`,
      permissionKeys: [],
    });

    const email = `e2e-no-site-access-${label}@example.test`;
    const password = 'E2ENoSiteAccessPassword1!';
    await apiPost(adminPage.context(), '/api/v1/users', {
      name: 'E2E No Site Access',
      email,
      password,
      roleId: role.role.id,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    const res = await apiGet(context, '/api/v1/sites');
    expect(res.status).toBe(403);

    await context.close();
  });
});

/**
 * UAT Defect 3 (System-Wide RBAC Consistency remediation) — a custom "Payroll Manager" role could
 * reach the Employee Registry (`employees:view`) and open New Employee (`employees:create`), but
 * the existing employee list came back empty. Root cause: Employees is a site-scoped operational
 * domain with no global-administration permission of its own — `sites:manage` (which this same
 * persona held, and which grants unrestricted Project Site visibility) was never meant to widen
 * Employee access, and does not after this fix either. The actual, correct fix is two-fold:
 * (1) the empty state must be distinguishable from "you have no assigned sites" so this is never
 * mistaken for a bug or an empty registry, and (2) every site selector the Employee Registry
 * itself offers (the site filter, the New/Edit Employee site picker) must be scoped to this user's
 * real accessible sites, never the broader sites:manage-unlocked list — so the UI never offers a
 * site the Employee Registry would return zero records for.
 */
test.describe('Employee Registry visibility (UAT Defect 3)', () => {
  test('a Payroll Manager with sites:manage and employees:view sees a distinct "no assigned sites" state until assigned, then sees exactly their site\'s employees', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const label = Date.now();
    const { siteId, employeeId } = await createSiteWithEmployee(adminPage.context(), `emp-visibility-${label}`);

    const role = await apiPost<{ role: { id: string } }>(adminPage.context(), '/api/v1/roles', {
      name: `E2E Employee Visibility Payroll Manager ${label}`,
      permissionKeys: ['sites:manage', 'employees:view', 'employees:create'],
    });

    const email = `e2e-employee-visibility-${label}@example.test`;
    const password = 'E2EEmployeeVisibility1!';
    // Deliberately no siteIds at first — reproduces the exact reported defect setup.
    const user = await apiPost<{ user: { id: string } }>(adminPage.context(), '/api/v1/users', {
      name: 'E2E Employee Visibility Manager',
      email,
      password,
      roleId: role.role.id,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    // Sees every site (sites:manage is global for that domain)...
    await page.goto('/sites');
    await expect(page.getByText('All Sites')).toBeVisible();

    // ...but the Employee Registry shows the distinct "no assigned sites" state, not a generic
    // empty registry and not a 403 — sites:manage grants no Employee access on its own.
    await page.goto('/employees');
    await expect(page.getByText('You have no assigned project sites')).toBeVisible();
    await expect(page.getByText('No employees found')).toHaveCount(0);

    const emptyRes = await apiGet<{ employees: unknown[] }>(context, '/api/v1/employees');
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body.employees).toEqual([]);

    // Now actually assign the site — the fix is assignment, not a permanent block.
    const assignCsrfToken = await getCsrfToken(adminPage.context());
    const assignRes = await adminPage.context().request.patch(`${BACKEND_URL}/api/v1/users/${user.user.id}`, {
      headers: { 'x-csrf-token': assignCsrfToken },
      data: { siteIds: [siteId] },
    });
    expect(assignRes.status()).toBe(200);

    // Role reassignment/permission edits take effect on the very next request, no forced logout
    // (docs/architecture/authentication.md) — a plain reload is enough.
    await page.reload();
    await expect(page.getByText('No employees found')).toHaveCount(0);
    await expect(page.getByText('You have no assigned project sites')).toHaveCount(0);

    const scopedRes = await apiGet<{ employees: { id: string }[] }>(context, '/api/v1/employees');
    expect(scopedRes.body.employees.some((e) => e.id === employeeId)).toBe(true);

    await context.close();
  });
});
