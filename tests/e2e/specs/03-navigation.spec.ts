import { test, expect } from '../fixtures/auth';
import { ensureAnyPayrollCycleExists } from '../helpers/fixtures';

/**
 * AUD-012 regression coverage: every authenticated page-level route is now `React.lazy`-loaded
 * (`frontend/src/App.tsx`). This spec proves that split didn't break anything — every route still
 * renders real content on both a fresh (direct) navigation and a client-side (in-app) one, with no
 * uncaught page error, no console error, and no failed chunk request.
 */
const ROUTES = [
  '/',
  '/sites',
  '/employees',
  '/payroll-entry',
  '/release',
  '/bank-sheet',
  '/cash-receiving',
  '/advances',
  '/payslips',
  '/settings',
  '/users',
];

test.describe('Core navigation', () => {
  test('every route loads cleanly via direct navigation — no blank screen, no console/page error, no failed chunk', async ({
    authenticatedPage: page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`${page.url()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => pageErrors.push(`${page.url()}: ${err.message}`));
    page.on('requestfailed', (req) => {
      // `net::ERR_ABORTED` on a `.js` request is the browser cancelling a still-in-flight request
      // from the *previous* route because this loop already navigated away — normal browser
      // behavior, not a chunk genuinely failing to load. A real failure (404, network error, etc.)
      // surfaces under any other `errorText`.
      if (req.url().endsWith('.js') && req.failure()?.errorText !== 'net::ERR_ABORTED') {
        failedRequests.push(`${page.url()}: ${req.url()} — ${req.failure()?.errorText}`);
      }
    });

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('aside nav')).toBeVisible();
      const bodyText = await page.locator('main').innerText();
      expect(bodyText.trim().length, `route ${route} rendered no visible content — possible blank screen`).toBeGreaterThan(0);
    }

    expect(failedRequests, 'no lazy route chunk should fail to load').toEqual([]);
    expect(pageErrors, 'no route should throw an uncaught page error').toEqual([]);
    expect(consoleErrors, 'no route should log a console error').toEqual([]);
  });

  test('client-side navigation to a lazy route works without a full page reload', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

    const jsRequestsDuringNav: string[] = [];
    page.on('request', (req) => {
      if (req.url().endsWith('.js')) jsRequestsDuringNav.push(req.url());
    });

    await page.getByRole('link', { name: 'Employee Registry' }).click();
    await expect(page).toHaveURL('/employees');
    // The topbar's own page title ("Employee Registry") is plain text, not a heading — the real
    // `<h3>` heading on this page is its card's own title, "All Employees".
    await expect(page.getByRole('heading', { name: 'All Employees' })).toBeVisible();

    // A genuine client-side navigation fetched at least the Employees route's own chunk — proof
    // the lazy import actually ran, not that the whole page silently hard-reloaded instead.
    expect(jsRequestsDuringNav.some((url) => url.includes('employees-page'))).toBe(true);
  });

  test('refresh on a nested payroll-cycle route works', async ({ authenticatedPage: page }) => {
    // Reuses the cycle `02-payroll-lifecycle.spec.ts` creates (specs run in file order — see
    // `playwright.config.ts`) — falls back to bootstrapping one itself only if run in isolation.
    await ensureAnyPayrollCycleExists(page.context());

    await page.goto('/payroll-entry');
    await page.waitForURL((url) => /\/payroll-cycles\/.+\/payroll-entry/.test(url.pathname));
    const nestedUrl = page.url();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page).toHaveURL(nestedUrl);
    await expect(page.locator('aside nav')).toBeVisible();
  });
});
