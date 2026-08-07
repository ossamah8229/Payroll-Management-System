import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Deduction Report Checkpoint 1B — real-browser verification of the frontend built over the
 * already-frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §17). No mocked
 * hooks, no `page.route` interception for any RBAC or financial assertion — real navigation, real
 * backend aggregation, real permission enforcement, matching this suite's own established discipline
 * (`17-reports.spec.ts`, `20-project-site-payroll-report.spec.ts`).
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

/** Sets a full month of worked days (a real, positive net salary) on an entry's primary work line —
 * does not release. Mirrors `20-project-site-payroll-report.spec.ts`'s own identical helper. */
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

async function reviewerSessionFor(browser: import('@playwright/test').Browser, siteId: string) {
  const email = `e2e-dr-reviewer-${Date.now()}@example.test`;
  const password = 'DrReviewerPassword1!';
  await createScopedUser({
    email,
    password,
    roleCode: 'E2E_DR_REVIEWER',
    permissionKeys: ['corrections:approve'],
    siteIds: [siteId],
    name: 'E2E DR Reviewer',
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { page, close: () => context.close() };
}

async function openSiteFilterAndSelect(page: Page, siteName: string) {
  await page.locator('#dr-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteName }).click();
  await page.keyboard.press('Escape');
}

async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

test.describe('Deduction Report — Master User', () => {
  test('navigation, Cycle selection, Site filter, totals, sorting, and pagination', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `dr-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    // --- Navigation: Reports catalogue -> Deduction Report -----------------------------------
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Deduction Report')).toBeVisible();
    await page.getByRole('link', { name: /Deduction Report/ }).click();
    await expect(page).toHaveURL(/\/reports\/deduction-report$|\/payroll-cycles\/.+\/reports\/deduction-report$/);

    const cycleSelect = page.locator('#dr-cycle');
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

    // --- Totals: backend-provided, grouped into Payroll Deductions / Status ------------------
    await expect(page.getByTestId('dr-stat-matching-entries')).toHaveText(/1/);
    const onScreenCards = page.getByTestId('on-screen-cards');
    await expect(onScreenCards.getByText('Payroll Deductions')).toBeVisible();
    await expect(onScreenCards.getByText('Status', { exact: true })).toBeVisible();

    // --- Sorting: clicking a sortable header updates its own aria-sort -----------------------
    const fineHeader = page.getByRole('columnheader', { name: /^fine$/i });
    await fineHeader.getByRole('button').click();
    await expect(fineHeader).toHaveAttribute('aria-sort', 'ascending');
    await fineHeader.getByRole('button').click();
    await expect(fineHeader).toHaveAttribute('aria-sort', 'descending');

    // EOBI/Total Deductions/Correction Count are not backend-approved sorts — no button at all.
    const eobiHeader = page.getByRole('columnheader', { name: /^eobi$/i });
    await expect(eobiHeader.getByRole('button')).toHaveCount(0);
    const totalDeductionsHeader = page.getByRole('columnheader', { name: /^total deductions$/i });
    await expect(totalDeductionsHeader.getByRole('button')).toHaveCount(0);

    // --- Pagination: server-provided metadata, Previous disabled on page 1 -------------------
    await expect(page.getByText('Showing 1–1 of 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });
});

test.describe('Deduction Report — Filter and navigation state (M1)', () => {
  test('only the Payroll Cycle survives navigating away and back; Site, Unit, Row Status, deduction filters, and sort all reset to default — matching Project Site Payroll Report\'s own established architecture (no location.state/sessionStorage restoration exists for either report)', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `dr-nav-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();

    // Select a Unit (enabled only because exactly one Site is selected), several deduction
    // filters, a Row Status, and change the sort.
    await page.locator('#dr-unit-filter').selectOption({ label: `E2E Unit ${label}` });
    await page.locator('#dr-row-status').selectOption('PENDING');
    await page.locator('#dr-has-eobi').selectOption('YES');
    await page.locator('#dr-has-fine').selectOption('NO');
    const fineHeader = page.getByRole('columnheader', { name: /^fine$/i });
    await fineHeader.getByRole('button').click();
    await expect(fineHeader).toHaveAttribute('aria-sort', 'ascending');

    const filteredUrl = page.url();

    // Navigate away using normal app navigation (the Reports catalogue link), then return using
    // the browser Back button.
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await page.goBack();

    // The Payroll Cycle is restored automatically, because it alone is encoded in the URL — the
    // canonical URL itself is unchanged (filters were never part of it).
    await expect(page).toHaveURL(filteredUrl);
    await expect(page.locator('#dr-cycle')).toHaveValue(cycle.id);

    // Every other filter and the active sort reset to their defaults — a genuinely fresh mount,
    // matching this report's documented, intended architecture (§17.12,
    // `docs/architecture/workflows/reports.md`): no `location.state`/`sessionStorage` restoration
    // mechanism exists for this report, identical to Project Site Payroll Report's own precedent.
    await expect(page.locator('#dr-row-status')).toHaveValue('');
    await expect(page.locator('#dr-has-eobi')).toHaveValue('ALL');
    await expect(page.locator('#dr-has-fine')).toHaveValue('ALL');
    await expect(page.locator('#dr-unit-filter')).toBeDisabled();
    await expect(fineHeader).toHaveAttribute('aria-sort', 'none');
    const employeeNameHeader = page.getByRole('columnheader', { name: /^employee name$/i });
    await expect(employeeNameHeader).toHaveAttribute('aria-sort', 'ascending');

    // The Site filter itself also reset — this fixture's row is visible again without needing to
    // re-select its Site.
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();
  });
});

test.describe('Deduction Report — Site scoping', () => {
  test('a site-scoped user sees only accessible historical rows; a later transfer keeps the entry under its historical Site; the inaccessible Site is never offered as a filter; no cross-site leak', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `dr-scope-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E DR Site A ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, {
      name: `E2E DR Unit A ${label}`,
    });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E DR Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E DR Unit B ${label}`,
    });

    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E DR Transferred ${label}`,
      designation: 'Guard',
      siteId: siteA.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });
    const employeeName = `E2E DR Transferred ${label}`;

    const siteBOnlyEmployee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E DR Site B Only ${label}`,
      designation: 'Guard',
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
      grossPay: '25000',
    });

    const entryA = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    await fillDays(context, entryA);
    const entryBOnly = await getEntryForEmployee(context, cycle.id, siteBOnlyEmployee.employee.id);
    await fillDays(context, entryBOnly);

    await apiPatch(context, `/api/v1/employees/${employee.employee.id}`, {
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
    });

    const scopedEmail = `e2e-dr-site-a-${label}@example.test`;
    const scopedPassword = 'E2EDrSiteA1!';
    await createScopedUser({
      email: scopedEmail,
      password: scopedPassword,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['reports:view'],
      siteIds: [siteA.site.id],
      name: 'E2E Site A DR User',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, scopedEmail, scopedPassword);

    await scopedPage.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    const onScreenTable = scopedPage.getByTestId('on-screen-table');

    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    await expect(onScreenTable.getByText(siteA.site.name)).toBeVisible();

    await expect(onScreenTable.getByText(`E2E DR Site B Only ${label}`)).toHaveCount(0);
    await expect(onScreenTable.getByText(siteB.site.name)).toHaveCount(0);

    await scopedPage.locator('#dr-site-filter').click();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteA.site.name })).toBeVisible();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteB.site.name })).toHaveCount(0);
    await scopedPage.keyboard.press('Escape');

    const rejected = await apiGet(scopedContext, `/api/v1/reports/deduction-report?cycleId=${cycle.id}&siteIds=${siteB.site.id}`);
    expect(rejected.status).toBe(403);

    await scopedContext.close();
  });
});

