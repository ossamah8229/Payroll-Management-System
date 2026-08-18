import { test, expect } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

interface CycleRow {
  id: string;
  year: number;
  month: number;
  status: string;
}

/** Resolves (bootstrapping if necessary) a Draft cycle, then creates a fresh site/employee already
 * given a full cycle of worked days — same reason `02-payroll-lifecycle.spec.ts`/
 * `13-print-architecture.spec.ts` do this: `createSiteWithEmployee` never sets worked days on its
 * own, so its auto-synced entry nets negative and prints as a Recovery/Pending row rather than the
 * representative positive-figures row these print-legibility tests want to measure against. */
async function makeDraftCycleWithReleasableEntry(context: import('@playwright/test').BrowserContext, label: string) {
  const existingCycles = await apiGet<{ cycles: CycleRow[] }>(context, '/api/v1/payroll-cycles');
  let cycleId: string;
  if (existingCycles.body.cycles.some((c) => c.status === 'DRAFT')) {
    cycleId = existingCycles.body.cycles.find((c) => c.status === 'DRAFT')!.id;
  } else {
    const created = await apiPost<{ cycle: { id: string } }>(context, '/api/v1/payroll-cycles', {
      year: 2900,
      month: existingCycles.body.cycles.length + 2,
    });
    cycleId = created.cycle.id;
  }

  const { siteId } = await createSiteWithEmployee(context, label);
  const entries = await apiGet<{
    entries: { id: string; version: number; workLines: { id: string; cycleDays: number }[] }[];
  }>(context, `/api/v1/payroll-cycles/${cycleId}/entries?siteId=${siteId}`);
  const entry = entries.body.entries[0]!;
  await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
    version: entry.version,
    days: String(entry.workLines[0]!.cycleDays),
  });

  return { cycleId, siteId };
}

/** Stubs `window.print()` to a no-op — Payroll Summary's own Print Options dialog is what this file
 * actually exercises; the browser's native print dialog itself is out of scope here (already
 * covered for the shared engine by `13-print-architecture.spec.ts`). Real print-media geometry is
 * still exercised via `page.emulateMedia({ media: 'print' })` below, independent of this stub. */
