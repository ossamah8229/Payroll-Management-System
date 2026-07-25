import { test, expect } from '../fixtures/auth';
import { apiPost } from '../helpers/api';
import { createSiteWithEmployee, ensureAnyPayrollCycleExists } from '../helpers/fixtures';

/**
 * RBAC Creator Ownership & Professional Printing checkpoint — real-browser (Chromium) verification
 * of the shared print-layout architecture (`docs/architecture/print-architecture.md`), the one
 * class of check a jsdom component test can't cover: actual `@media print` rendering, the
 * dynamically-injected `@page` orientation rule, and Payroll Entry's print table rendering its
 * complete (non-virtualized) dataset.
 *
 * `window.print()` opens no real dialog in headless Chromium, but it still fires `beforeprint`/
 * `afterprint` synchronously as if a print had completed instantly — which would immediately
 * trigger `use-print.ts`'s own `afterprint` cleanup and remove the exact `@page` style tag/
 * `print-fit` class these specs need to inspect, before `page.evaluate` ever gets to read them.
 * Stubbed out via `addInitScript` in every test below so the layout side effects
 * (`applyPrintLayout`, which run synchronously *before* the `window.print()` call) stay in the DOM
 * long enough to assert on — the native print dialog itself is out of scope for an automated
 * check regardless (Playwright/CDP has no way to interact with it).
 */

