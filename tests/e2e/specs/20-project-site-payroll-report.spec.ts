import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Project Site Payroll Report Checkpoint 1B — real-browser verification of the frontend built over
 * the already-frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §16). No
 * mocked hooks, no `page.route` interception for any RBAC or financial assertion — real navigation,
 * real backend aggregation, real permission enforcement, matching this suite's own established
 * discipline (`17-reports.spec.ts`, `19-employee-payroll-history-frontend.spec.ts`).
 *
 * This suite runs sequentially against one shared, disposable database (`playwright.config.ts`'s
 * `workers: 1`) and one shared Draft `PayrollCycle` accumulating fixture entries from every earlier
 * spec file — every test below filters by its own freshly-created Site so it never has to reason
 * about, or be defeated by, unrelated rows already in that cycle (the same discipline
 * `13-print-architecture.spec.ts`/`17-reports.spec.ts` already established).
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
  workLines: { id: string; unitId: string; cycleDays: number }[];
}

/** Resolves the current Draft cycle, bootstrapping the very first cycle ever if none exists yet —
 * the same resolve-or-bootstrap pattern `17-reports.spec.ts`/`19-employee-payroll-history-
 * frontend.spec.ts` already establish. */
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

/** Sets a full month of worked days (a real, positive net salary) on an entry's primary work line —
 * does not release. Mirrors `17-reports.spec.ts`'s/`19-employee-payroll-history-frontend.spec.ts`'s
 * own identical helper. */
async function fillDays(context: BrowserContext, entry: EntryRow): Promise<void> {
  await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
    version: entry.version,
    days: String(entry.workLines[0]!.cycleDays),
  });
}

async function releaseUnit(context: BrowserContext, cycleId: string, unitId: string): Promise<void> {
  await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`, {});
}

async function getAdjustmentTypeId(context: BrowserContext): Promise<string> {
  const res = await apiGet<{ adjustmentTypes: { id: string }[] }>(context, '/api/v1/adjustment-types');
  return res.body.adjustmentTypes[0]!.id;
}

/** A second, independent logged-in session holding only `corrections:approve` — the requester can
 * never approve their own request (`assertNotSelfReview`), mirroring `19-employee-payroll-history-
 * frontend.spec.ts`'s own `reviewerSessionFor`. */
async function reviewerSessionFor(browser: import('@playwright/test').Browser, siteId: string) {
  const email = `e2e-psp-reviewer-${Date.now()}@example.test`;
  const password = 'PspReviewerPassword1!';
  await createScopedUser({
    email,
    password,
    roleCode: 'E2E_PSP_REVIEWER',
    permissionKeys: ['corrections:approve'],
    siteIds: [siteId],
    name: 'E2E PSP Reviewer',
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { page, close: () => context.close() };
}

async function openSiteFilterAndSelect(page: Page, siteName: string) {
  await page.locator('#psp-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteName }).click();
  await page.keyboard.press('Escape');
}

async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

test.describe('Project Site Payroll Report — Master User', () => {
  test('navigation, Cycle selection, Site filter, totals, sorting, and pagination', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `psp-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    // --- Navigation: Reports catalogue -> Project Site Payroll Report ------------------------
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Project Site Payroll Report')).toBeVisible();
    await page.getByRole('link', { name: /Project Site Payroll Report/ }).click();
    await expect(page).toHaveURL(/\/reports\/project-site-payroll$|\/payroll-cycles\/.+\/reports\/project-site-payroll$/);

    // The page defaults to the current Draft cycle (`useSelectedPayrollCycle`'s own
    // default-selection rule) — select ours explicitly if a different one resolved.
    const cycleSelect = page.locator('#psp-cycle');
    await expect(cycleSelect).toBeVisible();
    if ((await cycleSelect.inputValue()) !== cycle.id) {
      await cycleSelect.selectOption(cycle.id);
    }

    // --- Site filter narrows to exactly our fixture's one row --------------------------------
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(`E2E Employee ${label}`)).toBeVisible();
    await expect(onScreenTable.getByText(`E2E Site ${label}`)).toBeVisible();
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);

    // --- Totals: backend-provided, matching exactly this one row -----------------------------
    await expect(page.getByTestId('psp-stat-matching-entries')).toHaveText(/1/);
    await expect(page.getByText('Payroll Totals')).toBeVisible();
    await expect(page.getByText('Status Counts')).toBeVisible();

    // --- Sorting: clicking a sortable header updates its own aria-sort -----------------------
    const netSalaryHeader = page.getByRole('columnheader', { name: /net salary/i });
    await netSalaryHeader.getByRole('button').click();
    await expect(netSalaryHeader).toHaveAttribute('aria-sort', 'ascending');
    await netSalaryHeader.getByRole('button').click();
    await expect(netSalaryHeader).toHaveAttribute('aria-sort', 'descending');

    // --- Pagination: server-provided metadata, Previous disabled on page 1 -------------------
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });
});

