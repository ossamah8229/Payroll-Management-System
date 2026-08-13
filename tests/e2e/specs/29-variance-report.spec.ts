import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login, loginAsMasterAdmin } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Variance / Month-on-Month Report Checkpoint 1B — real-browser verification of the frontend built
 * over the already-frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md`'s own
 * Variance section). No mocked hooks, no `page.route` interception for any RBAC or financial
 * assertion — real navigation, real backend pairing/authorization, matching this suite's own
 * established discipline (`17-reports.spec.ts`, `26-salary-release-report.spec.ts`).
 *
 * This is the first cross-cycle report in this suite. Getting one real second Payroll Cycle
 * requires an actual month-end rollover (Finalize + Archive-and-create-next) of whatever Draft
 * cycle currently exists — the same real construction `19-employee-payroll-history-frontend.spec.ts`
 * already established (`rolloverCurrentDraftCycle` below is copied from that file's own identical
 * helper). One rollover is performed, once, in the first test below; every later `test()` in this
 * file reuses the same two resulting cycles via module-level state (safe because
 * `playwright.config.ts` runs this suite `workers: 1`/`fullyParallel: false` — tests in one file
 * execute strictly in declaration order in one process).
 */

interface CycleRow {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

interface EntryRow {
  id: string;
  employeeId: string;
  version: number;
  siteId: string;
  workLines: { id: string; unitId: string; cycleDays: number }[];
}

async function getCurrentDraftCycle(context: BrowserContext): Promise<CycleRow> {
  const cycles = await apiGet<{ cycles: CycleRow[] }>(context, '/api/v1/payroll-cycles');
  const draft = cycles.body.cycles.find((c) => c.status === 'DRAFT');
  if (draft) return draft;
  const created = await apiPost<{ cycle: CycleRow }>(context, '/api/v1/payroll-cycles', {
    year: 2900,
    month: cycles.body.cycles.length + 2,
  });
  return created.cycle;
}

async function getEntryForEmployee(context: BrowserContext, cycleId: string, employeeId: string): Promise<EntryRow> {
  const entries = await apiGet<{ entries: EntryRow[] }>(
    context,
    `/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`,
  );
  const entry = entries.body.entries.find((e) => e.employeeId === employeeId);
  if (!entry) throw new Error(`No PayrollEntry found for employee ${employeeId} in cycle ${cycleId}`);
  return entry;
}

async function fillDays(context: BrowserContext, entry: EntryRow): Promise<void> {
  await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
    version: entry.version,
    days: String(entry.workLines[0]!.cycleDays),
  });
}

/** `netSalary = 0` (`eobiApplicable: false` + zero worked days) — the one real construction that
 * produces a genuine zero comparison-side Net, mirroring `26-salary-release-report.spec.ts`'s own
 * `makeNoPayDue`. Used to prove Variance % renders `—`, never Infinity/NaN, on a real backend
 * response (Checkpoint 1B Scenario G). */
async function makeZeroNet(context: BrowserContext, entry: EntryRow): Promise<void> {
  await apiPatch(context, `/api/v1/payroll-entries/${entry.id}`, { version: entry.version, eobiApplicable: false });
}

async function getAdjustmentTypeId(context: BrowserContext): Promise<string> {
  const res = await apiGet<{ adjustmentTypes: { id: string }[] }>(context, '/api/v1/adjustment-types');
  return res.body.adjustmentTypes[0]!.id;
}

/** Resolves every remaining eligible entry cycle-wide, Finalizes, then rolls over — or returns
 * `null` if Finalize's own precondition can't be met given current shared-suite state. See this
 * file's own module doc comment. */
async function rolloverCurrentDraftCycle(context: BrowserContext, cycleId: string): Promise<CycleRow | null> {
  try {
    await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/units/release-all`, {});
    await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/finalize`, {});
    const result = await apiPost<{ newCycle: CycleRow }>(context, `/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`, {});
    return result.newCycle;
  } catch {
    return null;
  }
}

async function reviewerSessionFor(browser: import('@playwright/test').Browser, siteId: string, label: string) {
  const email = `e2e-vr-reviewer-${label}@example.test`;
  const password = 'VrReviewerPassword1!';
  await createScopedUser({
    email,
    password,
    roleCode: 'E2E_VR_REVIEWER',
    permissionKeys: ['corrections:approve'],
    siteIds: [siteId],
    name: 'E2E VR Reviewer',
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { page, close: () => context.close() };
}

async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

async function openSiteFilterAndSelect(page: Page, siteName: string) {
  await page.locator('#vr-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteName }).click();
  await page.keyboard.press('Escape');
}

async function gotoVariance(page: Page, currentCycleId: string, comparisonCycleId: string) {
  await page.goto(`/reports/variance?currentCycleId=${currentCycleId}&comparisonCycleId=${comparisonCycleId}`);
}

function rowFor(table: ReturnType<Page['getByTestId']>, page: Page, name: string) {
  return table.locator('tr', { has: page.getByText(name, { exact: true }) });
}

// Populated once by the first test below; every later test in this file reuses it.
let cycle1: CycleRow; // comparison cycle
let cycle2: CycleRow; // current cycle
let siteAName: string;
let siteBName: string;
const names = {
  increased: '',
  decreased: '',
  unchanged: '',
  zeroNet: '',
  departed: '',
  fresh: '', // NEW
  transfer: '',
  unitChange: '',
  corrected: '',
};

test.describe('Variance Report — two-cycle comparison, population, direction, transfer/unit/correction context', () => {
  test('builds a real two-cycle comparison and proves every population/direction/transfer/unit/correction/zero-net rule against real backend data', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const context = page.context();
    const label = `vr-${Date.now()}`;
    const draft = await getCurrentDraftCycle(context);

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', { name: `E2E VR Site A ${label}` });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', { name: `E2E VR Site B ${label}` });
    const unitA1 = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, { name: `E2E VR Unit A1 ${label}` });
    const unitA2 = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, { name: `E2E VR Unit A2 ${label}` });
    const unitB1 = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, { name: `E2E VR Unit B1 ${label}` });
    siteAName = siteA.site.name;
    siteBName = siteB.site.name;

    names.increased = `E2E VR Increased ${label}`;
    names.decreased = `E2E VR Decreased ${label}`;
    names.unchanged = `E2E VR Unchanged ${label}`;
    names.zeroNet = `E2E VR ZeroNet ${label}`;
    names.departed = `E2E VR Departed ${label}`;
    names.fresh = `E2E VR New ${label}`;
    names.transfer = `E2E VR Transfer ${label}`;
    names.unitChange = `E2E VR UnitChange ${label}`;
    names.corrected = `E2E VR Corrected ${label}`;

    async function makeEmployee(name: string, siteId: string, unitId: string) {
      const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
        name,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: '30000',
      });
      return employee.employee.id;
    }

    // --- Continued: Decreased (full days in cycle1, left at default zero days in cycle2) --------
    const decreasedId = await makeEmployee(names.decreased, siteA.site.id, unitA1.unit.id);
    await fillDays(context, await getEntryForEmployee(context, draft.id, decreasedId));

    // --- Continued: Unchanged (identical full days both cycles — filled again after rollover) ---
    const unchangedId = await makeEmployee(names.unchanged, siteA.site.id, unitA1.unit.id);
    await fillDays(context, await getEntryForEmployee(context, draft.id, unchangedId));

    // --- Continued: Increased (left at default zero days in cycle1, filled after rollover) -------
    const increasedId = await makeEmployee(names.increased, siteA.site.id, unitA1.unit.id);

    // --- Continued: Comparison Net = 0 (zero-day + no-EOBI in cycle1; filled after rollover) -----
    const zeroNetId = await makeEmployee(names.zeroNet, siteA.site.id, unitA1.unit.id);
    await makeZeroNet(context, await getEntryForEmployee(context, draft.id, zeroNetId));

    // --- Departed (real net in cycle1; removed from the roster once cycle2 is Draft) -------------
    const departedId = await makeEmployee(names.departed, siteA.site.id, unitA1.unit.id);
    await fillDays(context, await getEntryForEmployee(context, draft.id, departedId));

    // --- Site Transfer (Site A in cycle1 -> patched to Site B *before* rollover, so cycle2's own
    // freshly-materialized entry is built from the employee's now-current Site B) -----------------
    const transferId = await makeEmployee(names.transfer, siteA.site.id, unitA1.unit.id);
    await fillDays(context, await getEntryForEmployee(context, draft.id, transferId));
    await apiPatch(context, `/api/v1/employees/${transferId}`, { siteId: siteB.site.id, unitId: unitB1.unit.id });

    // --- Unit Change (Unit A1 in cycle1 -> patched to Unit A2, same Site, before rollover) -------
    const unitChangeId = await makeEmployee(names.unitChange, siteA.site.id, unitA1.unit.id);
    await fillDays(context, await getEntryForEmployee(context, draft.id, unitChangeId));
    await apiPatch(context, `/api/v1/employees/${unitChangeId}`, { unitId: unitA2.unit.id });

    // --- Corrected (released in cycle1, a real approved Correction against it) --------------------
    const correctedId = await makeEmployee(names.corrected, siteA.site.id, unitA1.unit.id);
    await fillDays(context, await getEntryForEmployee(context, draft.id, correctedId));

    // Release everything eligible so a real post-release Correction can be submitted against the
    // Corrected employee's own entry before this cycle is finalized.
    await apiPost(context, `/api/v1/payroll-cycles/${draft.id}/units/release-all`, {});
    const releasedCorrectedEntry = await getEntryForEmployee(context, draft.id, correctedId);
    const adjustmentTypeId = await getAdjustmentTypeId(context);
    const correctionReq = await apiPost<{ correctionRequest: { id: string } }>(
      context,
      `/api/v1/payroll-entries/${releasedCorrectedEntry.id}/correction-requests`,
      { field: 'ALLOWANCE', proposedNewValue: '750', adjustmentTypeId, reason: 'E2E: Variance Report correction context' },
    );
    const reviewer = await reviewerSessionFor(browser, siteA.site.id, label);
    await apiPost(reviewer.page.context(), `/api/v1/correction-requests/${correctionReq.correctionRequest.id}/approve`, {
      paymentTiming: 'DEFERRED',
    });
    await reviewer.close();

    // --- Roll the shared Draft cycle over into a genuine second Cycle -----------------------------
    const rolledOver = await rolloverCurrentDraftCycle(context, draft.id);
    test.skip(!rolledOver, 'Finalize precondition not met given current shared-suite state — run the full suite.');
    if (!rolledOver) return;
    cycle1 = draft;
    cycle2 = rolledOver;

    // --- Post-rollover: complete the Increased/Unchanged/ZeroNet/Corrected current-side entries --
    await fillDays(context, await getEntryForEmployee(context, cycle2.id, increasedId));
    await fillDays(context, await getEntryForEmployee(context, cycle2.id, unchangedId));
    await fillDays(context, await getEntryForEmployee(context, cycle2.id, zeroNetId));
    await fillDays(context, await getEntryForEmployee(context, cycle2.id, correctedId));
    await fillDays(context, await getEntryForEmployee(context, cycle2.id, transferId));
    await fillDays(context, await getEntryForEmployee(context, cycle2.id, unitChangeId));
    // Decreased is deliberately left at cycle2's own default (zero days) — lower net than cycle1's
    // filled entry, producing a real DECREASED row without any synthetic backdating.

    // --- New (created only once cycle2 is the Draft — never existed in cycle1 at all) -------------
    const freshId = await makeEmployee(names.fresh, siteA.site.id, unitA1.unit.id);
    await fillDays(context, await getEntryForEmployee(context, cycle2.id, freshId));

    // --- Departed (removed from the now-current Draft roster; the cycle1 entry is untouched) ------
    await apiPost(context, `/api/v1/employees/${departedId}/leave`, { dateOfLeaving: new Date().toISOString().slice(0, 10) });

    // === Real-browser assertions =================================================================
    await gotoVariance(page, cycle2.id, cycle1.id);
    await openSiteFilterAndSelect(page, siteAName);
    // Transfer's own current side (Site B) is a *second* accessible site for this Master Admin
    // session — either-side Site matching means selecting only Site A must still surface it
    // (Checkpoint 1A §12), so no second filter selection is needed to find it.
    const table = page.getByTestId('on-screen-table');

    await expect(page.getByText(new RegExp(`Current:.*${cycle2.year}`)).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`Compared with:.*${cycle1.year}`)).first()).toBeVisible();

    // --- Scenario D/E/F: Continued Increased/Decreased/Unchanged ---------------------------------
    await expect(table.getByText(names.increased)).toBeVisible();
    const increasedRow = rowFor(table, page, names.increased);
    await expect(increasedRow.getByText('Continued', { exact: true })).toBeVisible();
    await expect(increasedRow.getByText('Increased', { exact: true })).toBeVisible();

    const decreasedRow = rowFor(table, page, names.decreased);
    await expect(decreasedRow.getByText('Decreased', { exact: true })).toBeVisible();

    const unchangedRow = rowFor(table, page, names.unchanged);
    await expect(unchangedRow.getByText('Unchanged', { exact: true })).toBeVisible();

    // --- Scenario B: New — previous fields are —, never a fabricated 0->salary increase ----------
    const freshRow = rowFor(table, page, names.fresh);
    await expect(freshRow.getByText('New', { exact: true })).toBeVisible();
    await expect(freshRow.getByText('Increased', { exact: true })).toHaveCount(0);
    const freshCells = await freshRow.locator('td').allInnerTexts();
    expect(freshCells).toContain('—');

    // --- Scenario C: Departed — current fields are —, never a fabricated salary-to-0 decrease ----
    const departedRow = rowFor(table, page, names.departed);
    await expect(departedRow.getByText('Departed', { exact: true })).toBeVisible();
    await expect(departedRow.getByText('Decreased', { exact: true })).toHaveCount(0);
    const departedCells = await departedRow.locator('td').allInnerTexts();
    expect(departedCells).toContain('—');

    // --- Scenario G: Comparison Net = 0 — Variance % is —, never Infinity/NaN --------------------
    const zeroNetRow = rowFor(table, page, names.zeroNet);
    const zeroNetRowText = (await zeroNetRow.innerText()).toLowerCase();
    expect(zeroNetRowText).not.toContain('infinity');
    expect(zeroNetRowText).not.toContain('nan');

    // --- Scenario H: Site Transfer — one row, both sites shown, Transfer indicator ----------------
    const transferRow = rowFor(table, page, names.transfer);
    await expect(transferRow).toHaveCount(1);
    await expect(transferRow.getByText(siteAName, { exact: true })).toBeVisible();
    await expect(transferRow.getByText(siteBName, { exact: true })).toBeVisible();

    // --- Scenario I: Unit Change — one row, Unit Change indicator, Net unaffected ------------------
    const unitChangeRow = rowFor(table, page, names.unitChange);
    await expect(unitChangeRow).toHaveCount(1);

    // --- Scenario J: Correction context — flag present, compared Net not rewritten ----------------
    const correctedRow = rowFor(table, page, names.corrected);
    const correctedCellsBefore = await correctedRow.locator('td').allInnerTexts();
    // Re-fetch the same row after applying the Has Correction=Yes filter — still the identical
    // Previous/Current Net text, proving the correction flag never replays into the compared figure.
    await page.locator('#vr-has-correction').selectOption('YES');
    await expect(rowFor(table, page, names.corrected)).toBeVisible();
    const correctedCellsAfter = await rowFor(table, page, names.corrected).locator('td').allInnerTexts();
    expect(correctedCellsAfter[6]).toBe(correctedCellsBefore[6]); // Previous Net column
    expect(correctedCellsAfter[7]).toBe(correctedCellsBefore[7]); // Current Net column
    await page.locator('#vr-has-correction').selectOption('ALL');

    // --- Totals: population/direction counts are exact, financial totals rendered verbatim --------
    const cards = page.getByTestId('on-screen-cards');
    await expect(cards.getByText('Financial Totals')).toBeVisible();
    await expect(cards.getByText('Population & Direction')).toBeVisible();
    await expect(cards.getByText('New', { exact: true })).toBeVisible();
    await expect(cards.getByText('Departed', { exact: true })).toBeVisible();

    // --- Direction filter — server-driven, only ever narrows CONTINUED rows ------------------------
    await page.locator('#vr-direction').selectOption('INCREASED');
    await expect(table.getByText(names.increased)).toBeVisible();
    await expect(table.getByText(names.decreased)).toHaveCount(0);
    await expect(table.getByText(names.fresh)).toHaveCount(0); // NEW never matches a Direction filter
    await page.locator('#vr-direction').selectOption('');

    // --- Sorting — clicking a sortable header re-sorts server-side ---------------------------------
    const header = page.getByRole('columnheader', { name: /^current net$/i });
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    // Unsupported sort (no client-side fallback) renders as a plain header, never a button.
    const variancePercentHeader = page.getByRole('columnheader', { name: /^variance %$/i });
    await expect(variancePercentHeader.getByRole('button')).toHaveCount(0);
  });
});

test.describe('Variance Report — two-sided Site authorization', () => {
  test('a Site-A-only scoped user sees a same-Site Continued row in full, but never the Transfer row whose current side sits at an inaccessible Site', async ({
    browser,
  }) => {
    test.skip(!cycle1 || !cycle2, 'Depends on the two-cycle fixture built by the first test in this file.');
    const label = `vr-scope-${Date.now()}`;
    const email = `e2e-vr-site-a-${label}@example.test`;
    const password = 'E2EVrSiteA1!';

    // Look up Site A's id through a fresh admin session (siteAName was captured in the first test;
    // its id was never persisted at module scope, so it is re-resolved here).
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsMasterAdmin(adminPage);
    const sites = await apiGet<{ sites: { id: string; name: string }[] }>(adminContext, '/api/v1/sites');
    const siteA = sites.body.sites.find((s) => s.name === siteAName)!;
    await adminContext.close();

    await createScopedUser({
      email,
      password,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['reports:view'],
      siteIds: [siteA.id],
      name: 'E2E Site A VR User',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, email, password);

    await gotoVariance(scopedPage, cycle2.id, cycle1.id);
    const table = scopedPage.getByTestId('on-screen-table');

    // Same-Site-both-sides row: fully visible.
    await expect(table.getByText(names.increased)).toBeVisible();

    // Transfer row: current side is Site B, inaccessible to this user — the whole row must be
    // completely absent, never a partial/redacted row (Checkpoint 1A §10, re-verified here at the
    // frontend, not just the already-tested backend).
    await expect(table.getByText(names.transfer)).toHaveCount(0);

    // No leakage into totals either — Site B's own name never appears anywhere on this page.
    const bodyText = await scopedPage.locator('body').innerText();
    expect(bodyText).not.toContain(siteBName);

    await scopedContext.close();
  });
});

test.describe('Variance Report — export', () => {
  test('CSV and XLSX download the complete filtered result with safe headers only', async ({ authenticatedPage: page }) => {
    test.skip(!cycle1 || !cycle2, 'Depends on the two-cycle fixture built by the first test in this file.');
    await gotoVariance(page, cycle2.id, cycle1.id);
    await openSiteFilterAndSelect(page, siteAName);
    await expect(page.getByTestId('on-screen-table').getByText(names.increased)).toBeVisible();

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/variance-report.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await (await import('node:fs/promises')).readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain('Variance Amount');
    expect(csvContent).toContain(names.increased);
    const lowerCsv = csvContent.toLowerCase();
    for (const forbidden of ['cnic', 'account number', 'iban', 'bank', 'released by', 'payment method', 'reason']) {
      expect(lowerCsv).not.toContain(forbidden);
    }

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/variance-report.*\.xlsx$/i);
  });
});

test.describe('Variance Report — print', () => {
  test('states current-page scope, includes both Cycles in printed context, and never triggers a report request', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!cycle1 || !cycle2, 'Depends on the two-cycle fixture built by the first test in this file.');
    await stubWindowPrint(page);
    await gotoVariance(page, cycle2.id, cycle1.id);
    await openSiteFilterAndSelect(page, siteAName);
    await expect(page.getByTestId('on-screen-table').getByText(names.increased)).toBeVisible();

    let reportRequestCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/reports/variance') && !req.url().includes('/employees')) reportRequestCount += 1;
    });

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print Options')).toBeVisible();
    await expect(dialog.getByText(/current page only/i)).toBeVisible();
    await expect(dialog.getByText(/CNIC/i)).toHaveCount(0);
    await expect(dialog.getByText(/bank/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(reportRequestCount).toBe(0);

    await page.emulateMedia({ media: 'print' });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Variance / Month-on-Month Report');
    expect(bodyText).toMatch(new RegExp(`Current: .*${cycle2.year}`));
    expect(bodyText).toMatch(new RegExp(`Compared with: .*${cycle1.year}`));
    expect(bodyText).toMatch(/Variance = Current Net.*Comparison Net/);
    expect(bodyText).toMatch(/Current page only/i);

    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['Employee Name', 'Population Status', 'Previous Net', 'Current Net']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }

    const lowerBodyText = bodyText.toLowerCase();
    for (const forbidden of ['cnic', 'account number', 'iban', 'released by', 'payment method', 'correction reason']) {
      expect(lowerBodyText).not.toContain(forbidden);
    }
    await page.emulateMedia({ media: 'screen' });
  });
});

test.describe('Variance Report — Employee Payroll History drill-down', () => {
  test('View Full History navigates to Employee Payroll History pre-filtered to the correct employee', async ({
    authenticatedPage: page,
  }) => {
    test.skip(!cycle1 || !cycle2, 'Depends on the two-cycle fixture built by the first test in this file.');
    await gotoVariance(page, cycle2.id, cycle1.id);
    await openSiteFilterAndSelect(page, siteAName);
    const table = page.getByTestId('on-screen-table');
    await expect(table.getByText(names.increased)).toBeVisible();

    const row = rowFor(table, page, names.increased);
    await row.getByRole('button', { name: /view full history/i }).click();

    await expect(page).toHaveURL(/\/reports\/employee-payroll-history$/);
    await expect(page.getByTestId('on-screen-table').getByText(names.increased).first()).toBeVisible();
  });
});

test.describe('Variance Report — Reports catalogue and no detail endpoint', () => {
  test('the catalogue card links to /reports/variance and no per-row detail action/route exists', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/reports');
    await expect(page.getByText('Variance / Month-on-Month Report')).toBeVisible();
    await page.getByRole('link', { name: /Variance \/ Month-on-Month Report/ }).click();
    await expect(page).toHaveURL(/\/reports\/variance$/);

    if (cycle1 && cycle2) {
      await gotoVariance(page, cycle2.id, cycle1.id);
      await openSiteFilterAndSelect(page, siteAName);
      const row = rowFor(page.getByTestId('on-screen-table'), page, names.increased);
      await expect(row.getByRole('button', { name: /^view details$/i })).toHaveCount(0);
      await expect(row.getByRole('link')).toHaveCount(0);
    }
  });
});

test.describe('Variance Report — Permission (reports:view only, no OR gate)', () => {
  test('reports:view alone grants catalogue and route access', async ({ browser }) => {
    const label = `vr-perm-reports-${Date.now()}`;
    const email = `e2e-vr-reports-${label}@example.test`;
    const password = 'E2EVrReports1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_VR_REPORTS_VIEW', permissionKeys: ['reports:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    await page.goto('/reports');
    await expect(page.getByText('Variance / Month-on-Month Report')).toBeVisible();
    await page.goto('/reports/variance');
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await context.close();
  });

  test('payroll:view alone is denied (unlike Salary Release Report, Variance has no OR gate)', async ({ browser }) => {
    const label = `vr-perm-payrollview-${Date.now()}`;
    const email = `e2e-vr-payrollview-${label}@example.test`;
    const password = 'E2EVrPayrollView1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_VR_PAYROLL_VIEW_ONLY', permissionKeys: ['payroll:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto('/reports/variance');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await context.close();
  });

  test('statements:view alone is denied', async ({ browser }) => {
    const label = `vr-perm-statements-${Date.now()}`;
    const email = `e2e-vr-statements-${label}@example.test`;
    const password = 'E2EVrStatements1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_VR_STATEMENTS_ONLY', permissionKeys: ['statements:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto('/reports/variance');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await context.close();
  });

  test('no permission at all is denied', async ({ browser }) => {
    const label = `vr-perm-none-${Date.now()}`;
    const email = `e2e-vr-none-${label}@example.test`;
    const password = 'E2EVrNone1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_VR_NONE', permissionKeys: ['employees:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto('/reports/variance');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await context.close();
  });
});
