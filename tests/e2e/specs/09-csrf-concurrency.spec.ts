import type { Page } from '@playwright/test';
import { test, expect, login, loginAsMasterAdmin, getCsrfToken } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD } from '../setup/config';

/** Like `login()` (`fixtures/auth.ts`), but assumes the page is already on `/login` — used where
 * the caller needs to control exactly when the priming navigation happens (concurrently across
 * two tabs), since `login()`'s own unconditional `page.goto('/login')` would otherwise re-navigate
 * a tab that's already authenticated (from a *different* tab sharing the same cookie jar) straight
 * back to `/`, never rendering the form at all. */
async function submitLoginForm(page: Page, email: string, password: string): Promise<void> {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

/**
 * Checkpoint 4D — real-browser regression coverage for the concurrent first-contact CSRF race
 * root-caused in Checkpoint 4C (docs/architecture/authentication.md) and fixed in
 * `backend/src/common/middleware/csrf.ts` (`firstContactToken`'s coalescing map), plus the
 * token-rotation lifecycle added alongside it (`rotateCsrfCookie`). Backend-level coverage already
 * exists (`backend/tests/csrf-concurrency.test.ts`); this spec proves the same behavior through a
 * real Chromium browser and the real production frontend build, since the original bug was only
 * ever observable through a real browser's *shared cookie jar across multiple tabs* — something no
 * `supertest`-driven backend test can fully stand in for.
 */
test.describe('CSRF concurrency and token rotation, real browser (Checkpoint 4D)', () => {
  test('scenario 1 — fresh browser: first visit and login succeed', async ({ page }) => {
    await login(page, MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD);
    await expect(page).toHaveURL('/');
    await expect(page.locator('aside nav')).toBeVisible();
  });

  test('scenario 2 — rapid refresh before the first request settles still ends in a working login', async ({
    page,
  }) => {
    await page.goto('/login');
    // Fire several reloads back to back, deliberately not awaiting each one to settle — the
    // browser aborts the in-flight navigation/requests each time, which is a harsher version of
    // the same "request the app never gets to finish" condition the original race depended on.
    await page.reload();
    await page.reload();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await login(page, MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD);
    await expect(page).toHaveURL('/');
  });

  test('scenario 3 — two tabs opened simultaneously: login succeeds repeatedly, no intermittent CSRF failure', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ITERATIONS = 3;

    for (let i = 0; i < ITERATIONS; i += 1) {
      // One browser context = one shared cookie jar, exactly like one real browser window.
      // Two pages in it = two tabs — Checkpoint 4C's exact reproduction shape.
      const context = await browser.newContext();
      const tabA = await context.newPage();
      const tabB = await context.newPage();

      const csrfErrors: string[] = [];
      for (const tab of [tabA, tabB]) {
        tab.on('console', (msg) => {
          if (msg.type() === 'error' && /csrf/i.test(msg.text())) csrfErrors.push(msg.text());
        });
      }

      // Both tabs' first page load — and therefore both tabs' first, cookie-less
      // `GET /api/v1/auth/me` CSRF-priming request — fire concurrently.
      await Promise.all([tabA.goto('/login'), tabB.goto('/login')]);

      // Both tabs then submit their login form *concurrently*, each using whichever CSRF token
      // *it* individually captured from its own priming request above. Pre-fix, one of these two
      // could hold a token that no longer matched the shared cookie jar (whichever `Set-Cookie`
      // arrived last) and 403 with "Missing or invalid CSRF token". Submitting concurrently (not
      // sequentially) is deliberate — Checkpoint 4D also rotates the CSRF token on a *successful*
      // login, so a sequential second login on this same shared cookie jar would legitimately see
      // the first login's rotated token and correctly reject its own stale one; that's correct
      // rotation behavior, not the race this test exists to catch.
      await Promise.all([
        submitLoginForm(tabA, MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD),
        submitLoginForm(tabB, MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD),
      ]);

      await expect(tabA).toHaveURL('/');
      await expect(tabB).toHaveURL('/');
      expect(csrfErrors).toEqual([]);

      await context.close();
    }
  });

  test('scenario 4 — logout, then login again, succeeds and rotates the CSRF token', async ({
    authenticatedPage: page,
  }) => {
    const tokenWhileLoggedIn = await getCsrfToken(page.context());

    await page.getByRole('button', { name: 'MA' }).click();
    await page.getByText('Log out').click();
    await page.waitForURL((url) => url.pathname === '/login');

    const tokenAfterLogout = await getCsrfToken(page.context());
    expect(tokenAfterLogout).not.toBe(tokenWhileLoggedIn);

    await login(page, MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD);
    await expect(page).toHaveURL('/');

    const tokenAfterSecondLogin = await getCsrfToken(page.context());
    expect(tokenAfterSecondLogin).not.toBe(tokenAfterLogout);

    // The rotated token actually works for a further authenticated mutation, not just present.
    await page.getByRole('button', { name: 'MA' }).click();
    await page.getByText('Log out').click();
    await page.waitForURL((url) => url.pathname === '/login');
  });

  test('scenario 5 — self-service password reset rotates the CSRF token and the new password logs in cleanly', async ({
    browser,
    page: adminPage,
  }) => {
    await loginAsMasterAdmin(adminPage);

    const email = `e2e-csrf-password-reset-${Date.now()}@example.test`;
    const originalPassword = 'OriginalPassword1!';
    const newPassword = 'BrandNewPassword1!';

    const rolesRes = await apiGet<{ roles: { id: string; name: string }[] }>(adminPage.context(), '/api/v1/roles');
    const payrollStaffRole = rolesRes.body.roles.find((r) => r.name === 'Payroll Staff');
    if (!payrollStaffRole) throw new Error('Seeded "Payroll Staff" role not found');

    await apiPost(adminPage.context(), '/api/v1/users', {
      name: 'E2E CSRF Password Reset Target',
      email,
      password: originalPassword,
      roleId: payrollStaffRole.id,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    const csrfErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /csrf/i.test(msg.text())) csrfErrors.push(msg.text());
    });

    await login(page, email, originalPassword);
    await expect(page).toHaveURL('/');

    const tokenBeforeReset = await getCsrfToken(context);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'My Profile' }).click();
    await page.locator('#current-password').fill(originalPassword);
    await page.locator('#new-password').fill(newPassword);
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('Password changed')).toBeVisible();

    const tokenAfterReset = await getCsrfToken(context);
    expect(tokenAfterReset).not.toBe(tokenBeforeReset);

    // Old password no longer works; new password logs in cleanly, with no CSRF error anywhere
    // in the flow above (rotation didn't desync the frontend's in-memory token from the cookie).
    await page.goto('/login');
    await login(page, email, newPassword);
    await expect(page).toHaveURL('/');
    expect(csrfErrors).toEqual([]);

    await context.close();
  });
});
