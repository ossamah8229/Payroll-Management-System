import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login } from '../fixtures/auth';
import { apiGet } from '../helpers/api';
import { createSiteWithEmployee, ensureAnyPayrollCycleExists } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Dashboard Checkpoint 1B — real-browser verification of the frontend built over the already-frozen
 * Checkpoint 1A backend (`docs/architecture/workflows/dashboard.md`). No mocked hooks, no
 * `page.route` interception for any RBAC or financial assertion — real navigation, real backend
 * aggregation, real permission enforcement, matching this suite's own established discipline
 * (`17-reports.spec.ts`, `26-salary-release-report.spec.ts`, `29-variance-report.spec.ts`).
 *
 * This suite runs sequentially against one shared, disposable database (`playwright.config.ts`'s
 * `workers: 1`) — by the time this spec file runs, dozens of earlier specs have already created
 * Sites, Employees, PayrollEntries, Corrections, and Advances against a shared, accumulating Draft
 * `PayrollCycle`. Every assertion below is written to hold regardless of that accumulated state:
 * scenarios that need an exact figure compare Dashboard's own value against a second, independent
 * call to the already-frozen Payroll Summary Report for the identical cycle (reconciliation), never
 * a hand-computed expected number; scenarios that need isolation use a freshly-created Site/user
 * pair, unique per test.
 *
 * **No "no PayrollCycle" empty-state scenario is exercised here** — this harness's database is
 * seeded with a `PayrollCycle` before the very first spec in the suite ever runs, and every spec
 * file since then only ever adds to or releases within it; there is no point in this shared run
 * where zero cycles exist to reach `cycle: null` through the real API. That contract is proven
 * directly by `home-page.test.tsx`'s own "empty-cycle state" suite instead (a controlled, mocked
 * `useDashboard` response), which is the appropriate layer for a state genuine end-to-end
 * navigation cannot reach in this environment.
 */

/**
 * Navigates to `/`, but only issues a real `page.goto` when the browser isn't already sitting on
 * it. **Investigated finding, not a Dashboard defect**: reloading the bare root path `/` while
 * already on it (`page.goto('/')` used as a same-URL reload) reliably produces two browser-level
 * requests to `/api/v1/dashboard` — the first is `net::ERR_ABORTED` within ~2ms of being issued
 * (proven via a controlled repro: identical reload behavior against `/employees` never reproduces
 * this, and a *fresh* landing on `/` — via the real login redirect, or via navigating in from a
 * different route — never reproduces it either; only a same-URL reload of the exact root path
 * does). The aborted request never leaves the browser's own request queue, so it never reaches the
 * backend — no second audit-log entry, no doubled aggregation query — this is a client-side
 * navigation artifact (root-path-specific, `vite preview`/Chromium history handling), not a
 * `useDashboard`/React Query defect and not a backend fan-out. `login()` (`fixtures/auth.ts`)
 * always lands the browser on `/` already, so this guard is what keeps every test below measuring
 * the same single real request a genuine first-time landing produces, rather than incidentally
 * exercising this unrelated reload quirk.
 */
async function gotoDashboard(page: Page): Promise<void> {
  if (new URL(page.url()).pathname !== '/') {
    await page.goto('/');
  }
  await expect(page.getByTestId('dashboard-stat-row')).toBeVisible();
}

