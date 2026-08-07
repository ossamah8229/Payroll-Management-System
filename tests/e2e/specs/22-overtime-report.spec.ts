import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Overtime Report Checkpoint 1B — real-browser verification of the frontend built over the
 * already-frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §18). No mocked
 * hooks, no `page.route` interception for any RBAC or financial assertion — real navigation, real
 * backend aggregation, real permission enforcement, matching this suite's own established discipline
 * (`17-reports.spec.ts`, `21-deduction-report.spec.ts`).
 *
 * This report's grain is `PayrollEntryWorkLine`, not `PayrollEntry` — the one behavior genuinely
 * unique to this report among its siblings. The "Multi-unit work-line grain" suite below is this
 * spec's own most important coverage: proving a real employee with two real work lines against the
 * real backend renders as two real table rows, each with its own Unit/OT Hours/Effective OT
 * Rate/OT Earnings, never merged.
 *
 * This suite runs sequentially against one shared, disposable database (`playwright.config.ts`'s
 * `workers: 1`) and one shared Draft `PayrollCycle` accumulating fixture entries from every earlier
 * spec file — every test below filters by its own freshly-created Site so it never has to reason
 * about, or be defeated by, unrelated rows already in that cycle.
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

/** Sets a full month of worked days and a fixed, deterministic overtime rate/hours on an entry's
 * primary work line — does not release. Mirrors `21-deduction-report.spec.ts`'s own `fillDays`,
 * extended with `otHours`/`otRate` so this report's own canonical fields are exercised. */
async function fillDaysAndOvertime(
  context: BrowserContext,
  entry: EntryRow,
  overrides: { otHours?: string; otRate?: string | null } = {},
): Promise<void> {
  await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
    version: entry.version,
    days: String(entry.workLines[0]!.cycleDays),
    ...(overrides.otHours !== undefined ? { otHours: overrides.otHours } : {}),
    ...(overrides.otRate !== undefined ? { otRate: overrides.otRate } : {}),
  });
}

async function releaseUnit(context: BrowserContext, cycleId: string, unitId: string): Promise<void> {
  await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`, {});
}

async function getAdjustmentTypeId(context: BrowserContext): Promise<string> {
  const res = await apiGet<{ adjustmentTypes: { id: string }[] }>(context, '/api/v1/adjustment-types');
  return res.body.adjustmentTypes[0]!.id;
}

async function reviewerSessionFor(browser: import('@playwright/test').Browser, siteId: string) {
  const email = `e2e-or-reviewer-${Date.now()}@example.test`;
  const password = 'OrReviewerPassword1!';
  await createScopedUser({
    email,
    password,
    roleCode: 'E2E_OR_REVIEWER',
    permissionKeys: ['corrections:approve'],
    siteIds: [siteId],
    name: 'E2E OR Reviewer',
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { page, close: () => context.close() };
}

async function openSiteFilterAndSelect(page: Page, siteName: string) {
  await page.locator('#or-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteName }).click();
  await page.keyboard.press('Escape');
}

async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

test.describe('Overtime Report — Master User', () => {
  test('navigation, Cycle selection, Site filter, totals, sorting, and pagination', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `or-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDaysAndOvertime(context, entry, { otHours: '6', otRate: '150' });

    // --- Navigation: Reports catalogue -> Overtime Report -------------------------------------
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Overtime Report')).toBeVisible();
    await page.getByRole('link', { name: /Overtime Report/ }).click();
    await expect(page).toHaveURL(/\/reports\/overtime-report$|\/payroll-cycles\/.+\/reports\/overtime-report$/);

    const cycleSelect = page.locator('#or-cycle');
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

    // --- Totals: backend-provided, grouped into Overtime / Coverage / Status -----------------
    await expect(page.getByTestId('or-stat-matching-count')).toHaveText(/1/);
    const onScreenCards = page.getByTestId('on-screen-cards');
    await expect(onScreenCards.getByText('Overtime', { exact: true })).toBeVisible();
    await expect(onScreenCards.getByText('Coverage')).toBeVisible();
    await expect(onScreenCards.getByText('Status', { exact: true })).toBeVisible();

    // --- Sorting: clicking a sortable header updates its own aria-sort -----------------------
    const otHoursHeader = page.getByRole('columnheader', { name: /^ot hours$/i });
    await otHoursHeader.getByRole('button').click();
    await expect(otHoursHeader).toHaveAttribute('aria-sort', 'ascending');
    await otHoursHeader.getByRole('button').click();
    await expect(otHoursHeader).toHaveAttribute('aria-sort', 'descending');

    // Effective OT Rate/OT Earnings/Gross Pay are not backend-approved sorts — no button at all.
    for (const name of [/^effective ot rate$/i, /^ot earnings$/i, /^gross pay$/i]) {
      const header = page.getByRole('columnheader', { name });
      await expect(header.getByRole('button')).toHaveCount(0);
    }

    // --- Pagination: server-provided metadata, Previous disabled on page 1 -------------------
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });
});

