import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD } from '../setup/config';

/** Drives the real login form — the one authentication path every spec in this suite goes
 * through, no shortcuts (no direct cookie injection, no API-only login) so the suite genuinely
 * exercises the CSRF double-submit flow and session cookie issuance it exists to verify. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

export async function loginAsMasterAdmin(page: Page): Promise<void> {
  await login(page, MASTER_ADMIN_EMAIL, MASTER_ADMIN_PASSWORD);
}

/** Reads the `csrf_token` cookie a context already holds (issued on first page load —
 * `issueCsrfCookie` middleware, `backend/src/app.ts`) so a spec that needs to call the API
 * directly (bypassing the UI for setup/assertions) can echo it back as `x-csrf-token`, exactly as
 * the real frontend's own `api-client.ts` does. Throws if the context never loaded a page yet —
 * there is no CSRF cookie to read before that. */
export async function getCsrfToken(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'csrf_token');
  if (!csrf) {
    throw new Error('No csrf_token cookie present on this context yet — load a page first.');
  }
  return decodeURIComponent(csrf.value);
}

interface AuthFixtures {
  /** A `page` already logged in as the seeded Master Admin — the common case almost every spec
   * needs, so it isn't re-derived per test. A spec that needs a *second*, independent session
   * (e.g. session-revocation) uses `browser.newContext()` directly instead of this fixture. */
  authenticatedPage: Page;
}

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await loginAsMasterAdmin(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