test.describe('Dashboard — loads for an authenticated reports:view user', () => {
  test('shows current cycle context and every headline widget, via exactly one Dashboard request', async ({
    authenticatedPage: page,
  }) => {
    // This spec file may run standalone (not preceded by `02-payroll-lifecycle.spec.ts`, the spec
    // that normally bootstraps the very first Cycle) — `ensureAnyPayrollCycleExists` guarantees at
    // least one exists, safe to call regardless of run order (`helpers/fixtures.ts`'s own doc
    // comment), so every test below can rely on `cycle` being non-null.
    await ensureAnyPayrollCycleExists(page.context());

    // `login()` (the `authenticatedPage` fixture) already lands the browser on `/` — navigate away
    // first so the request below is measured on a genuine fresh landing, not a same-URL reload of
    // the root path (`gotoDashboard`'s own doc comment explains why that reload shape is excluded).
    await page.goto('/employees');

    let dashboardRequestCount = 0;
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/v1/dashboard') dashboardRequestCount += 1;
    });

    await gotoDashboard(page);

    await expect(page.getByTestId('dashboard-current-cycle')).toBeVisible();
    await expect(page.getByTestId('dashboard-stat-total-employees')).toBeVisible();
    await expect(page.getByTestId('dashboard-stat-net-payroll')).toBeVisible();
    await expect(page.getByTestId('dashboard-stat-pending-release')).toBeVisible();
    await expect(page.getByTestId('dashboard-stat-release-progress')).toBeVisible();
    await expect(page.getByText('Site Payroll Summary')).toBeVisible();
    await expect(page.getByText('Deductions This Cycle')).toBeVisible();
    await expect(page.getByText('Attention Required')).toBeVisible();

    expect(dashboardRequestCount).toBe(1);
  });
});