test.describe('Deduction Report — Deduction filters', () => {
  test('each of the five tri-state deduction filters narrows correctly, individually and in AND-composition', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `dr-ded-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E DR Deduction Site ${label}`,
    });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E DR Deduction Unit ${label}`,
    });

    async function makeEmployee(name: string, defaultEobiApplicable: boolean) {
      const res = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
        name,
        designation: 'Guard',
        siteId: site.site.id,
        unitId: unit.unit.id,
        grossPay: '30000',
        defaultEobiApplicable,
      });
      return res.employee.id;
    }

    const eobiName = `E2E DR EOBI Only ${label}`;
    const eobiId = await makeEmployee(eobiName, true);

    const fineName = `E2E DR Fine Only ${label}`;
    const fineId = await makeEmployee(fineName, false);
    const fineEntry = await getEntryForEmployee(context, cycle.id, fineId);
    await apiPatch(context, `/api/v1/payroll-entries/${fineEntry.id}`, { version: fineEntry.version, fine: '500' });

    const advanceName = `E2E DR Advance Only ${label}`;
    const advanceId = await makeEmployee(advanceName, false);
    const advanceEntry = await getEntryForEmployee(context, cycle.id, advanceId);
    await apiPatch(context, `/api/v1/payroll-entries/${advanceEntry.id}`, { version: advanceEntry.version, advanceDeduction: '300' });

    const eidName = `E2E DR EID Only ${label}`;
    const eidId = await makeEmployee(eidName, false);
    const eidEntry = await getEntryForEmployee(context, cycle.id, eidId);
    await apiPatch(context, `/api/v1/payroll-entries/${eidEntry.id}`, { version: eidEntry.version, eidAdvanceDeduction: '200' });

    const noneName = `E2E DR No Deductions ${label}`;
    await makeEmployee(noneName, false);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    await openSiteFilterAndSelect(page, site.site.name);

    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(5);

    // Has EOBI = Yes -> exactly the EOBI-applicable employee.
    await page.locator('#dr-has-eobi').selectOption('YES');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(eobiName)).toBeVisible();
    await page.locator('#dr-has-eobi').selectOption('ALL');

    // Has Fine = Yes -> exactly the fine-only employee.
    await page.locator('#dr-has-fine').selectOption('YES');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(fineName)).toBeVisible();
    await page.locator('#dr-has-fine').selectOption('ALL');

    // Has Advance Deduction = Yes -> exactly the advance-only employee.
    await page.locator('#dr-has-advance-deduction').selectOption('YES');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(advanceName)).toBeVisible();
    await page.locator('#dr-has-advance-deduction').selectOption('ALL');

    // Has EID Advance Deduction = Yes -> exactly the EID-only employee.
    await page.locator('#dr-has-eid-advance-deduction').selectOption('YES');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(eidName)).toBeVisible();
    await page.locator('#dr-has-eid-advance-deduction').selectOption('ALL');

    // Has Correction Recovery = Yes -> none of this fixture's rows have one; = No -> all remain.
    await page.locator('#dr-has-correction-recovery').selectOption('YES');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(0);
    await page.locator('#dr-has-correction-recovery').selectOption('NO');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(5);
    await page.locator('#dr-has-correction-recovery').selectOption('ALL');

    // AND-composition: Has Fine = Yes AND Has EOBI = No -> exactly the fine-only employee (its
    // own eobiApplicable is false), never the EOBI-only employee.
    await page.locator('#dr-has-fine').selectOption('YES');
    await page.locator('#dr-has-eobi').selectOption('NO');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(fineName)).toBeVisible();
    await expect(onScreenTable.getByText(eobiName)).toHaveCount(0);
  });
});

test.describe('Deduction Report — Row statuses', () => {
  test('Released, Held, No Pay Due, Recovery Due, and Pending all render with the correct badge', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `dr-status-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E DR Status Site ${label}`,
    });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E DR Status Unit ${label}`,
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

    const heldName = `E2E DR Held ${label}`;
    const heldId = await makeEmployee(heldName, '30000');
    const heldEntry = await getEntryForEmployee(context, cycle.id, heldId);
    await apiPatch(context, `/api/v1/payroll-entries/${heldEntry.id}`, { version: heldEntry.version, hold: true });

    const noPayName = `E2E DR No Pay ${label}`;
    const noPayId = await makeEmployee(noPayName, '0', false);

    const recoveryName = `E2E DR Recovery ${label}`;
    const recoveryId = await makeEmployee(recoveryName, '30000');

    const releasedName = `E2E DR Released ${label}`;
    const releasedId = await makeEmployee(releasedName, '30000');
    const releasedEntry = await getEntryForEmployee(context, cycle.id, releasedId);
    await fillDays(context, releasedEntry);

    await releaseUnit(context, cycle.id, unit.unit.id);

    const pendingName = `E2E DR Pending ${label}`;
    await makeEmployee(pendingName, '30000');

    await page.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    await openSiteFilterAndSelect(page, site.site.name);

    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(5);

    async function statusFor(name: string): Promise<string> {
      const row = onScreenTable.locator('tr', { has: page.getByText(name, { exact: true }) });
      return (await row.locator('td').nth(12).innerText()).trim();
    }

    expect(await statusFor(heldName)).toBe('Held');
    expect(await statusFor(noPayName)).toBe('No Pay Due');
    expect(await statusFor(recoveryName)).toBe('Recovery Due');
    expect(await statusFor(releasedName)).toBe('Released');
    expect(await statusFor(pendingName)).toBe('Pending');

    // Row Status filter narrows to the same value shown in the table.
    await page.locator('#dr-row-status').selectOption('HELD');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(heldName)).toBeVisible();
  });
});

