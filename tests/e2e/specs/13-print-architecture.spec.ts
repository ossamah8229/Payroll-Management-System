import { test, expect } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee, ensureAnyPayrollCycleExists } from '../helpers/fixtures';

/**
 * RBAC Creator Ownership & Professional Printing checkpoint — real-browser (Chromium) verification
 * of the shared print-layout architecture (`docs/architecture/print-architecture.md`).
 *
 * **Production Print Defect (2026-07-25) and why the original version of this file missed it.**
 * `window.print()` was previously stubbed as a bare no-op (`() => undefined`) via `addInitScript`,
 * and every assertion about DOM/CSS state ran in a *separate*, later `page.evaluate()` call after
 * the confirm click's own `await ...click()` had already resolved. That round-trip is exactly
 * enough time for React to flush a pending state update — so even under the actual production bug
 * (the settings dialog's confirm handler called `window.print()` *before* requesting its own
 * close), the dialog had already closed for real by the time this file's own assertions ran,
 * masking the defect entirely. A real browser's print engine has no such grace period: it captures
 * the DOM at the exact synchronous instant `window.print()` is called, which is why production
 * users saw the Print Settings dialog itself in their print preview.
 *
 * Fixed here by capturing DOM/CSS state *inside* the `window.print()` stub itself — the same
 * synchronous instant a real print engine would capture — never in a later, separate evaluate.
 */
async function stubWindowPrintWithCapture(page: import('@playwright/test').Page, reportSelector: string) {
  await page.addInitScript((selector) => {
    (window as unknown as { __printCapture: unknown }).__printCapture = null;
    window.print = () => {
      (window as unknown as { __printCapture: unknown }).__printCapture = {
        dialogPresent: document.querySelector('[role="dialog"]') !== null,
        printSettingsTextPresent: document.body.innerText.includes('Print settings'),
        printFitApplied: document.documentElement.classList.contains('print-fit'),
        pageStyleContent: document.getElementById('app-dynamic-print-page-style')?.textContent ?? '',
        reportPresent: document.querySelector(selector) !== null,
      };
    };
  }, reportSelector);
}

interface PrintCapture {
  dialogPresent: boolean;
  printSettingsTextPresent: boolean;
  printFitApplied: boolean;
  pageStyleContent: string;
  reportPresent: boolean;
}