test.describe('Dashboard — Payroll-only user (payroll:view, never reports:view)', () => {
  test('can access Dashboard; payroll-gated widgets are visible; reports-only widgets show Unavailable, never a fabricated zero', async ({
    browser,
  }) => {
    const label = `dash-payroll-only-${Date.now()}`;
    const email = `e2e-dash-payroll-${label}@example.test`;
    const password = 'E2EDashPayroll1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_DASH_PAYROLL_ONLY', permissionKeys: ['payroll:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    await gotoDashboard(page);
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);

    // pendingRelease/releaseProgress are gated reports:view OR payroll:view — payroll:view suffices.
    await expect(page.getByTestId('dashboard-stat-pending-release').getByText('Unavailable')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-stat-release-progress').getByText('Unavailable')).toHaveCount(0);

    // netPayroll/deductionBreakdown/siteSummary/totalEmployees require reports:view/employees:view —
    // neither held — must read Unavailable, never 0/PKR 0.00.
    await expect(page.getByTestId('dashboard-stat-net-payroll').getByText('Unavailable')).toBeVisible();
    await expect(page.getByTestId('dashboard-stat-total-employees').getByText('Unavailable')).toBeVisible();
    await expect(page.getByTestId('dashboard-deductions-unavailable')).toBeVisible();
    await expect(page.getByTestId('dashboard-site-summary-unavailable')).toBeVisible();

    await context.close();
  });
});

test.describe('Dashboard — Reports-only user (reports:view, never payroll:view)', () => {
  test('report widgets are visible; the employee-only widget is Unavailable without employees:view', async ({ browser }) => {
    const label = `dash-reports-only-${Date.now()}`;
    const email = `e2e-dash-reports-${label}@example.test`;
    const password = 'E2EDashReports1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_DASH_REPORTS_ONLY', permissionKeys: ['reports:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    await gotoDashboard(page);
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);

    await expect(page.getByTestId('dashboard-stat-net-payroll').getByText('Unavailable')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-deductions-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-site-summary-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-stat-pending-release').getByText('Unavailable')).toHaveCount(0);

    await expect(page.getByTestId('dashboard-stat-total-employees').getByText('Unavailable')).toBeVisible();
    await expect(page.getByTestId('dashboard-attention-pendingCorrections').getByText('Unavailable')).toBeVisible();
    await expect(page.getByTestId('dashboard-attention-recoveryDue').getByText('Unavailable')).toBeVisible();

    await context.close();
  });
});

test.describe('Dashboard — neither reports:view nor payroll:view is denied', () => {
  test('a statements:view-only user is shown Access Denied, not a Dashboard with every widget hidden', async ({ browser }) => {
    const label = `dash-none-${Date.now()}`;
    const email = `e2e-dash-none-${label}@example.test`;
    const password = 'E2EDashNone1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_DASH_NONE', permissionKeys: ['statements:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto('/');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    // Dashboard Checkpoint 1B UAT remediation, Issue A — a user denied the Dashboard route (`/`)
    // must never be offered a way back to that same denied route: neither the sidebar nav item
    // (hidden by nav-config's own OR gate, unchanged) nor AccessDeniedPage's own default "Back to
    // Dashboard" action (omitted here via RequirePermission's `hideHomeAction`, App.tsx) links
    // anywhere containing "Dashboard".
    await expect(page.getByRole('link', { name: /dashboard/i })).toHaveCount(0);
    await context.close();
  });
});

test.describe('Dashboard — Site-scoped user', () => {
  test('Site Payroll Summary and siteScope reflect only the assigned Site — an inaccessible Site never appears', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `dash-scope-${Date.now()}`;

    const { siteId: ownSiteId } = await createSiteWithEmployee(context, `${label}-own`);
    const { siteId: otherSiteId } = await createSiteWithEmployee(context, `${label}-other`);
    const otherSite = await apiGet<{ site: { name: string } }>(context, `/api/v1/sites/${otherSiteId}`);

    const scopedEmail = `e2e-dash-scope-${label}@example.test`;
    const scopedPassword = 'E2EDashScope1!';
    await createScopedUser({
      email: scopedEmail,
      password: scopedPassword,
      roleCode: 'TEST_E2E_DASH_SCOPED',
      permissionKeys: ['reports:view'],
      siteIds: [ownSiteId],
      name: 'E2E Dashboard Scoped User',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, scopedEmail, scopedPassword);

    await gotoDashboard(scopedPage);

    const dashboardResponse = await apiGet<{ siteScope: { siteIds: string[] | null } }>(
      scopedContext,
      '/api/v1/dashboard',
    );
    expect(dashboardResponse.body.siteScope.siteIds).toEqual([ownSiteId]);

    const siteSummary = scopedPage.getByTestId('dashboard-site-summary-table');
    if (await siteSummary.count()) {
      await expect(siteSummary.getByText(otherSite.body.site.name)).toHaveCount(0);
    }

    await scopedContext.close();
  });
});

test.describe('Dashboard — Site Summary drill-down honesty (Checkpoint 1B UAT remediation, Issue B)', () => {
  test('individual Site rows are not clickable; the one card-level action goes to the real Payroll Summary report', async ({
    authenticatedPage: page,
  }) => {
    await ensureAnyPayrollCycleExists(page.context());
    await gotoDashboard(page);

    const table = page.getByTestId('dashboard-site-summary-table');
    if (await table.count()) {
      // No Site-name cell (or any other cell) is wrapped in a link — a row must never imply a
      // Site-specific drill-down that Payroll Summary has no filter mechanism to honor.
      await expect(table.locator('tbody a')).toHaveCount(0);
    }

    // The one honest, card-level action — always present, never Dashboard-specific.
    const viewAll = page.getByTestId('dashboard-site-summary-view-all');
    await expect(viewAll).toBeVisible();
    await viewAll.click();
    await expect(page).toHaveURL(/\/reports\/payroll-summary$|\/payroll-cycles\/.+\/reports\/payroll-summary$/);
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);
  });
});

test.describe('Dashboard — Financial reconciliation with Payroll Summary Report', () => {
  test('Net Payroll matches the authoritative Payroll Summary Report for the same cycle, not a second formula', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await ensureAnyPayrollCycleExists(context);
    const cyclesRes = await apiGet<{ cycles: { id: string; status: string }[] }>(context, '/api/v1/payroll-cycles');
    const cycle = cyclesRes.body.cycles.find((c) => c.status === 'DRAFT') ?? cyclesRes.body.cycles[0]!;

    const dashboardRes = await apiGet<{ cycle: { id: string } | null; netPayroll: string | null }>(
      context,
      '/api/v1/dashboard',
    );
    const summaryRes = await apiGet<{ cycleTotals: { netSalary: string } }>(
      context,
      `/api/v1/reports/payroll-summary?cycleId=${cycle.id}`,
    );

    expect(dashboardRes.body.cycle?.id).toBe(cycle.id);
    expect(dashboardRes.body.netPayroll).toBe(summaryRes.body.cycleTotals.netSalary);
  });
});

test.describe('Dashboard — Attention links', () => {
  test('each visible Attention Required item navigates to its own existing report/workflow, never a new detail page', async ({
    authenticatedPage: page,
  }) => {
    await gotoDashboard(page);

    await page.getByTestId('dashboard-attention-heldEntries').click();
    await expect(page).toHaveURL(/\/reports\/salary-release$|\/payroll-cycles\/.+\/reports\/salary-release$/);
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);

    await gotoDashboard(page);
    await page.getByTestId('dashboard-attention-pendingCorrections').click();
    await expect(page).toHaveURL('/corrections');
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);

    await gotoDashboard(page);
    await page.getByTestId('dashboard-attention-recoveryDue').click();
    await expect(page).toHaveURL('/reports/advance-recovery');
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);
  });
});