async function stubWindowPrint(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

async function openPrintDialogAndConfirm(
  page: import('@playwright/test').Page,
  options: { orientation?: 'Portrait' | 'Landscape'; fit?: 'Fit to page' | 'Normal size' } = {},
) {
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Print settings')).toBeVisible();

  if (options.orientation) {
    await dialog.getByLabel(options.orientation, { exact: true }).check();
  }
  if (options.fit) {
    await dialog.getByLabel(new RegExp(options.fit)).check();
  }

  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
}

test.describe('Professional Printing — shared architecture', () => {
  test('Payroll Entry (Landscape): print settings dialog, dynamic @page rule, and the complete dataset — not just virtualized rows', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `print-arch-${Date.now()}`;
    await stubWindowPrint(page);

    const { cycleId } = await ensureAnyPayrollCycleExists(context);

    // A count comfortably larger than the virtualized grid's mounted window (overscan 12, a
    // ~70vh scroll viewport) — if the print table only ever showed mounted rows, this count
    // would prove it directly.
    const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E Site ${label}` });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E Unit ${label}`,
    });
    const employeeCount = 60;
    await Promise.all(
      Array.from({ length: employeeCount }, (_, i) =>
        apiPost(context, '/api/v1/employees', {
          name: `E2E Print Employee ${label} ${i}`,
          designation: 'Guard',
          siteId: site.site.id,
          unitId: unit.unit.id,
          grossPay: '30000',
        }),
      ),
    );

    await page.goto(`/payroll-cycles/${cycleId}/payroll-entry`);
    await expect(page.getByRole('table', { name: 'Payroll Entry grid' })).toBeVisible();

    const virtualizedRowCount = await page.locator('[role="table"][aria-label="Payroll Entry grid"] [role="row"]').count();
    const printTable = page.locator('.hidden.print\\:block table');
    const printRowCountBeforePrint = await printTable.locator('tbody tr').count();

    // The print-only table is always fully rendered in the DOM (`hidden print:block`, never
    // mounted/unmounted by print state) — its row count already reflects the complete filtered
    // dataset regardless of print mode, which is the whole point: nothing here depends on the
    // virtualizer's mounted window.
    expect(printRowCountBeforePrint).toBeGreaterThanOrEqual(employeeCount);
    expect(printRowCountBeforePrint).toBeGreaterThan(virtualizedRowCount);

    await openPrintDialogAndConfirm(page, { orientation: 'Landscape', fit: 'Fit to page' });

    const pageStyleContent = await page.evaluate(
      () => document.getElementById('app-dynamic-print-page-style')?.textContent ?? '',
    );
    expect(pageStyleContent).toContain('A4 landscape');
    const hasFitClass = await page.evaluate(() => document.documentElement.classList.contains('print-fit'));
    expect(hasFitClass).toBe(true);

    // Real print CSS rendering, real Chromium PDF generation (checkpoint's own required
    // verification path) — proves the print-only table actually renders under `@media print`
    // (not just present in the DOM with `display: none` undetected) and that the interactive
    // grid genuinely disappears.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[role="table"][aria-label="Payroll Entry grid"]')).toBeHidden();
    await expect(printTable).toBeVisible();

    const printRowCountUnderPrintMedia = await printTable.locator('tbody tr').count();
    expect(printRowCountUnderPrintMedia).toBe(printRowCountBeforePrint);

    // No horizontal clipping (checkpoint B4/B7): `table-layout: fixed; width: 100%` under
    // `.print-fit` must keep the table's rendered width within its container, never wider.
    const overflowsHorizontally = await printTable.evaluate((table) => {
      const container = table.closest('.hidden.print\\:block') as HTMLElement;
      return table.scrollWidth > container.clientWidth + 1;
    });
    expect(overflowsHorizontally).toBe(false);

    // Proxy for "this dataset needs more than one physical page" (checkpoint B4/B9's multi-page
    // requirement) rather than an exact PDF page count: an A4-landscape page's own content-area
    // height at this checkpoint's 12mm margins is ~703px; a rendered table taller than that
    // cannot fit on a single page, so it must continue onto further pages, with `thead`'s
    // `display: table-header-group` (index.css) repeating the header on each.
    const printTableHeight = await printTable.evaluate((el) => el.getBoundingClientRect().height);
    expect(printTableHeight).toBeGreaterThan(700);

    const pdf = await page.pdf({ landscape: true });
    expect(pdf.byteLength).toBeGreaterThan(1000);

    await page.emulateMedia({ media: 'screen' });
  });

  test('Salary Release (narrower report, Portrait default): screen-only Release actions are absent under print media', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await stubWindowPrint(page);
    const { cycleId } = await ensureAnyPayrollCycleExists(context);
    await createSiteWithEmployee(context, `print-arch-portrait-${Date.now()}`);

    await page.goto(`/payroll-cycles/${cycleId}/release`);
    await expect(page.locator('#salary-release-site')).toBeVisible();

    // Reusability proof (checkpoint B9.8) — the exact same `PrintButton`/`PrintSettingsDialog`
    // Payroll Entry uses, on a structurally unrelated page, defaulting its "Auto" orientation
    // hint to Portrait here instead of Landscape.
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print settings')).toBeVisible();
    await expect(dialog.getByText('Auto')).toBeVisible();
    await expect(dialog.getByText('(Portrait)')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.emulateMedia({ media: 'print' });
    const releaseButtons = page.getByRole('button', { name: 'Release', exact: true });
    if (await releaseButtons.count()) {
      await expect(releaseButtons.first()).toBeHidden();
    }
    await page.emulateMedia({ media: 'screen' });
  });

  // --- Final print-completeness pass — Bank Sheet & Cash Receiving ------------------------------
  //
  // Both were flagged by the original print audit as "still print the live screen DOM" pages, kept
  // deliberately unmigrated (no dedicated print-only markup) because code review found no
  // screen-only-control leak on either: neither has a row-actions column, a dropdown, or a
  // checkbox — every column is plain data. This is the real-Chromium confirmation that the shared
  // `.print-flow`/`print:hidden` CSS alone (unchanged architecture) already produces acceptable
  // print output for both, now with a deliberate `recommendedOrientation="landscape"` default
  // (previously silently inherited Portrait regardless of their 9-11 column width).
  for (const { name, path, siteName } of [
    { name: 'Bank Sheet', path: 'bank-sheet', siteName: 'Bank Sheet' },
    { name: 'Cash Receiving', path: 'cash-receiving', siteName: 'Cash Receiving' },
  ]) {
    test(`${name}: sidebar/filters/actions excluded, Landscape default, Fit to Page keeps the table within the printable width`, async ({
      authenticatedPage: page,
    }) => {
      const context = page.context();
      await stubWindowPrint(page);
      const { cycleId } = await ensureAnyPayrollCycleExists(context);
      const { unitId } = await createSiteWithEmployee(context, `print-arch-${siteName}-${Date.now()}`);
      // Both pages only ever show released payroll ("Bank Sheets are generated only from released
      // payroll" / the same for Cash Receiving) — release the fixture's own unit so there's a row
      // to actually render and inspect.
      await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`, {});

      await page.goto(`/payroll-cycles/${cycleId}/${path}`);
      // Bank Sheet defaults its own Bank filter to the first real bank, not Cash — this fixture's
      // employee has no bank assigned (a Cash employee), so it's invisible until the filter is
      // switched (auto-waits for the select to actually render its loaded bank options). Cash
      // Receiving has no such filter.
      if (name === 'Bank Sheet') {
        await page.locator('#bank-sheet-bank').selectOption({ label: 'Cash' });
      }
      await expect(page.locator('table').first()).toBeVisible();

      // Confirming Auto (its default hint already resolved to Landscape, asserted below) plus
      // Fit to page is what actually exercises "Fit to Page affects printable width correctly" —
      // canceling the dialog after only reading its hint text would never apply the `print-fit`
      // class this assertion depends on.
      await page.getByRole('button', { name: 'Print', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Print settings')).toBeVisible();
      await expect(dialog.getByText('Auto')).toBeVisible();
      await expect(dialog.getByText('(Landscape)')).toBeVisible();
      await dialog.getByRole('button', { name: 'Print', exact: true }).click();

      await page.emulateMedia({ media: 'print' });

      // Sidebar/navigation, filter controls, and the toolbar's own action buttons (Print/Export)
      // are all print:hidden — the shared AppShell/PayrollPageToolbar mechanism, unchanged by this
      // pass, applied here as evidence rather than assumption.
      await expect(page.locator('nav').first()).toBeHidden();
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeHidden();

      const hasFitClass = await page.evaluate(() => document.documentElement.classList.contains('print-fit'));
      expect(hasFitClass).toBe(true);

      const table = page.locator('.print-flow table').first();
      await expect(table).toBeVisible();
      const overflowsHorizontally = await table.evaluate((el) => {
        const container = el.closest('.print-flow') as HTMLElement;
        return el.scrollWidth > container.clientWidth + 1;
      });
      expect(overflowsHorizontally).toBe(false);

      await page.emulateMedia({ media: 'screen' });
    });
  }
});
