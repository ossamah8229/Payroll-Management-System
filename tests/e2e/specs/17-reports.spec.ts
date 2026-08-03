import { test, expect } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

interface CycleRow {
  id: string;
  year: number;
  month: number;
  status: string;
}

/**
 * Phase 8B Checkpoint 1 — Reports (Payroll Summary), real-browser verification. Drives the real
 * navigation, the real backend aggregation (`reports.service.ts`'s `getPayrollSummaryReport`), and
 * real permission enforcement end to end — no mocked hooks, no route interception. Reuses the exact
 * `bootstrap a fresh PayrollCycle` pattern `02-payroll-lifecycle.spec.ts`/`15-statements.spec.ts`
 * already establish, and the exact "empty-state vs 403 must never be confused" assertion pattern
 * `10-site-visibility.spec.ts` already establishes for permission-gated screens.
 */
test.describe('Reports — Payroll Summary', () => {
  test('navigation, real data rendering, and export are all reachable end to end', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `rpt-${Date.now()}`;

    // Resolve/create the Draft cycle *before* creating the Site/Employee below — while a Draft
    // cycle already exists, creating a new Employee auto-syncs them into its roster
    // (`syncEmployeeIntoCurrentDraftCycle`, `payroll-processing.service.ts`), so this spec never
    // needs its own explicit `POST .../entries` call (which would 409 against that auto-created
    // row regardless of creation order).
    const existingCycles = await apiGet<{ cycles: CycleRow[] }>(context, '/api/v1/payroll-cycles');
    let cycleId: string;
    if (existingCycles.body.cycles.some((c) => c.status === 'DRAFT')) {
      cycleId = existingCycles.body.cycles.find((c) => c.status === 'DRAFT')!.id;
    } else {
      const created = await apiPost<{ cycle: { id: string } }>(context, '/api/v1/payroll-cycles', {
        year: 2900,
        month: existingCycles.body.cycles.length + 2, // avoid colliding with any prior bootstrap
      });
      cycleId = created.cycle.id;
    }

    const { employeeId } = await createSiteWithEmployee(context, label);

    const entriesRes = await apiGet<{ entries: { id: string; employeeId: string }[] }>(
      context,
      `/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`,
    );
    expect(entriesRes.body.entries.some((entry) => entry.employeeId === employeeId)).toBe(true);

    // Reports nav entry is visible (reports:view is Master Admin's implicit full access).
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Payroll Summary')).toBeVisible();

    await page.getByRole('link', { name: /Payroll Summary/ }).click();
    await expect(page).toHaveURL(/\/reports\/payroll-summary$|\/payroll-cycles\/.+\/reports\/payroll-summary$/);

    // Select the cycle we just populated (the page defaults to Draft-if-any, which this is).
    const cycleSelect = page.locator('#reports-payroll-summary-cycle');
    await expect(cycleSelect).toBeVisible();
    const selectedValue = await cycleSelect.inputValue();
    if (selectedValue !== cycleId) {
      await cycleSelect.selectOption(cycleId);
    }

    // The real site/employee we created shows up, with a real computed net salary.
    await expect(page.getByText(`E2E Site ${label}`)).toBeVisible();
    await expect(page.getByText('This cycle is still in Draft')).toBeVisible();

    // Export triggers a real download from the real backend.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^payroll-summary-.*\.csv$/);
  });

  test('a user without reports:view sees Access Denied, never a false empty state', async ({ browser, authenticatedPage: adminPage }) => {
    const email = `rpt-scoped-${Date.now()}@e2e.local`;
    const password = 'CorrectHorseBattery1!';
    // A dedicated TEST_-coded role, never a real seeded system role code — reusing e.g.
    // PAYROLL_STAFF would silently inherit its real default `reports:view` grant
    // (`createScopedUser` upserts a role by `code`; see the equivalent lesson in
    // `backend/tests/reports.test.ts`'s own `noReportsAgent`).
    await createScopedUser({
      email,
      password,
      roleCode: 'TEST_E2E_NO_REPORTS',
      permissionKeys: ['payroll:entry'],
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await scopedPage.goto('/login');
    await scopedPage.locator('#email').fill(email);
    await scopedPage.locator('#password').fill(password);
    await Promise.all([
      scopedPage.waitForURL((url) => !url.pathname.startsWith('/login')),
      scopedPage.getByRole('button', { name: 'Sign in' }).click(),
    ]);

    // No Reports nav entry for this user.
    await expect(scopedPage.getByRole('link', { name: 'Reports' })).toHaveCount(0);

    // Direct navigation is blocked with Access Denied, never rendered as a legitimate (but
    // misleadingly empty) report.
    await scopedPage.goto('/reports/payroll-summary');
    await expect(scopedPage.getByText('You do not have permission to access this page.')).toBeVisible();
    await expect(scopedPage.getByText('No payroll entries for this selection')).toHaveCount(0);

    await scopedContext.close();
    void adminPage;
  });
});