test.describe('Dashboard — Responsive layout', () => {
  for (const width of [1440, 1024, 768]) {
    test(`renders without overlap or document horizontal scroll at ${width}px`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoDashboard(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

      await expect(page.getByTestId('dashboard-current-cycle')).toBeVisible();
      await expect(page.getByTestId('dashboard-stat-row')).toBeVisible();
      await expect(page.getByText('Attention Required')).toBeVisible();
    });
  }
});

test.describe('Dashboard — Privacy', () => {
  test('never renders employee names, CNIC, bank/IBAN/account details, or audit metadata', async ({ authenticatedPage: page }) => {
    await gotoDashboard(page);
    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    for (const forbidden of ['cnic', 'iban', 'account number', 'released by', 'correction reason', 'branch code']) {
      expect(bodyText).not.toContain(forbidden);
    }
  });
});

test.describe('Dashboard — Request discipline', () => {
  test('exactly one Dashboard request; zero per-widget report-fetch fan-out on initial load', async ({ authenticatedPage: page }) => {
    // `login()` already lands the browser on `/` — navigate away first so `gotoDashboard` below
    // performs a genuine fresh landing rather than a same-URL reload (see its own doc comment).
    await page.goto('/employees');

    const counts = {
      dashboard: 0,
      payrollSummary: 0,
      deductionReport: 0,
      salaryRelease: 0,
      projectSitePayroll: 0,
      advanceRecovery: 0,
    };

    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (path === '/api/v1/dashboard') counts.dashboard += 1;
      if (path === '/api/v1/reports/payroll-summary') counts.payrollSummary += 1;
      if (path === '/api/v1/reports/deduction-report') counts.deductionReport += 1;
      if (path === '/api/v1/reports/salary-release') counts.salaryRelease += 1;
      if (path === '/api/v1/reports/project-site-payroll') counts.projectSitePayroll += 1;
      if (path === '/api/v1/reports/advance-recovery') counts.advanceRecovery += 1;
    });

    await gotoDashboard(page);
    // Deterministic wait, not an arbitrary sleep — the network genuinely goes idle once the one
    // Dashboard request (and nothing else) has resolved, so any accidental fan-out would already
    // have fired by the time this resolves.
    await page.waitForLoadState('networkidle');

    expect(counts.dashboard).toBe(1);
    expect(counts.payrollSummary).toBe(0);
    expect(counts.deductionReport).toBe(0);
    expect(counts.salaryRelease).toBe(0);
    expect(counts.projectSitePayroll).toBe(0);
    expect(counts.advanceRecovery).toBe(0);
  });
});