test.describe('Overtime Report — Site scoping and historical transfer', () => {
  test('a site-scoped user sees only accessible historical rows; a later transfer keeps the entry under its historical Site; the inaccessible Site is never offered as a filter; no cross-site leak', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `or-scope-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E OR Site A ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, {
      name: `E2E OR Unit A ${label}`,
    });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E OR Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E OR Unit B ${label}`,
    });

    const employeeName = `E2E OR Transferred ${label}`;
    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId: siteA.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });

    const siteBOnlyEmployee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E OR Site B Only ${label}`,
      designation: 'Guard',
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
      grossPay: '25000',
    });

    const entryA = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    await fillDaysAndOvertime(context, entryA, { otHours: '4', otRate: '120' });
    const entryBOnly = await getEntryForEmployee(context, cycle.id, siteBOnlyEmployee.employee.id);
    await fillDaysAndOvertime(context, entryBOnly, { otHours: '2', otRate: '100' });

    // Historical scoping: the employee is transferred to Site B *after* the entry was created —
    // the entry itself must remain visible under Site A only, matching Deduction Report's/Employee
    // Payroll History's own identical historical-siteId precedent.
    await apiPatch(context, `/api/v1/employees/${employee.employee.id}`, {
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
    });

    const scopedEmail = `e2e-or-site-a-${label}@example.test`;
    const scopedPassword = 'E2EOrSiteA1!';
    await createScopedUser({
      email: scopedEmail,
      password: scopedPassword,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['reports:view'],
      siteIds: [siteA.site.id],
      name: 'E2E Site A OR User',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, scopedEmail, scopedPassword);

    await scopedPage.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    const onScreenTable = scopedPage.getByTestId('on-screen-table');

    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    await expect(onScreenTable.getByText(siteA.site.name)).toBeVisible();

    await expect(onScreenTable.getByText(`E2E OR Site B Only ${label}`)).toHaveCount(0);
    await expect(onScreenTable.getByText(siteB.site.name)).toHaveCount(0);

    await scopedPage.locator('#or-site-filter').click();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteA.site.name })).toBeVisible();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteB.site.name })).toHaveCount(0);
    await scopedPage.keyboard.press('Escape');

    const rejected = await apiGet(scopedContext, `/api/v1/reports/overtime-report?cycleId=${cycle.id}&siteIds=${siteB.site.id}`);
    expect(rejected.status).toBe(403);

    await scopedContext.close();
  });
});

test.describe('Overtime Report — Unit filter and Has Overtime', () => {
  test('the Unit filter narrows within one Site, and Has Overtime distinguishes worked-OT rows from zero-OT rows', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `or-unit-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E OR Unit Site ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E OR Unit A ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E OR Unit B ${label}`,
    });

    const otEmployeeName = `E2E OR With Overtime ${label}`;
    const otEmployee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: otEmployeeName,
      designation: 'Guard',
      siteId: site.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });
    const otEntry = await getEntryForEmployee(context, cycle.id, otEmployee.employee.id);
    await fillDaysAndOvertime(context, otEntry, { otHours: '5', otRate: '150' });

    const noOtEmployeeName = `E2E OR No Overtime ${label}`;
    const noOtEmployee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: noOtEmployeeName,
      designation: 'Guard',
      siteId: site.site.id,
      unitId: unitB.unit.id,
      grossPay: '30000',
    });
    const noOtEntry = await getEntryForEmployee(context, cycle.id, noOtEmployee.employee.id);
    await fillDaysAndOvertime(context, noOtEntry, { otHours: '0' });

    await page.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    await openSiteFilterAndSelect(page, site.site.name);

    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(2);

    // Unit filter narrows to exactly Unit A's row.
    await page.locator('#or-unit-filter').selectOption({ label: unitA.unit.name });
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(otEmployeeName)).toBeVisible();
    await page.locator('#or-unit-filter').selectOption('');

    // Has Overtime = Yes -> exactly the OT-worked row; = No -> exactly the zero-OT row.
    await page.locator('#or-has-overtime').selectOption('YES');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(otEmployeeName)).toBeVisible();

    await page.locator('#or-has-overtime').selectOption('NO');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(noOtEmployeeName)).toBeVisible();

    await page.locator('#or-has-overtime').selectOption('ALL');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(2);
  });
});

test.describe('Overtime Report — Multi-unit work-line grain', () => {
  test('one employee with two work lines (two Units) renders as two distinct rows, each with its own correct Unit and independent OT Hours/Effective OT Rate/OT Earnings — never merged', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `or-multiunit-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E OR Multi Site ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E OR Multi Unit A ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E OR Multi Unit B ${label}`,
    });

    const employeeName = `E2E OR Multi Employee ${label}`;
    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId: site.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });

    const entry = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    // Primary work line (Unit A): 4 OT hours at an explicit 120/hr rate.
    await fillDaysAndOvertime(context, entry, { otHours: '4', otRate: '120' });

    // A second, genuinely independent work line (Unit B, same Site — the only cross-unit shape
    // this schema allows, Principle 7's concrete instance): 9 OT hours at a different, explicit
    // 200/hr rate. Re-fetch the entry first so `version` reflects the PATCH above.
    const refetchedEntry = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    await apiPost(context, `/api/v1/payroll-entries/${refetchedEntry.id}/work-lines`, {
      version: refetchedEntry.version,
      unitId: unitB.unit.id,
      days: String(refetchedEntry.workLines[0]!.cycleDays),
      otHours: '9',
      otRate: '200',
    });

    await page.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    await openSiteFilterAndSelect(page, site.site.name);

    const onScreenTable = page.getByTestId('on-screen-table');

    // Exactly two rows — one employee, two work lines, never merged into one.
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(2);
    await expect(onScreenTable.getByText(employeeName)).toHaveCount(2);

    const rowA = onScreenTable.locator('tr', { has: page.getByText(unitA.unit.name, { exact: true }) });
    const rowB = onScreenTable.locator('tr', { has: page.getByText(unitB.unit.name, { exact: true }) });

    // Each row shows its own correct Unit, and its own independent OT Hours / Effective OT Rate /
    // OT Earnings — genuinely different figures, never shared or averaged across the two rows.
    await expect(rowA.getByText('4', { exact: true })).toBeVisible();
    await expect(rowA.getByText('PKR 120.00', { exact: true })).toBeVisible();
    await expect(rowA.getByText('PKR 480.00', { exact: true })).toBeVisible(); // 4 x 120

    await expect(rowB.getByText('9', { exact: true })).toBeVisible();
    await expect(rowB.getByText('PKR 200.00', { exact: true })).toBeVisible();
    await expect(rowB.getByText('PKR 1,800.00', { exact: true })).toBeVisible(); // 9 x 200

    // The Totals block reflects both work lines (2 matching, 13 total OT hours), never one merged
    // employee-level figure.
    await expect(page.getByTestId('or-stat-matching-count')).toHaveText(/2/);
    await expect(page.getByTestId('or-stat-total-ot-hours')).toHaveText(/13/);
    // But the entry-level status count is still exactly 1 (the backend's own deduplicated count,
    // not double-counted for this one entry's 2 work lines).
    await expect(page.getByTestId('or-stat-pending')).toHaveText(/1/);
  });
});

test.describe('Overtime Report — Row statuses', () => {
  test('Released, Held, No Pay Due, Recovery Due, and Pending all render with the correct badge, and the Row Status filter narrows correctly', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `or-status-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E OR Status Site ${label}`,
    });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E OR Status Unit ${label}`,
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

    const heldName = `E2E OR Held ${label}`;
    const heldId = await makeEmployee(heldName, '30000');
    const heldEntry = await getEntryForEmployee(context, cycle.id, heldId);
    await apiPatch(context, `/api/v1/payroll-entries/${heldEntry.id}`, { version: heldEntry.version, hold: true });

    const noPayName = `E2E OR No Pay ${label}`;
    const noPayId = await makeEmployee(noPayName, '0', false);

    const recoveryName = `E2E OR Recovery ${label}`;
    const recoveryId = await makeEmployee(recoveryName, '30000');

    const releasedName = `E2E OR Released ${label}`;
    const releasedId = await makeEmployee(releasedName, '30000');
    const releasedEntry = await getEntryForEmployee(context, cycle.id, releasedId);
    await fillDaysAndOvertime(context, releasedEntry, { otHours: '2', otRate: '100' });

    await releaseUnit(context, cycle.id, unit.unit.id);

    const pendingName = `E2E OR Pending ${label}`;
    await makeEmployee(pendingName, '30000');

    await page.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    await openSiteFilterAndSelect(page, site.site.name);

    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(5);

    async function statusFor(name: string): Promise<string> {
      const row = onScreenTable.locator('tr', { has: page.getByText(name, { exact: true }) });
      return (await row.locator('td').nth(9).innerText()).trim();
    }

    expect(await statusFor(heldName)).toBe('Held');
    expect(await statusFor(noPayName)).toBe('No Pay Due');
    expect(await statusFor(recoveryName)).toBe('Recovery Due');
    expect(await statusFor(releasedName)).toBe('Released');
    expect(await statusFor(pendingName)).toBe('Pending');

    await page.locator('#or-row-status').selectOption('HELD');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(heldName)).toBeVisible();
  });
});