test.describe('Deduction Report — Corrections', () => {
  test('a correction-count column shows the count; deduction figures on the original row are never replaced; no correction reason ever appears', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const context = page.context();
    const label = `dr-corr-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);
    await releaseUnit(context, cycle.id, unitId);

    const releasedEntry = await getEntryForEmployee(context, cycle.id, employeeId);
    const preCorrectionRes = await apiGet<{ rows: { employeeId: string; eobi: string; totalDeductions: string }[] }>(
      context,
      `/api/v1/reports/deduction-report?cycleId=${cycle.id}&siteIds=${siteId}`,
    );
    const originalRow = preCorrectionRes.body.rows.find((r) => r.employeeId === employeeId)!;

    const adjustmentTypeId = await getAdjustmentTypeId(context);
    const correctionReason = `E2E DR correction coverage ${label}`;
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

    await page.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);

    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(`E2E Employee ${label}`)).toBeVisible();

    const formattedOriginalTotalDeductions = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(originalRow.totalDeductions));
    const totalDeductionsCell = onScreenTable
      .locator('tr', { has: page.getByText(`E2E Employee ${label}`) })
      .locator('td')
      .nth(10);
    await expect(totalDeductionsCell).toContainText(formattedOriginalTotalDeductions);

    const correctionsCell = onScreenTable
      .locator('tr', { has: page.getByText(`E2E Employee ${label}`) })
      .locator('td')
      .nth(11);
    await expect(correctionsCell).toHaveText('1');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.includes(correctionReason)).toBe(false);
  });
});

test.describe('Deduction Report — Export', () => {
  test('CSV and XLSX download with safe headers only, complete filtered result', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `dr-export-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/deduction-report.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await (await import('node:fs/promises')).readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain('Fine');
    expect(csvContent).toContain(`E2E Employee ${label}`);
    expect(csvContent.toLowerCase()).not.toContain('cnic');
    expect(csvContent.toLowerCase()).not.toContain('account number');
    expect(csvContent.toLowerCase()).not.toContain('iban');
    expect(csvContent.toLowerCase()).not.toContain('bank');
    expect(csvContent.toLowerCase()).not.toContain('gross pay');
    expect(csvContent.toLowerCase()).not.toContain('net salary');

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/deduction-report.*\.xlsx$/i);
  });
});