test.describe('Project Site Payroll Report — Site scoping', () => {
  test('a site-scoped user sees only accessible historical rows; a later transfer keeps the entry under its historical Site; the inaccessible Site is never offered as a filter; no cross-site leak', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `psp-scope-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E PSP Site A ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, {
      name: `E2E PSP Unit A ${label}`,
    });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E PSP Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E PSP Unit B ${label}`,
    });

    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E PSP Transferred ${label}`,
      designation: 'Guard',
      siteId: siteA.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });
    const employeeName = `E2E PSP Transferred ${label}`;

    // A second employee, released entirely under Site B — proves "no cross-site leak," not just
    // "the transferred employee's Site-A row is visible."
    const siteBOnlyEmployee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E PSP Site B Only ${label}`,
      designation: 'Guard',
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
      grossPay: '25000',
    });

    const entryA = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    await fillDays(context, entryA);
    const entryBOnly = await getEntryForEmployee(context, cycle.id, siteBOnlyEmployee.employee.id);
    await fillDays(context, entryBOnly);

    // The employee's *current* record moves to Site B — the already-created PayrollEntry keeps its
    // own frozen `siteId` (Site A), per `PayrollEntry.siteId` never following a live transfer.
    await apiPatch(context, `/api/v1/employees/${employee.employee.id}`, {
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
    });

    const scopedEmail = `e2e-psp-site-a-${label}@example.test`;
    const scopedPassword = 'E2EPspSiteA1!';
    await createScopedUser({
      email: scopedEmail,
      password: scopedPassword,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['reports:view'],
      siteIds: [siteA.site.id],
      name: 'E2E Site A PSP User',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, scopedEmail, scopedPassword);

    await scopedPage.goto(`/payroll-cycles/${cycle.id}/reports/project-site-payroll`);
    const onScreenTable = scopedPage.getByTestId('on-screen-table');

    // Discoverable and visible via the Site-A historical row, despite the live transfer.
    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    await expect(onScreenTable.getByText(siteA.site.name)).toBeVisible();

    // No cross-site leak: the Site-B-only employee's row never appears for this Site-A-scoped user.
    await expect(onScreenTable.getByText(`E2E PSP Site B Only ${label}`)).toHaveCount(0);
    await expect(onScreenTable.getByText(siteB.site.name)).toHaveCount(0);

    // The inaccessible Site is never offered as a filter option.
    await scopedPage.locator('#psp-site-filter').click();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteA.site.name })).toBeVisible();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteB.site.name })).toHaveCount(0);
    await scopedPage.keyboard.press('Escape');

    // A direct API call naming the inaccessible Site is rejected with 403, never silently narrowed.
    const rejected = await apiGet(scopedContext, `/api/v1/reports/project-site-payroll?cycleId=${cycle.id}&siteIds=${siteB.site.id}`);
    expect(rejected.status).toBe(403);

    await scopedContext.close();
  });
});

test.describe('Project Site Payroll Report — Unit filtering', () => {
  test('a multi-unit employee remains exactly one row; the Unit filter matches work-line membership; no per-Unit financial total ever appears', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `psp-unit-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E PSP Multi-Unit Site ${label}`,
    });
    const unit1 = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E PSP Unit One ${label}`,
    });
    const unit2 = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E PSP Unit Two ${label}`,
    });
    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E PSP Multi-Unit Employee ${label}`,
      designation: 'Guard',
      siteId: site.site.id,
      unitId: unit1.unit.id,
      grossPay: '30000',
    });

    let entry = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    // v1.0.3 M2 checkpoint — a genuine multi-unit split's combined Working Days can never exceed
    // the applicable Cycle Days (`workingDaysExceedCycleDays`), so this leaves 5 days of headroom
    // on the primary line for the second line below, rather than `fillDays`'s usual "full month on
    // one line" convention — no assertion in this test depends on the exact days split.
    const primaryCycleDays = entry.workLines[0]!.cycleDays;
    await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
      version: entry.version,
      days: String(primaryCycleDays - 5),
    });
    entry = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    // Split into a second work line at Unit Two — a genuine multi-unit deputation within one Site
    // (Principle 7: work lines can never span more than one Site, but can span Units).
    await apiPost(context, `/api/v1/payroll-entries/${entry.id}/work-lines`, {
      version: entry.version,
      unitId: unit2.unit.id,
      days: '5',
    });
    entry = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    expect(entry.workLines).toHaveLength(2);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/project-site-payroll`);
    await openSiteFilterAndSelect(page, site.site.name);

    // Exactly one row — never one per work line/Unit.
    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(/\+1 more/)).toBeVisible();

    // Unit filter enabled only because exactly one Site is selected; matches on work-line
    // membership — the row remains visible whichever of the employee's two Units is chosen.
    const unitSelect = page.locator('#psp-unit-filter');
    await expect(unitSelect).toBeEnabled();
    await unitSelect.selectOption(unit1.unit.id);
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await unitSelect.selectOption(unit2.unit.id);
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);

    // No per-Unit financial total anywhere on the page — every monetary figure is either this row's
    // own entry-level total or the cycle-wide totals cards, never a Unit-scoped breakdown.
    const bodyText = await page.locator('body').innerText();
    expect(/unit total/i.test(bodyText)).toBe(false);
    expect(/per.unit/i.test(bodyText)).toBe(false);
  });
});

