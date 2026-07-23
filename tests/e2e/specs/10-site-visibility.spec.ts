import { test, expect, login, getCsrfToken } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
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
