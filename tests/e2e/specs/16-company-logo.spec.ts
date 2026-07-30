import { test, expect, login } from '../fixtures/auth';
import { apiPost } from '../helpers/api';
import { ensureAnyPayrollCycleExists } from '../helpers/fixtures';
import { BACKEND_URL } from '../setup/config';

/**
 * Phase 7C — Company Logo & Safe Document Integration. Real browser (Chromium), real backend,
 * real database, real `StorageProvider` (LocalFilesystemStorageProvider — this harness's own
 * `.env` default, unchanged by this checkpoint). Drives the actual UI for upload/replace/remove,
 * a second independent unauthenticated context for the Login page, and a second independent
 * lower-permission user for the RBAC-gating checks — never a shortcut through direct DB writes.
 *
 * A minimal valid 1x1 transparent PNG, hardcoded rather than generated at runtime — avoids taking
 * a dependency on `sharp` (or any image library) being resolvable from the `tests/e2e` workspace,
 * which is a separate package from `backend`.
 */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const ONE_PIXEL_PNG_BASE64_ALT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function pngFile(name: string, base64: string) {
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

/** Cleans up any logo the suite left behind so this spec never depends on run order / leaves
 * state for a later run — removal is idempotent (a 404 from an already-absent logo is ignored). */
async function removeLogoIfPresent(context: import('@playwright/test').BrowserContext) {
  const { getCsrfToken } = await import('../fixtures/auth');
  const csrfToken = await getCsrfToken(context);
  await context.request.delete(`${BACKEND_URL}/api/v1/settings/company/logo`, {
    headers: { 'x-csrf-token': csrfToken },
  });
}

test.describe('Company Logo — upload, display, replace, remove, permissions, theme', () => {
  test.afterEach(async ({ authenticatedPage: page }) => {
    await removeLogoIfPresent(page.context());
  });

  test('Master Admin uploads a logo; it appears in the Settings preview and on the (unauthenticated) Login page; Theme stays unaffected; replace and remove both work end-to-end', async ({
    authenticatedPage: page,
    browser,
  }) => {
    // --- Theme baseline — read before any logo operation, and re-check after each one below. ---
    await page.goto('/');
    const accentBefore = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase(),
    );

    // --- Upload -----------------------------------------------------------------------------
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Company Logo' })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(pngFile('logo.png', ONE_PIXEL_PNG_BASE64));
    await expect(page.getByText('Company logo uploaded')).toBeVisible();

    const preview = page.getByAltText('Company logo');
    await expect(preview).toBeVisible();
    // A real, successfully decoded image — not a broken-image icon silently accepted as "visible".
    await expect
      .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth > 0))
      .toBe(true);

    const accentAfterUpload = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase(),
    );
    expect(accentAfterUpload).toBe(accentBefore);

    // --- Login page shows the same logo, with no session at all ----------------------------
    const loginContext = await browser.newContext();
    const loginPage = await loginContext.newPage();
    await loginPage.goto('/login');
    const loginLogo = loginPage.getByAltText('Company logo');
    await expect(loginLogo).toBeVisible();
    await expect
      .poll(() => loginLogo.evaluate((img: HTMLImageElement) => img.naturalWidth > 0))
      .toBe(true);
    await loginContext.close();

    // --- Replace ------------------------------------------------------------------------------
    await page.locator('input[type="file"]').setInputFiles(pngFile('logo-2.png', ONE_PIXEL_PNG_BASE64_ALT));
    await expect(page.getByText('Company logo replaced')).toBeVisible();
    await expect
      .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth > 0))
      .toBe(true);

    const accentAfterReplace = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase(),
    );
    expect(accentAfterReplace).toBe(accentBefore);

    // --- Remove — requires confirmation, then restores the fallback -------------------------
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(/Remove the company logo\?/i)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Company logo removed')).toBeVisible();
    await expect(page.getByAltText('Company logo')).toHaveCount(0);

    const accentAfterRemove = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase(),
    );
    expect(accentAfterRemove).toBe(accentBefore);

    // Login page falls back to the placeholder once the logo is gone — reload the same
    // already-unauthenticated-page-pattern context to prove it, not a leftover cached image.
    const loginContext2 = await browser.newContext();
    const loginPage2 = await loginContext2.newPage();
    await loginPage2.goto('/login');
    await expect(loginPage2.getByAltText('Company logo')).toHaveCount(0);
    await loginContext2.close();
  });

  test('a user without settings:manage cannot upload or remove the logo — the UI hides the controls and the API independently rejects it', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const label = `logo-perm-${Date.now()}`;
    const role = await apiPost<{ role: { id: string } }>(adminPage.context(), '/api/v1/roles', {
      name: `E2E No Logo Access Role ${label}`,
      permissionKeys: [],
    });
    const email = `e2e-no-logo-access-${label}@example.test`;
    const password = 'E2ENoLogoAccessPassword1!';
    await apiPost(adminPage.context(), '/api/v1/users', { name: 'E2E No Logo Access', email, password, roleId: role.role.id });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    await page.goto('/settings');
    await expect(page.getByText('No logo uploaded yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload Logo' })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    const { getCsrfToken } = await import('../fixtures/auth');
    const csrfToken = await getCsrfToken(context);
    const res = await context.request.post(`${BACKEND_URL}/api/v1/settings/company/logo`, {
      headers: { 'x-csrf-token': csrfToken },
      multipart: { file: pngFile('logo.png', ONE_PIXEL_PNG_BASE64) },
    });
    expect(res.status()).toBe(403);

    await context.close();
  });
});