test.describe('Overtime Report — Corrections', () => {
  test('Has Correction shows Yes only on the corrected entry\'s row(s), the original OT figures are unaffected, and no correction reason ever appears', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const context = page.context();
    const label = `or-corr-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDaysAndOvertime(context, entry, { otHours: '3', otRate: '100' });
    await releaseUnit(context, cycle.id, unitId);

    const releasedEntry = await getEntryForEmployee(context, cycle.id, employeeId);
    const adjustmentTypeId = await getAdjustmentTypeId(context);
    const correctionReason = `E2E OR correction coverage ${label}`;
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

    await page.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);

    const onScreenTable = page.getByTestId('on-screen-table');
    const row = onScreenTable.locator('tr', { has: page.getByText(`E2E Employee ${label}`, { exact: true }) });

    // Original OT figures (3 hours @ 100/hr = 300 earnings) unaffected — never replayed by the
    // unrelated ALLOWANCE correction above.
    await expect(row.getByText('3', { exact: true })).toBeVisible();
    await expect(row.getByText('PKR 300.00', { exact: true })).toBeVisible();

    // Has Correction: Yes on this row.
    const hasCorrectionCell = row.locator('td').last();
    await expect(hasCorrectionCell).toHaveText('Yes');

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.includes(correctionReason)).toBe(false);
  });
});

test.describe('Overtime Report — Export', () => {
  test('CSV and XLSX download with the approved safe headers, multiple work-line rows retained, no sensitive fields', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `or-export-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E OR Export Site ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E OR Export Unit A ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E OR Export Unit B ${label}`,
    });

    const employeeName = `E2E OR Export Employee ${label}`;
    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId: site.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });
    const entry = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    await fillDaysAndOvertime(context, entry, { otHours: '3', otRate: '100' });
    const refetchedEntry = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    await apiPost(context, `/api/v1/payroll-entries/${refetchedEntry.id}/work-lines`, {
      version: refetchedEntry.version,
      unitId: unitB.unit.id,
      days: String(refetchedEntry.workLines[0]!.cycleDays),
      otHours: '5',
      otRate: '110',
    });

    await page.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    await openSiteFilterAndSelect(page, site.site.name);
    // Two work lines (Unit A, Unit B) for this one employee — two on-screen rows, matching the
    // frozen WorkLine grain.
    await expect(page.getByTestId('on-screen-table').locator('tbody tr')).toHaveCount(2);

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/overtime-report.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await (await import('node:fs/promises')).readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain('OT Hours');
    expect(csvContent).toContain('Effective OT Rate');
    expect(csvContent).toContain('OT Earnings');
    // Both work lines are present as two separate rows — the export mirrors the on-screen grain.
    const employeeOccurrences = csvContent.split(employeeName).length - 1;
    expect(employeeOccurrences).toBe(2);
    expect(csvContent.toLowerCase()).not.toContain('cnic');
    expect(csvContent.toLowerCase()).not.toContain('account number');
    expect(csvContent.toLowerCase()).not.toContain('iban');
    expect(csvContent.toLowerCase()).not.toContain('net salary');
    expect(csvContent.toLowerCase()).not.toContain('total earnings');

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/overtime-report.*\.xlsx$/i);
  });
});

test.describe('Overtime Report — Print', () => {
  test('states current-page scope, opens Print Options with safe defaults and readability guidance, invokes the browser print flow, and issues no backend request', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `or-print-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDaysAndOvertime(context, entry, { otHours: '2', otRate: '100' });
    await releaseUnit(context, cycle.id, unitId); // so the Row Status: Released filter below actually matches
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();
    await page.locator('#or-row-status').selectOption('RELEASED');
    await page.locator('#or-has-overtime').selectOption('YES');

    // No backend request is fired merely by opening/confirming Print — only by the initial list
    // load and the earlier filter changes above.
    let exportRequestFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/reports/overtime-report/export')) exportRequestFired = true;
    });

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print Options')).toBeVisible();
    await expect(dialog.getByText(/current page only/i)).toBeVisible();
    await expect(dialog.getByText('11 columns selected', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Very Wide')).toBeVisible();
    await expect(dialog.getByText(/many columns/i)).toBeVisible();
    await expect(dialog.getByText(/CNIC/i)).toHaveCount(0);
    await expect(dialog.getByText(/bank/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(exportRequestFired).toBe(false);

    // M2 — the actual printed content (invisible on-screen, `hidden print:block`) states the
    // report title, the selected Cycle, every applied filter summary — including Row Status and
    // Has Overtime just set above — a generated timestamp, and "current page only"; totals and the
    // selected columns render in the print-only table; no sensitive field (Net Salary, Total
    // Earnings, CNIC, banking, actor/reason) ever appears anywhere in the printed output.
    await page.emulateMedia({ media: 'print' });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Overtime Report');
    expect(bodyText).toMatch(/Row Status: Released/);
    expect(bodyText).toMatch(/Has Overtime: Yes/);
    expect(bodyText).toMatch(/Current page only/i);
    expect(bodyText).toMatch(/Generated /);

    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['Employee Name', 'Unit', 'OT Hours', 'OT Earnings', 'Row Status']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    const printCards = page.getByTestId('print-only-cards');
    await expect(printCards.getByText('Matching Work Lines')).toBeVisible();

    const lowerBodyText = bodyText.toLowerCase();
    for (const forbidden of ['net salary', 'total earnings', 'cnic', 'account number', 'iban', 'branch code']) {
      expect(lowerBodyText).not.toContain(forbidden);
    }
    await page.emulateMedia({ media: 'screen' });
  });
});

test.describe('Overtime Report — Responsive layout', () => {
  test('the filter row wraps cleanly at a ~1024px viewport with no horizontal document scroll, and Unit remains visible', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `or-responsive-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDaysAndOvertime(context, entry, { otHours: '1', otRate: '100' });

    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/payroll-cycles/${cycle.id}/reports/overtime-report`);
    await expect(page.getByTestId('on-screen-table')).toBeVisible();

    // The app shell's own root constrains the document to the viewport (AppShell's h-screen
    // overflow-hidden, `06-ui-regression.spec.ts`'s own established invariant) — only the inner
    // `<main>`/table region scrolls horizontally, never the document itself.
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await expect(page.locator('#or-cycle')).toBeVisible();
    await expect(page.locator('#or-site-filter')).toBeVisible();
    await expect(page.locator('#or-row-status')).toBeVisible();
    await expect(page.locator('#or-has-overtime')).toBeVisible();

    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const unitHeader = page.getByRole('columnheader', { name: /^unit$/i });
    await expect(unitHeader).toBeVisible();
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();
  });
});