test.describe('Project Site Payroll Report — Row statuses', () => {
  test('Released, Held, No Pay Due, Recovery Due, and Pending all render with the correct badge', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `psp-status-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E PSP Status Site ${label}`,
    });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E PSP Status Unit ${label}`,
    });

    async function makeEmployee(name: string, grossPay: string, defaultEobiApplicable?: boolean) {
      const res = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
        name,
        designation: 'Guard',
        siteId: site.site.id,
        unitId: unit.unit.id,
        grossPay,
        ...(defaultEobiApplicable === undefined ? {} : { defaultEobiApplicable }),
      });
      return res.employee.id;
    }

    const heldName = `E2E PSP Held ${label}`;
    const heldId = await makeEmployee(heldName, '30000');
    const heldEntry = await getEntryForEmployee(context, cycle.id, heldId);
    await apiPatch(context, `/api/v1/payroll-entries/${heldEntry.id}`, { version: heldEntry.version, hold: true });

    // Zero gross pay, EOBI not applicable, zero worked days -> netSalary computes to exactly 0.
    const noPayName = `E2E PSP No Pay ${label}`;
    const noPayId = await makeEmployee(noPayName, '0', false);

    // Positive grossPay, zero worked days, EOBI applicable (default) -> earnings 0, deductions > 0
    // -> negative net.
    const recoveryName = `E2E PSP Recovery ${label}`;
    const recoveryId = await makeEmployee(recoveryName, '30000');

    const releasedName = `E2E PSP Released ${label}`;
    const releasedId = await makeEmployee(releasedName, '30000');
    const releasedEntry = await getEntryForEmployee(context, cycle.id, releasedId);
    await fillDays(context, releasedEntry);

    await releaseUnit(context, cycle.id, unit.unit.id);

    // A brand-new entry added to an already-released Unit has no sweep left to reach it (the "Late
    // Entry" gap, `docs/architecture/workflows/payroll-lifecycle.md` §4) — stays PENDING.
    const pendingName = `E2E PSP Pending ${label}`;
    await makeEmployee(pendingName, '30000');

    await page.goto(`/payroll-cycles/${cycle.id}/reports/project-site-payroll`);
    await openSiteFilterAndSelect(page, site.site.name);

    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(5);

    async function statusFor(name: string): Promise<string> {
      const row = onScreenTable.locator('tr', { has: page.getByText(name, { exact: true }) });
      return (await row.locator('td').nth(16).innerText()).trim();
    }

    await expect(onScreenTable.getByText(heldName)).toBeVisible();
    expect(await statusFor(heldName)).toBe('Held');
    expect(await statusFor(noPayName)).toBe('No Pay Due');
    expect(await statusFor(recoveryName)).toBe('Recovery Due');
    expect(await statusFor(releasedName)).toBe('Released');
    expect(await statusFor(pendingName)).toBe('Pending');
  });
});

test.describe('Project Site Payroll Report — Corrections', () => {
  test('a correction-count badge appears; the original Net Salary is never replaced by a corrected figure; no correction reason ever appears', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const context = page.context();
    const label = `psp-corr-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);
    await releaseUnit(context, cycle.id, unitId);

    const releasedEntry = await getEntryForEmployee(context, cycle.id, employeeId);
    const preCorrectionRes = await apiGet<{ rows: { employeeId: string; netSalary: string }[] }>(
      context,
      `/api/v1/reports/project-site-payroll?cycleId=${cycle.id}&siteIds=${siteId}`,
    );
    const originalNetSalary = preCorrectionRes.body.rows.find((r) => r.employeeId === employeeId)!.netSalary;

    const adjustmentTypeId = await getAdjustmentTypeId(context);
    const correctionReason = `E2E PSP correction coverage ${label}`;
    const requestRes = await apiPost<{ correctionRequest: { id: string } }>(
      context,
      `/api/v1/payroll-entries/${releasedEntry.id}/correction-requests`,
      { field: 'ALLOWANCE', proposedNewValue: '5000', adjustmentTypeId, reason: correctionReason },
    );
    const reviewer = await reviewerSessionFor(browser, siteId);
    await apiPost(reviewer.page.context(), `/api/v1/correction-requests/${requestRes.correctionRequest.id}/approve`, {
      paymentTiming: 'IMMEDIATE',
    });
    await reviewer.close();

    await page.goto(`/payroll-cycles/${cycle.id}/reports/project-site-payroll`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);

    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(`E2E Employee ${label}`)).toBeVisible();

    // Original Net Salary unchanged — never replaced by a corrected figure. Formatted the same way
    // the UI's own money formatter renders it (en-US thousands grouping, `formatMoney`).
    const formattedOriginalNetSalary = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(originalNetSalary));
    const netSalaryCell = onScreenTable.locator('tr', { has: page.getByText(`E2E Employee ${label}`) }).locator('td').nth(15);
    await expect(netSalaryCell).toContainText(formattedOriginalNetSalary);

    // A correction-count badge of 1 appears; the reason text is never replayed on this report.
    const correctionsCell = onScreenTable.locator('tr', { has: page.getByText(`E2E Employee ${label}`) }).locator('td').nth(17);
    await expect(correctionsCell).toHaveText('1');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.includes(correctionReason)).toBe(false);
  });
});