test.describe('Deduction Report — Print', () => {
  test('states current-page scope, opens Print Options with safe defaults and readability guidance, and invokes the browser print flow', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `dr-print-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);
    await releaseUnit(context, cycle.id, unitId); // so the Row Status: Released filter below actually matches
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();
    await page.locator('#dr-row-status').selectOption('RELEASED');
    await page.locator('#dr-has-eobi').selectOption('YES');

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print Options')).toBeVisible();
    await expect(dialog.getByText(/current page only/i)).toBeVisible();
    await expect(dialog.getByText('14 columns selected', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Very Wide')).toBeVisible();
    await expect(dialog.getByText(/many columns/i)).toBeVisible();
    await expect(dialog.getByText(/CNIC/i)).toHaveCount(0);
    await expect(dialog.getByText(/bank/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // M2 — the actual printed content (invisible on-screen, `hidden print:block`) states the
    // report title, the selected Cycle, every applied filter summary — including Row Status and
    // the Has EOBI deduction filter just set above — a generated timestamp, and "current page
    // only"; totals and the selected columns render in the print-only table; no sensitive field
    // (Gross Pay, Net Salary, Correction Balance Payable, CNIC, banking, actor/reason) ever
    // appears anywhere in the printed output.
    await page.emulateMedia({ media: 'print' });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Deduction Report');
    expect(bodyText).toMatch(/Row Status: Released/);
    expect(bodyText).toMatch(/Has EOBI: Yes/);
    expect(bodyText).toMatch(/Current page only/i);
    expect(bodyText).toMatch(/Generated /);

    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['Employee Name', 'EOBI', 'Fine', 'Row Status']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    const printCards = page.getByTestId('print-only-cards');
    await expect(printCards.getByText('Matching Entries')).toBeVisible();

    const lowerBodyText = bodyText.toLowerCase();
    for (const forbidden of ['gross pay', 'net salary', 'correction balance payable', 'cnic', 'account number', 'iban', 'branch code']) {
      expect(lowerBodyText).not.toContain(forbidden);
    }
    await page.emulateMedia({ media: 'screen' });
  });
});

test.describe('Deduction Report — Responsive layout', () => {
  test('the filter row wraps cleanly at a narrower viewport with no horizontal document scroll', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `dr-responsive-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/payroll-cycles/${cycle.id}/reports/deduction-report`);
    await expect(page.getByTestId('on-screen-table')).toBeVisible();

    // The app shell's own root constrains the document to the viewport (AppShell's h-screen
    // overflow-hidden, `06-ui-regression.spec.ts`'s own established invariant) — only the inner
    // `<main>`/table region scrolls horizontally, never the document itself.
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Every filter field remains individually visible and usable — none is clipped off-screen by
    // the narrower viewport, it wraps onto additional rows instead.
    await expect(page.locator('#dr-cycle')).toBeVisible();
    await expect(page.locator('#dr-site-filter')).toBeVisible();
    await expect(page.locator('#dr-has-eobi')).toBeVisible();
    await expect(page.locator('#dr-has-correction-recovery')).toBeVisible();
  });
});

test.describe('Deduction Report — Permission', () => {
  test('a role holding reports:view can access; a role holding only statements:view cannot', async ({ browser }) => {
    const label = `dr-perm-${Date.now()}`;

    const noAccessEmail = `e2e-dr-no-access-${label}@example.test`;
    const noAccessPassword = 'E2EDrNoAccess1!';
    await createScopedUser({
      email: noAccessEmail,
      password: noAccessPassword,
      roleCode: 'TEST_E2E_DR_STATEMENTS_ONLY',
      permissionKeys: ['statements:view'],
    });

    const noAccessContext = await browser.newContext();
    const noAccessPage = await noAccessContext.newPage();
    await login(noAccessPage, noAccessEmail, noAccessPassword);

    await expect(noAccessPage.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await noAccessPage.goto('/reports/deduction-report');
    await expect(noAccessPage.getByText('You do not have permission to access this page.')).toBeVisible();
    await expect(noAccessPage.getByText(/no payroll entries/i)).toHaveCount(0);
    await noAccessContext.close();

    const accessEmail = `e2e-dr-access-${label}@example.test`;
    const accessPassword = 'E2EDrAccess1!';
    await createScopedUser({
      email: accessEmail,
      password: accessPassword,
      roleCode: 'TEST_E2E_DR_REPORTS_VIEW',
      permissionKeys: ['reports:view'],
    });

    const accessContext = await browser.newContext();
    const accessPage = await accessContext.newPage();
    await login(accessPage, accessEmail, accessPassword);

    await accessPage.goto('/reports');
    await expect(accessPage.getByText('Deduction Report')).toBeVisible();
    await accessPage.getByRole('link', { name: /Deduction Report/ }).click();
    await expect(accessPage).toHaveURL(/\/reports\/deduction-report$|\/payroll-cycles\/.+\/reports\/deduction-report$/);
    await expect(accessPage.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await accessContext.close();
  });
});