async function stubWindowPrint(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

async function openPrintOptionsAndConfirm(page: import('@playwright/test').Page, presetName?: string) {
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Print Options')).toBeVisible();
  if (presetName) {
    await dialog.getByRole('button', { name: presetName, exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
    // `exact: true` — the Dashboard's own "Site Payroll Summary" heading and its "...see full
    // Payroll Summary" link both superstring-match a bare `getByText('Payroll Summary')`, and
    // Playwright fails a strict-mode violation immediately rather than retrying it out, so a loose
    // locator here can lose the race against the ~100ms client-side route swap and never get the
    // chance to wait for it. The catalogue card's own title `<span>` (`reports-page.tsx`) is the
    // only element whose own text is exactly "Payroll Summary" — unambiguous against the old page,
    // and lets the assertion retry normally until the new page mounts.
    await expect(page.getByText('Payroll Summary', { exact: true })).toBeVisible();

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
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();
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

/**
 * Post-deployment Print Usability Refinement — real-Chromium verification that Payroll Summary's
 * new Print Options dialog actually solves the production UAT legibility complaint (the full
 * 19-column table's headings/monetary values were truncated and squashed when printed): a
 * user-selected preset's own headings/totals must render at full width, with no horizontal
 * clipping and no adjacent-cell overlap, while the on-screen report and Excel export stay
 * completely unaffected.
 */
test.describe('Reports — Payroll Summary Print Options', () => {
  test('the dialog opens defaulting to the complete Full Report — every card, every column — never a silently narrowed one', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `rpt-print-default-${Date.now()}`;
    const { cycleId } = await makeDraftCycleWithReleasableEntry(context, label);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycleId}/reports/payroll-summary`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Full Report (all fields)')).toBeVisible();
    await expect(dialog.getByText('Very Wide')).toBeVisible();
    await expect(dialog.getByText(/you have selected many columns/i)).toBeVisible();
    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.emulateMedia({ media: 'print' });
    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['Project Site', 'Held', 'Overtime', 'Balance Payable Included', 'Recovery Deducted']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    await page.emulateMedia({ media: 'screen' });
  });

  test('printing Compact Summary shows exactly its own headings and totals, fully visible with no clipping', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `rpt-print-compact-${Date.now()}`;
    const { cycleId } = await makeDraftCycleWithReleasableEntry(context, label);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycleId}/reports/payroll-summary`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();

    await openPrintOptionsAndConfirm(page, 'Compact Summary');
    await page.emulateMedia({ media: 'print' });

    const printTable = page.getByTestId('print-only-table');
    await expect(printTable).toBeVisible();
    // Every Compact Summary heading is present and, being real rendered text (not an ellipsized
    // truncation), fully matched by an exact accessible-text lookup — a clipped/ellipsized heading
    // ("Gross P…") would fail this exact match even though *some* text node still exists.
    for (const heading of ['Project Site', 'Employees', 'Gross Pay', 'Net Salary', 'Released Amount', 'Pending Release Amount']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    // A preset never selected these — must be absent from the print output entirely.
    await expect(printTable.getByRole('columnheader', { name: 'Held', exact: true })).toHaveCount(0);
    await expect(printTable.getByRole('columnheader', { name: 'Overtime', exact: true })).toHaveCount(0);

    // No horizontal clipping — the printed table's own rendered width must never exceed its
    // printable container's width (the same measurable proof `13-print-architecture.spec.ts`
    // already established for Bank Sheet/Cash Receiving).
    const overflowsHorizontally = await printTable.evaluate((container) => {
      const table = container.querySelector('table');
      return table !== null && table.scrollWidth > container.clientWidth + 1;
    });
    expect(overflowsHorizontally).toBe(false);

    // No cell-level ellipsis clipping — every header cell's full text content actually fits within
    // its own rendered box (scrollWidth <= clientWidth), the direct DOM proof that `.print-fit`'s
    // `overflow: hidden; text-overflow: ellipsis` was never applied here (this page never adds the
    // `print-fit` class — see `reports-payroll-summary-page.tsx`'s own `handlePrintConfirm`).
    const clippedHeaderCount = await printTable.evaluate((container) => {
      const headers = Array.from(container.querySelectorAll('th'));
      return headers.filter((th) => th.scrollWidth > th.clientWidth + 1).length;
    });
    expect(clippedHeaderCount).toBe(0);

    // Totals row fully visible, no overlap between adjacent total cells (each cell's own bounding
    // box must not intersect its right-hand neighbor's).
    const totalRow = printTable.locator('tfoot tr');
    await expect(totalRow).toBeVisible();
    const cellBoxes = await totalRow.locator('td').evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })),
    );
    for (let i = 0; i < cellBoxes.length - 1; i++) {
      const a = cellBoxes[i]!;
      const b = cellBoxes[i + 1]!;
      // Only compare cells on the same row band (defends against a wrapped/second-page layout,
      // where "adjacent in DOM order" isn't "adjacent on screen").
      if (Math.abs(a.top - b.top) < 2) {
        expect(a.right).toBeLessThanOrEqual(b.left + 1);
      }
    }

    await page.emulateMedia({ media: 'screen' });
  });

  test('Deductions preset prints exactly its own column set', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `rpt-print-deductions-${Date.now()}`;
    const { cycleId } = await makeDraftCycleWithReleasableEntry(context, label);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycleId}/reports/payroll-summary`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();
    await openPrintOptionsAndConfirm(page, 'Deductions');
    await page.emulateMedia({ media: 'print' });

    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['EOBI', 'Advance Deduction', 'Eid Advance Deduction', 'Fines', 'Recovery Deducted', 'Net Salary']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    await expect(printTable.getByRole('columnheader', { name: 'Released Amount', exact: true })).toHaveCount(0);

    await page.emulateMedia({ media: 'screen' });
  });

  test('Release Status preset prints exactly its own column set', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `rpt-print-release-status-${Date.now()}`;
    const { cycleId } = await makeDraftCycleWithReleasableEntry(context, label);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycleId}/reports/payroll-summary`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();
    await openPrintOptionsAndConfirm(page, 'Release Status');
    await page.emulateMedia({ media: 'print' });

    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['Held', 'Released', 'Pending', 'No Payout', 'Recovery Due', 'Released Amount', 'Pending Release Amount']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    await expect(printTable.getByRole('columnheader', { name: 'EOBI', exact: true })).toHaveCount(0);

    await page.emulateMedia({ media: 'screen' });
  });

  test('a custom hand-picked selection prints exactly the chosen columns, Project Site always included', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `rpt-print-custom-${Date.now()}`;
    const { cycleId } = await makeDraftCycleWithReleasableEntry(context, label);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycleId}/reports/payroll-summary`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Clear Optional Fields' }).click();
    const columnsGroup = dialog.getByRole('group', { name: /Site-table columns/ });
    await columnsGroup.getByRole('checkbox', { name: /^Overtime/ }).click();
    await columnsGroup.getByRole('checkbox', { name: /^Allowances/ }).click();
    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.emulateMedia({ media: 'print' });
    const printTable = page.getByTestId('print-only-table');
    await expect(printTable.getByRole('columnheader', { name: 'Project Site', exact: true })).toBeVisible();
    await expect(printTable.getByRole('columnheader', { name: 'Overtime', exact: true })).toBeVisible();
    await expect(printTable.getByRole('columnheader', { name: 'Allowances', exact: true })).toBeVisible();
    await expect(printTable.getByRole('columnheader', { name: 'Net Salary', exact: true })).toHaveCount(0);

    await page.emulateMedia({ media: 'screen' });
  });

  test('the on-screen report always shows every column, unaffected by any print field selection', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `rpt-print-onscreen-${Date.now()}`;
    const { cycleId } = await makeDraftCycleWithReleasableEntry(context, label);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycleId}/reports/payroll-summary`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();
    await openPrintOptionsAndConfirm(page, 'Compact Summary');

    // Still screen media — the on-screen table (`on-screen-table`) must show every one of the
    // report's own 18 data columns, exactly as before this refinement, regardless of the Compact
    // Summary selection just confirmed.
    const onScreenTable = page.getByTestId('on-screen-table');
    for (const heading of ['Held', 'Overtime', 'Allowances', 'Advances', 'Eid Advances', 'Bal. Payable', 'Recovery Ded.']) {
      await expect(onScreenTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
  });

  test('Excel export still contains the complete filtered report after using Print', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `rpt-print-export-${Date.now()}`;
    const { cycleId } = await makeDraftCycleWithReleasableEntry(context, label);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycleId}/reports/payroll-summary`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Site ${label}`)).toBeVisible();
    await openPrintOptionsAndConfirm(page, 'Compact Summary');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^payroll-summary-.*\.xlsx$/);
  });
});