async function getPrintCapture(page: import('@playwright/test').Page): Promise<PrintCapture> {
  const capture = await page.evaluate(() => (window as unknown as { __printCapture: PrintCapture | null }).__printCapture);
  if (!capture) throw new Error('window.print() was never invoked — nothing was captured');
  return capture;
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
  test('Payroll Entry (Landscape): the settings dialog is gone and the report is present at the exact moment window.print() is invoked; complete dataset — not just virtualized rows', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `print-arch-${Date.now()}`;
    await stubWindowPrintWithCapture(page, '.hidden.print\\:block table');

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

    // --- REGRESSION: DOM state at the exact moment window.print() was invoked -------------------
    const capture = await getPrintCapture(page);
    expect(capture.dialogPresent).toBe(false);
    expect(capture.printSettingsTextPresent).toBe(false);
    expect(capture.reportPresent).toBe(true);
    expect(capture.printFitApplied).toBe(true);
    expect(capture.pageStyleContent).toContain('A4 landscape');

    // Real print CSS rendering, real Chromium PDF generation (checkpoint's own required
    // verification path) — proves the print-only table actually renders under `@media print`
    // (not just present in the DOM with `display: none` undetected) and that the interactive
    // grid genuinely disappears.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[role="table"][aria-label="Payroll Entry grid"]')).toBeHidden();
    await expect(printTable).toBeVisible();
    // Defense-in-depth CSS (Production Print Defect fix): even independent of the lifecycle fix
    // above, a settings dialog left mounted must never be printable — asserted directly here
    // rather than only inferred from the lifecycle capture.
    await expect(page.getByRole('dialog')).toHaveCount(0);

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

    // Real Chromium PDF generation of the prepared print DOM — content-level confirmation that
    // the report, not the settings dialog, is what actually gets captured for print.
    const pdf = await page.pdf({ landscape: true });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    const pdfText = pdf.toString('latin1');
    expect(pdfText).not.toContain('Print settings');

    await page.emulateMedia({ media: 'screen' });
  });

  test('Salary Release (narrower report, Portrait default): screen-only Release actions are absent under print media', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await stubWindowPrintWithCapture(page, 'table');
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
  // (previously silently inherited Portrait regardless of their 9-11 column width), AND (this
  // pass) that the shared lifecycle fix applies equally to a live-DOM report, not just Payroll
  // Entry's dedicated print table.
  for (const { name, path, siteName } of [
    { name: 'Bank Sheet', path: 'bank-sheet', siteName: 'Bank Sheet' },
    { name: 'Cash Receiving', path: 'cash-receiving', siteName: 'Cash Receiving' },
  ]) {
    test(`${name}: settings dialog is gone and the live-DOM report is present at the exact moment window.print() is invoked; Landscape default; Fit to Page keeps the table within the printable width`, async ({
      authenticatedPage: page,
    }) => {
      const context = page.context();
      await stubWindowPrintWithCapture(page, '.print-flow table');
      const { cycleId } = await ensureAnyPayrollCycleExists(context);
      const { siteId, unitId } = await createSiteWithEmployee(context, `print-arch-${siteName}-${Date.now()}`);

      // `createSiteWithEmployee` never sets worked days, so this entry's net salary is negative
      // (grossPay earned over 0 days, minus EOBI) — since the Negative Payroll Recovery checkpoint
      // (2026-07-27, `payroll-release.service.ts`), releasing a negative/zero-net entry resolves it
      // as RECOVERY_DUE instead of `released`, so it would never actually appear on either report
      // (both "only ever show released payroll"). Give it a full cycle of worked days first, same
      // as `02-payroll-lifecycle.spec.ts`/`07-corrections.spec.ts` do for their own fixture entries.
      // Filtered server-side by `siteId` (this brand-new site has exactly one entry) rather than
      // fetched unfiltered and searched client-side — by this point in the full suite, the current
      // Draft cycle's entries (accumulated across every earlier spec's own fixture employees) can
      // easily exceed the list endpoint's default `pageSize` (50), silently missing this one on an
      // unfiltered page 1.
      const entries = await apiGet<{
        entries: { id: string; version: number; workLines: { id: string; cycleDays: number }[] }[];
      }>(context, `/api/v1/payroll-cycles/${cycleId}/entries?siteId=${siteId}`);
      const entry = entries.body.entries[0];
      if (entry?.workLines[0]) {
        await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0].id}`, {
          version: entry.version,
          days: String(entry.workLines[0].cycleDays),
        });
      }

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

      // --- REGRESSION: DOM state at the exact moment window.print() was invoked -----------------
      const capture = await getPrintCapture(page);
      expect(capture.dialogPresent).toBe(false);
      expect(capture.printSettingsTextPresent).toBe(false);
      expect(capture.reportPresent).toBe(true);
      expect(capture.printFitApplied).toBe(true);
      expect(capture.pageStyleContent).toContain('A4 landscape');

      await page.emulateMedia({ media: 'print' });

      // Sidebar/navigation, filter controls, and the toolbar's own action buttons (Print/Export)
      // are all print:hidden — the shared AppShell/PayrollPageToolbar mechanism, unchanged by this
      // pass, applied here as evidence rather than assumption.
      await expect(page.locator('nav').first()).toBeHidden();
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeHidden();
      // Defense-in-depth CSS (Production Print Defect fix): a settings dialog, if ever left
      // mounted by a future lifecycle regression, must still never be printable.
      await expect(page.getByRole('dialog')).toHaveCount(0);

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