test.describe('Project Site Payroll Report — Export', () => {
  test('CSV and XLSX download with safe headers only, complete filtered result', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `psp-export-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/project-site-payroll`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/project-site-payroll.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await (await import('node:fs/promises')).readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain('Net Salary');
    expect(csvContent).toContain(`E2E Employee ${label}`);
    expect(csvContent.toLowerCase()).not.toContain('cnic');
    expect(csvContent.toLowerCase()).not.toContain('account number');
    expect(csvContent.toLowerCase()).not.toContain('iban');
    expect(csvContent.toLowerCase()).not.toContain('bank');

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/project-site-payroll.*\.xlsx$/i);
  });
});

test.describe('Project Site Payroll Report — Print', () => {
  test('states current-page scope, opens Print Options with safe defaults and readability guidance, and invokes the browser print flow', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `psp-print-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/project-site-payroll`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print Options')).toBeVisible();
    await expect(dialog.getByText(/current page only/i)).toBeVisible();
    await expect(dialog.getByText('19 columns selected', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Very Wide')).toBeVisible();
    await expect(dialog.getByText(/many columns/i)).toBeVisible();
    await expect(dialog.getByText(/CNIC/i)).toHaveCount(0);
    await expect(dialog.getByText(/bank/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('Project Site Payroll Report — Permission', () => {
  test('a role holding reports:view can access; a role holding only statements:view cannot', async ({ browser }) => {
    const label = `psp-perm-${Date.now()}`;

    const noAccessEmail = `e2e-psp-no-access-${label}@example.test`;
    const noAccessPassword = 'E2EPspNoAccess1!';
    await createScopedUser({
      email: noAccessEmail,
      password: noAccessPassword,
      roleCode: 'TEST_E2E_PSP_STATEMENTS_ONLY',
      permissionKeys: ['statements:view'],
    });

    const noAccessContext = await browser.newContext();
    const noAccessPage = await noAccessContext.newPage();
    await login(noAccessPage, noAccessEmail, noAccessPassword);

    // No `reports:view` at all — the Reports catalogue itself is unreachable, and direct navigation
    // to the report is blocked with Access Denied, never a misleading empty report.
    await expect(noAccessPage.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await noAccessPage.goto('/reports/project-site-payroll');
    await expect(noAccessPage.getByText('You do not have permission to access this page.')).toBeVisible();
    await expect(noAccessPage.getByText(/no payroll entries/i)).toHaveCount(0);
    await noAccessContext.close();

    const accessEmail = `e2e-psp-access-${label}@example.test`;
    const accessPassword = 'E2EPspAccess1!';
    await createScopedUser({
      email: accessEmail,
      password: accessPassword,
      roleCode: 'TEST_E2E_PSP_REPORTS_VIEW',
      permissionKeys: ['reports:view'],
    });

    const accessContext = await browser.newContext();
    const accessPage = await accessContext.newPage();
    await login(accessPage, accessEmail, accessPassword);

    await accessPage.goto('/reports');
    await expect(accessPage.getByText('Project Site Payroll Report')).toBeVisible();
    await accessPage.getByRole('link', { name: /Project Site Payroll Report/ }).click();
    await expect(accessPage).toHaveURL(/\/reports\/project-site-payroll$|\/payroll-cycles\/.+\/reports\/project-site-payroll$/);
    await expect(accessPage.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await accessContext.close();
  });
});