test.describe('Overtime Report — Permission', () => {
  test('a role holding reports:view can access; a role holding only statements:view cannot', async ({ browser }) => {
    const label = `or-perm-${Date.now()}`;

    const noAccessEmail = `e2e-or-no-access-${label}@example.test`;
    const noAccessPassword = 'E2EOrNoAccess1!';
    await createScopedUser({
      email: noAccessEmail,
      password: noAccessPassword,
      roleCode: 'TEST_E2E_OR_STATEMENTS_ONLY',
      permissionKeys: ['statements:view'],
    });

    const noAccessContext = await browser.newContext();
    const noAccessPage = await noAccessContext.newPage();
    await login(noAccessPage, noAccessEmail, noAccessPassword);

    await expect(noAccessPage.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await noAccessPage.goto('/reports/overtime-report');
    await expect(noAccessPage.getByText('You do not have permission to access this page.')).toBeVisible();
    await expect(noAccessPage.getByText(/no payroll entries/i)).toHaveCount(0);
    await noAccessContext.close();

    const accessEmail = `e2e-or-access-${label}@example.test`;
    const accessPassword = 'E2EOrAccess1!';
    await createScopedUser({
      email: accessEmail,
      password: accessPassword,
      roleCode: 'TEST_E2E_OR_REPORTS_VIEW',
      permissionKeys: ['reports:view'],
    });

    const accessContext = await browser.newContext();
    const accessPage = await accessContext.newPage();
    await login(accessPage, accessEmail, accessPassword);

    await accessPage.goto('/reports');
    await expect(accessPage.getByText('Overtime Report')).toBeVisible();
    await accessPage.getByRole('link', { name: /Overtime Report/ }).click();
    await expect(accessPage).toHaveURL(/\/reports\/overtime-report$|\/payroll-cycles\/.+\/reports\/overtime-report$/);
    await expect(accessPage.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await accessContext.close();
  });
});