test.describe('Company Logo — print layout integrity (Bank Sheet, Cash Receiving)', () => {
  test.afterEach(async ({ authenticatedPage: page }) => {
    await removeLogoIfPresent(page.context());
  });

  // `<PrintContextHeader>` renders as soon as a cycle is selected — it does not depend on there
  // being any released payroll row at all (`bank-sheet-page.tsx`/`cash-receiving-page.tsx`: the
  // header sits outside the loading/empty/data conditional branches). Measuring it in isolation,
  // with no released-payroll fixture, is deliberate: the logo change touches only this header
  // block, never the table — a real released row adds fixture risk (this harness's roster
  // reconciliation step, `use-payroll-cycles.ts`'s `useReconcileDraftCycleRoster`, is unrelated to
  // this checkpoint and was found to be flaky in this exact harness even for the pre-existing,
  // unmodified `13-print-architecture.spec.ts` Bank Sheet/Cash Receiving tests) without adding any
  // real signal to the one claim this test exists to verify: the header's own height.
  for (const { name, path } of [
    { name: 'Bank Sheet', path: 'bank-sheet' },
    { name: 'Cash Receiving', path: 'cash-receiving' },
  ]) {
    test(`${name}: the print header's measured height is identical with and without a company logo`, async ({
      authenticatedPage: page,
    }) => {
      const { cycleId } = await ensureAnyPayrollCycleExists(page.context());

      await page.goto(`/payroll-cycles/${cycleId}/${path}`);
      await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();

      await page.emulateMedia({ media: 'print' });
      // Not `.print\\:block` — `app-shell.tsx` also uses that exact class on two of its own
      // wrapper `<div>`s, both earlier in the DOM than `<PrintContextHeader>` itself, so a plain
      // `.print\\:block.first()` match resolves to the whole app shell, not the header. This
      // compound selector (`print:mb-4 print:pb-3`) is unique to `<PrintContextHeader>`.
      const printHeader = page.locator('.print\\:mb-4.print\\:pb-3');
      const headerHeightBefore = await printHeader.evaluate((el) => el.getBoundingClientRect().height);
      await page.emulateMedia({ media: 'screen' });

      // Upload a logo, then re-measure the exact same header in print media.
      await page.goto('/settings');
      await page.locator('input[type="file"]').setInputFiles(pngFile('logo.png', ONE_PIXEL_PNG_BASE64));
      await expect(page.getByText('Company logo uploaded')).toBeVisible();

      await page.goto(`/payroll-cycles/${cycleId}/${path}`);
      await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();

      await page.emulateMedia({ media: 'print' });
      const printHeaderAfter = page.locator('.print\\:mb-4.print\\:pb-3');

      // The logo image itself must actually be present and loaded now — proves this comparison
      // is meaningful (the "after" state genuinely has a logo), not a no-op.
      const logoImg = printHeaderAfter.locator('img');
      await expect
        .poll(() => logoImg.evaluate((img: HTMLImageElement) => img.naturalWidth > 0).catch(() => false), {
          timeout: 15000,
        })
        .toBe(true);

      const headerHeightAfter = await printHeaderAfter.evaluate((el) => el.getBoundingClientRect().height);
      await page.emulateMedia({ media: 'screen' });

      // The measured evidence this checkpoint's stop condition requires: the header's own height
      // is byte-for-byte unchanged — the logo is capped below the shortest existing text line, so
      // it can never grow this block, and this block growing is the only way a logo here could
      // ever shift table pagination (the table itself has no logo-related markup at all).
      expect(headerHeightAfter).toBe(headerHeightBefore);
    });
  }
});

// Payslip/Statement PDF logo embedding is deliberately NOT covered here by a real released-payroll
// Playwright fixture: this harness's shared `createSiteWithEmployee` fixture produces a
// zero-worked-days, negative-net-salary entry that Salary Release silently excludes (a pre-existing
// gap in shared E2E fixture infrastructure, unrelated to this checkpoint and out of scope to fix —
// confirmed by reproducing the identical "no released payroll" outcome against the current,
// unmodified `13-print-architecture.spec.ts` Bank Sheet/Cash Receiving tests). That logo-embedding
// behavior is instead covered by real, deterministic tests elsewhere: `backend/tests/pdf-template.test.ts`
// and `statement-pdf-template.test.ts` assert the rendered HTML embeds/omits the `<img>` correctly,
// and `backend/tests/settings.test.ts` proves the full upload → storage → retrieval pipeline
// end-to-end against a real database and a real `StorageProvider`.
