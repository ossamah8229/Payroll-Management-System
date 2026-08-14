import type { BrowserContext } from '@playwright/test';
import { test, expect, login, getCsrfToken } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createScopedUser } from '../helpers/create-scoped-user';
import { BACKEND_URL } from '../setup/config';

/**
 * UAT 2026-08-10 — Payroll Entry "New Employee" quick action. There was never a floating/hovering
 * "+" implementation in this app's real source (only in an early, discarded `reference/` prototype
 * concept — see docs/PROJECT_PROGRESS.md and docs/design-system.md for the corrected history); the
 * approved, shipped pattern is a normal top-level `+ New Employee` button in Payroll Entry's own
 * toolbar, opening the exact same `EmployeeFormModal` (`frontend/src/components/employees/
 * employee-form-modal.tsx`) Employee Registry's own "New Employee" action already uses — extracted
 * from `employees-page.tsx` (previously page-local) rather than duplicated, so there is exactly one
 * employee-create form, one validation path, one submission path, one permission gate.
 */

async function ensureCycleExists(context: BrowserContext): Promise<void> {
  await apiPost(context, '/api/v1/payroll-cycles', { year: 2900, month: 9 }).catch(() => undefined);
}

test.describe('Payroll Entry — New Employee quick action', () => {
  test('Payroll Entry has a normal top-level "+ New Employee" button, not a floating/hovering one', async ({
    authenticatedPage: page,
  }) => {
    await ensureCycleExists(page.context());
    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');

    const button = page.getByRole('button', { name: 'New Employee' });
    await expect(button).toBeVisible();

    // A normal, in-flow toolbar button — never a fixed/absolute-positioned circular FAB.
    const position = await button.evaluate((el) => getComputedStyle(el).position);
    expect(['static', 'relative']).toContain(position);

    // No floating-action-button element exists anywhere on the page (the discarded prototype's own
    // `.quick-add-btn` class, or any other fixed-position "+"-style control).
    const fabCount = await page.locator('.quick-add-btn, [class*="floating"]').count();
    expect(fabCount).toBe(0);

    // Exactly one "New Employee" button on the page — no duplicate/second action.
    await expect(page.getByRole('button', { name: 'New Employee' })).toHaveCount(1);
  });

  test('opens the same EmployeeFormModal as Employee Registry, always blank, and creates via the same API', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await ensureCycleExists(context);
    const label = `E2E QuickAdd Site ${Date.now()}`;
    const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: label });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E QuickAdd Unit ${Date.now()}`,
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');

    // Hostile-review strengthening (2026-08-10): capture every request to the create route for the
    // rest of this test, so "no duplicated API request" is an explicit count assertion rather than
    // relying on `waitForResponse` resolving to the first match and staying silent about a second.
    const createRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/api\/v1\/employees$/.test(req.url())) {
        createRequests.push(req.url());
      }
    });

    await page.getByRole('button', { name: 'New Employee' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('New Employee', { exact: true })).toBeVisible();

    // Blank/generic create state — identical field ids to Employee Registry's own modal (proof it's
    // the same component, not a second implementation).
    await expect(page.locator('#emp-name')).toHaveValue('');
    await expect(page.locator('#emp-designation')).toHaveValue('');
    await expect(page.locator('#emp-gross-pay')).toHaveValue('');

    const employeeName = `PW Quick Add ${Date.now()}`;
    await page.locator('#emp-name').fill(employeeName);
    await page.locator('#emp-designation').fill('Site Engineer');
    await page.locator('#emp-gross-pay').fill('55000');
    await page.selectOption('#site-unit-select-site', site.site.id);
    await page.selectOption('#site-unit-select-unit', unit.unit.id);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/v1/employees') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Create employee' }).click(),
    ]);
    // The one Employee Create API route — no second/duplicate create endpoint.
    expect(createResponse.url()).toMatch(/\/api\/v1\/employees$/);
    expect(createResponse.status()).toBe(201);

    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Employee created')).toBeVisible();

    // Never navigated away to Employee Registry (or anywhere else) — the whole flow stays on
    // Payroll Entry.
    expect(page.url()).toMatch(/\/payroll-(entry|cycles\/.+\/payroll-entry)$/);

    // Exactly one POST to the create route for this whole single-click submission — no accidental
    // double-submit (the button's own `disabled={isPending}` is what prevents this; asserted here
    // as an explicit outcome, not inferred from the button's implementation).
    expect(createRequests).toHaveLength(1);

    // Payroll Entry refreshes without a full browser refresh — the new employee's row appears in
    // this cycle's grid (the backend already synced it into the current Draft cycle at creation
    // time; this proves the frontend's own query cache picks that up). Scoped to this test's own
    // site via the grid's site filter — this suite runs sequentially against one shared, disposable
    // cycle accumulating fixture rows from every earlier spec, and the virtualized grid only mounts
    // rows currently scrolled into view, so an unscoped search could miss a real, present row.
    await page.locator('#payroll-entry-site-filter').click();
    await page.getByRole('menuitemcheckbox', { name: label }).click();
    await page.keyboard.press('Escape');
    const employeeRow = page.getByRole('table', { name: 'Payroll Entry grid' }).getByText(employeeName);
    await expect(employeeRow).toBeVisible({ timeout: 5000 });
    // Exactly one row for this employee — never a duplicate PayrollEntry from a double-create.
    await expect(employeeRow).toHaveCount(1);

    // Reopening always starts blank again (never carries the just-created employee's values into
    // the next open).
    await page.getByRole('button', { name: 'New Employee' }).click();
    await expect(page.locator('#emp-name')).toHaveValue('');
    await page.keyboard.press('Escape');

    // The same employee is visible in Employee Registry too — one shared record, one shared query
    // invalidation (`useCreateEmployee`'s `onSuccess`), not a second employee list.
    await page.goto(`/employees?search=${encodeURIComponent(employeeName)}`);
    await expect(page.getByText(employeeName)).toBeVisible();
  });

  /**
   * Hostile-review finding (2026-08-10, same-day follow-up): the Historical Payroll Cycle Selector
   * lets Payroll Entry display a read-only Released/Archived cycle, and `employees.service.ts`
   * syncs a newly created employee into whichever cycle is currently *globally DRAFT* — never
   * necessarily the cycle this page happens to be viewing. `usePayrollEntries`'s own
   * `staleTime: Infinity` means a cycle's cached entries are never invalidated except explicitly —
   * an initial version of `handleEmployeeCreated` invalidated whatever `cycleId` the URL currently
   * named, which is wrong when that isn't the Draft cycle: the new employee would silently never
   * appear on the real Draft cycle without a full browser refresh. Proves the fixed behavior: create
   * from an Archived cycle's view, then switch to the Draft cycle via the in-app Cycle selector
   * (never `page.goto`, which would trivially "fix" this by wiping the whole client-side cache) and
   * confirm the row is there.
   */
  test('New Employee created while viewing an Archived cycle still appears on the Draft cycle after switching, without a full page reload', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const cyclesRes = await apiGet<{ cycles: { id: string; status: string }[] }>(context, '/api/v1/payroll-cycles');
    const draftCycleBefore = cyclesRes.body.cycles.find((c) => c.status === 'DRAFT');
    test.skip(!draftCycleBefore, 'No Draft cycle exists yet — run the full suite, not this file alone.');
    if (!draftCycleBefore) return;

    // Roll the current Draft over into Archived so a real historical cycle exists to view —
    // best-effort: if an earlier spec's unresolved data blocks Finalize, skip rather than fail on
    // an unrelated precondition this test doesn't own.
    const rolled = await apiPost<{ newCycle: { id: string } }>(
      context,
      `/api/v1/payroll-cycles/${draftCycleBefore.id}/units/release-all`,
      {},
    )
      .then(() => apiPost(context, `/api/v1/payroll-cycles/${draftCycleBefore.id}/finalize`, {}))
      .then(() =>
        apiPost<{ newCycle: { id: string } }>(
          context,
          `/api/v1/payroll-cycles/${draftCycleBefore.id}/archive-and-create-next`,
          {},
        ),
      )
      .catch(() => null);
    test.skip(!rolled, 'Could not roll the shared Draft cycle over (unrelated precondition) — skipping.');
    if (!rolled) return;

    const archivedCycleId = draftCycleBefore.id;
    const draftCycleId = rolled.newCycle.id;

    const label = `E2E ArchivedCreate ${Date.now()}`;
    const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: label });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `${label} Unit`,
    });

    // One single navigation for the whole test — every cycle switch after this goes through the
    // in-app Cycle selector, exactly like a real user, preserving the client-side query cache.
    await page.goto(`/payroll-cycles/${draftCycleId}/payroll-entry`);
    await page.waitForLoadState('networkidle');

    await page.selectOption('#payroll-entry-cycle', archivedCycleId);
    await expect(page).toHaveURL(new RegExp(archivedCycleId));

    const employeeName = `E2E Archived Create ${Date.now()}`;
    await page.getByRole('button', { name: 'New Employee' }).click();
    await page.locator('#emp-name').fill(employeeName);
    await page.locator('#emp-designation').fill('Tester');
    await page.locator('#emp-gross-pay').fill('30000');
    await page.selectOption('#site-unit-select-site', site.site.id);
    await page.selectOption('#site-unit-select-unit', unit.unit.id);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/v1/employees') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create employee' }).click(),
    ]);

    // Correctly does NOT appear on the Archived cycle itself — it was never added there.
    await expect(page.getByRole('table', { name: 'Payroll Entry grid' }).getByText(employeeName)).not.toBeVisible();

    // Switch to the Draft cycle via the in-app selector (not page.goto) — the row must be there
    // already, with no reload.
    await page.selectOption('#payroll-entry-cycle', draftCycleId);
    await expect(page).toHaveURL(new RegExp(draftCycleId));
    await page.locator('#payroll-entry-site-filter').click();
    await page.getByRole('menuitemcheckbox', { name: label }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('table', { name: 'Payroll Entry grid' }).getByText(employeeName)).toBeVisible({
      timeout: 5000,
    });
  });

  /**
   * UAT correction (2026-08-14) — the Unit selector in this same modal showed only the Unit name;
   * users rely on the Unit/branch code for quick recognition, especially with several similarly-
   * named units under one site. `SiteUnitSelect` (`frontend/src/components/ui/site-unit-select.tsx`)
   * is the one shared selector both this quick action and Employee Registry's own create/edit form
   * render through — fixed there, once. Real backend data throughout (a real `ProjectUnit.code`
   * from a real create call, a real Project Site selection triggering a real Unit fetch) — the Unit
   * API is never mocked for this flow, per this correction's own scope.
   */
  test('New Employee modal — selecting a Project Site loads Units labeled "Name (CODE)", the selected value shows the same, and the correct code stays paired with its own unit through a Site change', async ({
    authenticatedPage: page,
  }) => {
    const ctx = page.context();
    await ensureCycleExists(ctx);
    const label = `E2E UnitCode ${Date.now()}`;
    const siteOne = await apiPost<{ site: { id: string } }>(ctx, '/api/v1/sites', { name: `${label} One` });
    const siteTwo = await apiPost<{ site: { id: string } }>(ctx, '/api/v1/sites', { name: `${label} Two` });
    const unitA = await apiPost<{ unit: { id: string } }>(ctx, `/api/v1/sites/${siteOne.site.id}/units`, {
      name: 'General Administration',
      code: 'GA-01',
    });
    const unitB = await apiPost<{ unit: { id: string } }>(ctx, `/api/v1/sites/${siteOne.site.id}/units`, {
      name: 'Cleaning Department',
      code: 'CD-01',
    });
    // No code at all — a genuinely nullable field; must fall back to the plain name, never "(null)".
    const unitNoCode = await apiPost<{ unit: { id: string } }>(ctx, `/api/v1/sites/${siteOne.site.id}/units`, {
      name: 'Unlabeled Unit',
    });
    const unitOtherSite = await apiPost<{ unit: { id: string } }>(ctx, `/api/v1/sites/${siteTwo.site.id}/units`, {
      name: 'Other Site Branch',
      code: 'OS-01',
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');

    const unitRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && /\/api\/v1\/sites\/.+\/units$/.test(req.url())) {
        unitRequests.push(req.url());
      }
    });

    await page.getByRole('button', { name: 'New Employee' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Before a site is picked, the Unit selector is disabled and empty — no premature/unscoped fetch.
    await expect(page.locator('#site-unit-select-unit')).toBeDisabled();
    expect(unitRequests).toHaveLength(0);

    await page.selectOption('#site-unit-select-site', siteOne.site.id);
    await expect(page.locator('#site-unit-select-unit')).toBeEnabled();

    const unitSelect = page.locator('#site-unit-select-unit');
    await expect(unitSelect.locator('option', { hasText: 'General Administration (GA-01)' })).toHaveCount(1);
    await expect(unitSelect.locator('option', { hasText: 'Cleaning Department (CD-01)' })).toHaveCount(1);
    await expect(unitSelect.locator('option', { hasText: 'Unlabeled Unit' })).toHaveCount(1);
    // Never a bare "(null)"/"(undefined)" artifact for the no-code unit.
    await expect(unitSelect.locator('option', { hasText: '(null)' })).toHaveCount(0);

    // Exactly one Unit fetch for this one Site selection — the code came from that same response,
    // never a second, code-specific request.
    expect(unitRequests).toHaveLength(1);

    // Selecting Unit A shows "Name (CODE)" as the closed select's own displayed value too, and it's
    // genuinely paired with Unit A's own id (not a name-based guess) — select Unit B instead and
    // confirm the value/id move together.
    await page.selectOption('#site-unit-select-unit', unitA.unit.id);
    await expect(unitSelect).toHaveValue(unitA.unit.id);
    expect(await unitSelect.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]!.textContent)).toBe(
      'General Administration (GA-01)',
    );

    await page.selectOption('#site-unit-select-unit', unitB.unit.id);
    await expect(unitSelect).toHaveValue(unitB.unit.id);
    expect(await unitSelect.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]!.textContent)).toBe(
      'Cleaning Department (CD-01)',
    );

    // Changing the Project Site clears the now-incompatible Unit selection and loads the new site's
    // own units (a second, genuinely necessary fetch — not a duplicate of the first).
    await page.selectOption('#site-unit-select-site', siteTwo.site.id);
    await expect(unitSelect).toHaveValue('');
    await expect(unitSelect.locator('option', { hasText: 'Other Site Branch (OS-01)' })).toHaveCount(1);
    await expect(unitSelect.locator('option', { hasText: 'General Administration' })).toHaveCount(0);
    expect(unitRequests).toHaveLength(2);

    await page.selectOption('#site-unit-select-unit', unitOtherSite.unit.id);
    await expect(unitSelect).toHaveValue(unitOtherSite.unit.id);

    await page.keyboard.press('Escape');
    void unitNoCode;
  });

  test('employees:create permission behavior is preserved — hidden on both pages alike when absent', async ({
    browser,
  }) => {
    const email = `e2e-quickadd-noaccess-${Date.now()}@example.test`;
    const password = 'QuickAddNoAccess1!';
    await createScopedUser({
      email,
      password,
      roleCode: 'E2E_QUICKADD_NO_CREATE',
      // Enough to view both pages, deliberately without employees:create — the exact permission
      // EmployeeFormModal's own backend route (`EMPLOYEES_CREATE`) requires.
      permissionKeys: ['employees:view', 'payroll:entry'],
      name: 'E2E No Create Access',
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    await ensureCycleExists(context);

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'New Employee' })).toHaveCount(0);

    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'New Employee' })).toHaveCount(0);

    // The backend independently enforces this too — Payroll Entry is never a permission bypass,
    // even if a request bypassed the hidden UI entirely.
    const csrfToken = await getCsrfToken(context);
    const directAttempt = await context.request.post(`${BACKEND_URL}/api/v1/employees`, {
      data: { name: 'Bypass Attempt', designation: 'X', siteId: '00000000-0000-0000-0000-000000000000', unitId: '00000000-0000-0000-0000-000000000000', grossPay: '1' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(directAttempt.status()).toBe(403);

    await context.close();
  });
});
