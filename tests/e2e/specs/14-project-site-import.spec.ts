import { test, expect } from '../fixtures/auth';
import { apiGet } from '../helpers/api';

/**
 * Import Template Contract checkpoint (Project Site bulk import extension) — real-browser
 * verification of the Project Sites page's new Download Import Template / Import controls,
 * mirroring `12-corrections-completion.spec.ts`'s existing "Downloadable import templates" group
 * for Employee Registry. Drives the actual UI (real backend, real database, real CSRF, a real
 * file picked via `setInputFiles`), not just the API directly, per this project's Playwright
 * verification standard.
 */
test.describe('Project Sites bulk import', () => {
  test('Download Import Template produces a real file', async ({ authenticatedPage: page }) => {
    await page.goto('/sites');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download Import Template' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('project-site-import-template.xlsx');
  });

  test('importing a CSV of new sites creates them, shows the result, and makes them immediately visible/manageable', async ({
    authenticatedPage: page,
  }) => {
    const label = Date.now();
    const siteNameA = `E2E Import Site A ${label}`;
    const siteNameB = `E2E Import Site B ${label}`;

    const csv = [
      'Sr. No,Site Name,Unit Label,Address',
      `1,${siteNameA},Branch,100 Example Street`,
      `2,${siteNameB},Department,`,
    ].join('\n');

    await page.goto('/sites');
    // The real "Import" button just opens this hidden native file input (project-sites-page.tsx) —
    // Playwright can populate a hidden input directly, exercising the exact same `onChange` handler
    // a real file-picker selection would.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'sites.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });

    await expect(page.getByRole('heading', { name: 'Import Results' })).toBeVisible();
    await expect(page.getByText('2 created')).toBeVisible();
    // Two "Close" buttons exist on the modal (the header's icon-only X and the footer's own Close
    // button, both share the accessible name "Close") — scope to the footer's, the last one.
    await page.getByRole('button', { name: 'Close' }).last().click();

    // The imported sites appear in the list without a manual refresh (query invalidation).
    await expect(page.getByText(siteNameA)).toBeVisible();
    await expect(page.getByText(siteNameB)).toBeVisible();

    // Immediately manageable — "Manage Branches" opens for a just-imported site with no separate
    // approval step, proving the importer's own creator-access assignment took effect end to end.
    await page.getByRole('button', { name: `Actions for ${siteNameA}` }).click();
    await page.getByRole('menuitem', { name: /^Manage/ }).click();
    await expect(page.getByRole('heading', { name: new RegExp(siteNameA) })).toBeVisible();

    const sitesRes = await apiGet<{ sites: { name: string }[] }>(page.context(), '/api/v1/sites');
    const names = sitesRes.body.sites.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining([siteNameA, siteNameB]));
  });

  test('importing a row with an invalid Site Name reports a readable per-row error, not a raw failure', async ({
    authenticatedPage: page,
  }) => {
    const csv = ['Sr. No,Site Name,Unit Label,Address', '1,,Branch,'].join('\n');

    await page.goto('/sites');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'bad-sites.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });

    await expect(page.getByRole('heading', { name: 'Import Results' })).toBeVisible();
    await expect(page.getByText('1 skipped')).toBeVisible();
    await expect(page.getByText(/Row 2: Site Name/)).toBeVisible();
  });
});
