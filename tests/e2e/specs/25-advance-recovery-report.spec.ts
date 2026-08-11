import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Advance Recovery Report Checkpoint 1B — real-browser verification of the frontend built over the
 * already-frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §19). No mocked
 * hooks, no `page.route` interception for any RBAC or financial assertion — real navigation, real
 * backend aggregation, real permission enforcement, matching this suite's own established discipline
 * (`17-reports.spec.ts`, `21-deduction-report.spec.ts`).
 *
 * This suite runs sequentially against one shared, disposable database (`playwright.config.ts`'s
 * `workers: 1`) and one shared Draft `PayrollCycle` accumulating fixture entries from every earlier
 * spec file — every test below filters by its own freshly-created Site so it never has to reason
 * about, or be defeated by, unrelated rows already in that cycle.
 *
 * **Fixture mechanics this file relies on** (`advances.service.ts`): creating an Advance whose
 * `originalPeriod` is the current Draft cycle *immediately* materializes a deduction onto that
 * employee's own Draft `PayrollEntry` in the same request — no separate release step is required to
 * produce a real recovery event. `FULL_DEDUCTION` always deducts the entire outstanding balance in
 * one step (reaching `RESERVED`); `INSTALLMENT` deducts `min(scheduledInstallmentAmount,
 * outstandingBalance)` only if a `scheduledInstallmentAmount` was given, leaving a genuine residual
 * balance and an `ACTIVE` status when it doesn't fully cover — exactly the fixture shape most of
 * these tests need (a real Recovered This Cycle figure *and* a real remaining Current Outstanding
 * Balance, without releasing anything).
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

interface AdvanceRow {
  id: string;
  outstandingBalance: string;
  status: string;
}

async function createLoanInstallment(
  context: BrowserContext,
  employeeId: string,
  cycle: CycleRow,
  totalAmount: string,
  scheduledInstallmentAmount: string,
): Promise<AdvanceRow> {
  const res = await apiPost<{ advance: AdvanceRow }>(context, '/api/v1/advances', {
    employeeId,
    type: 'LOAN',
    totalAmount,
    dateGiven: `${cycle.year}-${String(cycle.month).padStart(2, '0')}-10`,
    repaymentType: 'INSTALLMENT',
    scheduledInstallmentAmount,
    originalPeriod: { year: cycle.year, month: cycle.month },
  });
  return res.advance;
}

async function createEidFullDeduction(
  context: BrowserContext,
  employeeId: string,
  cycle: CycleRow,
  totalAmount: string,
): Promise<AdvanceRow> {
  const res = await apiPost<{ advance: AdvanceRow }>(context, '/api/v1/advances', {
    employeeId,
    type: 'EID_ADVANCE',
    totalAmount,
    dateGiven: `${cycle.year}-${String(cycle.month).padStart(2, '0')}-10`,
    repaymentType: 'FULL_DEDUCTION',
    originalPeriod: { year: cycle.year, month: cycle.month },
  });
  return res.advance;
}

async function openSiteFilterAndSelect(page: Page, siteName: string) {
  await page.locator('#arr-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteName }).click();
  await page.keyboard.press('Escape');
}

/** Drives the real `AdvanceRecoveryReportEmployeeLookup` combobox. */
async function pickEmployeeInLookup(page: Page, employeeName: string) {
  const input = page.locator('#arr-employee');
  await input.fill(employeeName);
  const option = page.getByRole('option', { name: new RegExp(employeeName) });
  await expect(option.first()).toBeVisible({ timeout: 5000 });
  await option.first().click();
}

async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

test.describe('Advance Recovery Report — Master User', () => {
  test('navigation, optional-Cycle roster, Cycle selection reveals Recovered This Cycle without changing current balance, LOAN + EID_ADVANCE rows, sorting, pagination', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `arr-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, employeeId } = await createSiteWithEmployee(context, label);
    const employeeName = `E2E Employee ${label}`;

    // Advance A: a real, unreleased recovery event this cycle (1000 of 5000), leaving a genuine
    // residual outstanding balance (4000) — no release step required.
    await createLoanInstallment(context, employeeId, cycle, '5000', '1000');
    // Advance B: a second Advance for the same employee, a different type (EID_ADVANCE),
    // fully covered in this cycle (FULL_DEDUCTION) — proves one row per Advance, not per employee.
    await createEidFullDeduction(context, employeeId, cycle, '2000');

    // --- Navigation: Reports catalogue -> Advance Recovery Report --------------------------
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Advance Recovery Report')).toBeVisible();
    await page.getByRole('link', { name: /Advance Recovery Report/ }).click();
    await expect(page).toHaveURL(/\/reports\/advance-recovery$/);

    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const onScreenTable = page.getByTestId('on-screen-table');

    // --- One row per Advance: LOAN + EID_ADVANCE for the same employee -> two rows --------
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(2);
    await expect(onScreenTable.getByText('Advance', { exact: true })).toBeVisible();
    await expect(onScreenTable.getByText('Eid Advance', { exact: true })).toBeVisible();

    // --- No Cycle selected: Recovered This Cycle is "Not selected," never a fabricated 0.00 -
    await expect(onScreenTable.getByText('Not selected').first()).toBeVisible();
    const loanRowNoCycle = onScreenTable.locator('tr', { has: page.getByText('Advance', { exact: true }) });
    await expect(loanRowNoCycle.locator('td').nth(6)).toContainText('4,000.00'); // Current Outstanding Balance

    // --- Selecting the Cycle reveals Recovered This Cycle; current balance is unchanged ----
    await page.locator('#arr-cycle').selectOption(cycle.id);
    await expect(loanRowNoCycle.locator('td').nth(10)).toContainText('1,000.00'); // Recovered This Cycle
    await expect(loanRowNoCycle.locator('td').nth(6)).toContainText('4,000.00'); // still current/live
    await expect(page.getByTestId('arr-stat-recovered-this-cycle-total')).toBeVisible();

    // --- The current-vs-historical disclosure note is visible, not just a tooltip ----------
    await expect(page.getByTestId('arr-current-vs-historical-note')).toBeVisible();

    // --- Sorting: clicking a sortable header updates its own aria-sort ---------------------
    const originalAmountHeader = page.getByRole('columnheader', { name: /^original amount$/i });
    await originalAmountHeader.getByRole('button').click();
    await expect(originalAmountHeader).toHaveAttribute('aria-sort', 'ascending');
    await originalAmountHeader.getByRole('button').click();
    await expect(originalAmountHeader).toHaveAttribute('aria-sort', 'descending');

    // Recovered This Cycle is not a backend-approved sort — no button at all.
    const recoveredThisCycleHeader = page.getByRole('columnheader', { name: /^recovered this cycle$/i });
    await expect(recoveredThisCycleHeader.getByRole('button')).toHaveCount(0);

    // --- Pagination: server-provided metadata, Previous disabled on page 1 -----------------
    await expect(page.getByText('Showing 1–2 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

    void siteId; // referenced for readability of the fixture only
  });
});

test.describe('Advance Recovery Report — Site and Employee filters', () => {
  test('the Site multi-select and the current-site Employee lookup each narrow the roster independently', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `arr-filters-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const a = await createSiteWithEmployee(context, `${label}-a`);
    const b = await createSiteWithEmployee(context, `${label}-b`);
    await createLoanInstallment(context, a.employeeId, cycle, '3000', '1000');
    await createLoanInstallment(context, b.employeeId, cycle, '3000', '1000');

    await page.goto('/reports/advance-recovery');
    const onScreenTable = page.getByTestId('on-screen-table');

    // Narrow to Site A only via the Site multi-select.
    await openSiteFilterAndSelect(page, `E2E Site ${label}-a`);
    await expect(onScreenTable.getByText(`E2E Employee ${label}-a`)).toBeVisible();
    await expect(onScreenTable.getByText(`E2E Employee ${label}-b`)).toHaveCount(0);

    // Clear Filters restores the roster, but the Employee lookup then narrows independently.
    await page.getByRole('button', { name: /clear filters/i }).click();
    await expect(onScreenTable.getByText(`E2E Employee ${label}-b`)).toBeVisible();
    await pickEmployeeInLookup(page, `E2E Employee ${label}-b`);
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText(`E2E Employee ${label}-b`)).toBeVisible();
    await expect(onScreenTable.getByText(`E2E Employee ${label}-a`)).toHaveCount(0);

    // Attack: with Employee B still selected (no Site filter active), narrow the Site filter to
    // Site A only — Employee B is now outside the visible Site scope. The Employee filter must not
    // silently remain pointed at an employee now outside scope as a hidden, incompatible filter; the
    // lookup must collapse back to its own empty search box, and the roster must reflect Site A only.
    await openSiteFilterAndSelect(page, `E2E Site ${label}-a`);
    await expect(page.locator('#arr-employee')).toBeVisible();
    await expect(page.locator('#arr-employee')).toHaveValue('');
    await expect(onScreenTable.getByText(`E2E Employee ${label}-a`)).toBeVisible();
    await expect(onScreenTable.getByText(`E2E Employee ${label}-b`)).toHaveCount(0);
  });
});

test.describe('Advance Recovery Report — Has Outstanding Balance', () => {
  test('the tri-state filter narrows to exactly the Advances with (Yes) / without (No) a remaining balance', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `arr-balance-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, employeeId } = await createSiteWithEmployee(context, label);

    // Fully covered in one step (FULL_DEDUCTION) -> outstandingBalance = 0.
    await createEidFullDeduction(context, employeeId, cycle, '1500');
    // A genuine residual balance remains (INSTALLMENT, partial).
    await createLoanInstallment(context, employeeId, cycle, '4000', '1000');

    await page.goto('/reports/advance-recovery');
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(2);

    await page.locator('#arr-has-outstanding-balance').selectOption('YES');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText('Advance', { exact: true })).toBeVisible();

    await page.locator('#arr-has-outstanding-balance').selectOption('NO');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);
    await expect(onScreenTable.getByText('Eid Advance', { exact: true })).toBeVisible();

    await page.locator('#arr-has-outstanding-balance').selectOption('ALL');
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(2);

    void siteId;
  });
});

test.describe('Advance Recovery Report — Site scoping and transferred employees', () => {
  test('current Site controls visibility; a Site-A-only user loses access after a transfer to Site B; Recovery History retains the original historical Site', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `arr-transfer-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E ARR Site A ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, {
      name: `E2E ARR Unit A ${label}`,
    });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E ARR Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E ARR Unit B ${label}`,
    });

    const employeeName = `E2E ARR Transferred ${label}`;
    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId: siteA.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });

    // A real recovery event materializes onto the employee's Draft PayrollEntry while they still
    // belong to Site A — that entry's own siteId is frozen at Site A regardless of any later
    // transfer (docs/architecture/workflows/reports.md §19.1's disclosed V1 limitation: Advance
    // visibility itself follows the CURRENT site, but each recovery event's own site is historical).
    const advance = await createLoanInstallment(context, employee.employee.id, cycle, '5000', '1000');

    // Transfer the employee to Site B — current Employee.siteId is now B.
    await apiPatch(context, `/api/v1/employees/${employee.employee.id}`, {
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
    });

    const scopedEmail = `e2e-arr-site-a-${label}@example.test`;
    const scopedPassword = 'E2EArrSiteA1!';
    await createScopedUser({
      email: scopedEmail,
      password: scopedPassword,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['reports:view'],
      siteIds: [siteA.site.id],
      name: 'E2E Site A ARR User',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, scopedEmail, scopedPassword);

    // The Site-A-only user no longer sees this Advance at all — visibility follows the employee's
    // CURRENT site (now B), not the historical site the recovery event actually happened at.
    await scopedPage.goto('/reports/advance-recovery');
    await expect(scopedPage.getByTestId('on-screen-table').getByText(employeeName)).toHaveCount(0);

    const rejected = await apiGet(scopedContext, `/api/v1/reports/advance-recovery?siteIds=${siteB.site.id}`);
    expect(rejected.status).toBe(403);

    // Direct detail navigation to this now-out-of-scope Advance: the backend itself returns 403 (it
    // exists, just outside this user's Site access) rather than 404, but the frontend deliberately
    // conceals that distinction — a genuinely nonexistent id and this exists-but-inaccessible id must
    // render byte-identical copy, never confirming the Advance's existence via a "no access" message.
    await scopedPage.goto(`/reports/advance-recovery/${advance.id}`);
    await expect(scopedPage.getByText(/could not be found/i)).toBeVisible();
    await expect(scopedPage.getByText(/you do not have access/i)).toHaveCount(0);
    await expect(scopedPage.getByText(/outside your current site access/i)).toHaveCount(0);
    await scopedContext.close();

    // As the unrestricted admin, the detail page shows the CURRENT Site (B) in the summary, but
    // the Recovery History event's own Site remains the original, historical one (A) — the two
    // must never be conflated.
    await adminPage.goto(`/reports/advance-recovery/${advance.id}`);
    await expect(adminPage.getByText(employeeName)).toBeVisible();
    await expect(adminPage.getByText(siteB.site.name, { exact: true }).first()).toBeVisible();
    const recoverySection = adminPage.getByText('Recovery History').locator('..').locator('..');
    await expect(recoverySection.getByText(siteA.site.name, { exact: true })).toBeVisible();
  });
});

test.describe('Advance Recovery Report — Browser Back/Forward across Cycle selection', () => {
  test('browser history moves cleanly between no-Cycle and a selected Cycle, URL and the Cycle selector staying in sync, no full page reload', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    // Only one PayrollCycle is ever in Draft state system-wide (`POST /payroll-cycles` 409s
    // otherwise) — reuse the current Draft as Cycle A rather than trying to mint a second one.
    // A second, genuinely distinct Cycle (any status) is used as Cycle B only if one already exists
    // in this shared DB from an earlier spec file in the same run; this test still fully proves the
    // no-Cycle <-> Cycle A back/forward mechanics on its own when run standalone.
    const cycleA = await getCurrentDraftCycle(context);
    const existing = await apiGet<{ cycles: CycleRow[] }>(context, '/api/v1/payroll-cycles');
    const cycleB = existing.body.cycles.find((c) => c.id !== cycleA.id);

    await page.goto('/reports/advance-recovery');
    await expect(page).toHaveURL(/\/reports\/advance-recovery$/);
    await expect(page.locator('#arr-cycle')).toHaveValue('');

    await page.locator('#arr-cycle').selectOption(cycleA.id);
    await expect(page).toHaveURL(new RegExp(`/payroll-cycles/${cycleA.id}/reports/advance-recovery$`));

    if (cycleB) {
      await page.locator('#arr-cycle').selectOption(cycleB.id);
      await expect(page).toHaveURL(new RegExp(`/payroll-cycles/${cycleB.id}/reports/advance-recovery$`));

      // Back: Cycle B -> Cycle A. Same SPA instance throughout (no full reload) — proven by the app
      // never touching `window.location` for any Cycle-selector transition.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/payroll-cycles/${cycleA.id}/reports/advance-recovery$`));
      await expect(page.locator('#arr-cycle')).toHaveValue(cycleA.id);
    }

    // Back: Cycle A -> no Cycle.
    await page.goBack();
    await expect(page).toHaveURL(/\/reports\/advance-recovery$/);
    await expect(page.locator('#arr-cycle')).toHaveValue('');

    // Forward: no Cycle -> Cycle A again.
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/payroll-cycles/${cycleA.id}/reports/advance-recovery$`));
    await expect(page.locator('#arr-cycle')).toHaveValue(cycleA.id);
  });
});

test.describe('Advance Recovery Report — Detail page', () => {
  test('Advance Summary, Recovery History, and a separate Schedule / Deferral History via a real defer', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `arr-detail-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, employeeId } = await createSiteWithEmployee(context, label);
    const employeeName = `E2E Employee ${label}`;

    const advance = await createLoanInstallment(context, employeeId, cycle, '5000', '1000');
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);

    // Defer the just-materialized deduction to next calendar month — a real Schedule/Deferral
    // event, never itself a recovery.
    const nextYear = cycle.month === 12 ? cycle.year + 1 : cycle.year;
    const nextMonth = cycle.month === 12 ? 1 : cycle.month + 1;
    const deferReason = `E2E ARR deferral coverage ${label}`;
    await apiPost(context, `/api/v1/advances/${advance.id}/defer`, {
      payrollEntryId: entry.id,
      toPeriod: { year: nextYear, month: nextMonth },
      reason: deferReason,
    });

    await page.goto('/reports/advance-recovery');
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await page.getByRole('button', { name: new RegExp(`view details for ${employeeName}`, 'i') }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/advance-recovery/${advance.id}$`));

    // --- Advance Summary: current, live figures, clearly labeled ---------------------------
    await expect(page.getByText(employeeName)).toBeVisible();
    await expect(page.getByText(/current, live figures/i)).toBeVisible();
    await expect(page.getByText('Advance', { exact: true }).first()).toBeVisible();

    // --- Schedule / Deferral History: a distinct section from Recovery History -------------
    await expect(page.getByRole('heading', { name: 'Recovery History' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Schedule / Deferral History' })).toBeVisible();
    await expect(page.getByText(deferReason)).toBeVisible();

    // --- Back preserves the list's own filter/sort/page selection --------------------------
    await page.getByText('Back to Report').click();
    await expect(page).toHaveURL(/\/reports\/advance-recovery$/);
    await expect(page.getByTestId('on-screen-table').getByText(employeeName)).toBeVisible();

    void siteId;
  });

  test('a nonexistent Advance renders a plain not-found state', async ({ authenticatedPage: page }) => {
    await page.goto('/reports/advance-recovery/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText(/could not be found/i)).toBeVisible();
  });
});

test.describe('Advance Recovery Report — Export', () => {
  test('CSV and XLSX download with safe headers only, and the Cycle-specific recovery figure is correct in the CSV', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `arr-export-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const employeeName = `E2E Employee ${label}`;
    await createLoanInstallment(context, employeeId, cycle, '5000', '1000');

    await page.goto('/reports/advance-recovery');
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await page.locator('#arr-cycle').selectOption(cycle.id);
    await expect(page.getByTestId('on-screen-table').getByText(employeeName)).toBeVisible();

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/advance-recovery-report.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await (await import('node:fs/promises')).readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain('Current Outstanding Balance');
    expect(csvContent).toContain('Recovered This Cycle');
    expect(csvContent).toContain(employeeName);
    expect(csvContent).toContain('1000.00'); // the Cycle-specific recovered figure
    expect(csvContent.toLowerCase()).not.toContain('cnic');
    expect(csvContent.toLowerCase()).not.toContain('account number');
    expect(csvContent.toLowerCase()).not.toContain('iban');
    expect(csvContent.toLowerCase()).not.toContain('correction');

    // XLSX: verify the download/action/filename here — binary content parity is already covered
    // by the backend Checkpoint 1A test suite (`backend/tests/advance-recovery-report.test.ts`),
    // per the checkpoint brief's own documented allowance for this harness.
    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/advance-recovery-report.*\.xlsx$/i);
  });
});

test.describe('Advance Recovery Report — Print', () => {
  test('states current-page scope and current/live balance disclosure, opens Print Options with safe defaults, and invokes the browser print flow', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `arr-print-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const employeeName = `E2E Employee ${label}`;
    await createLoanInstallment(context, employeeId, cycle, '5000', '1000');
    await stubWindowPrint(page);

    await page.goto('/reports/advance-recovery');
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(employeeName)).toBeVisible();

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print Options')).toBeVisible();
    await expect(dialog.getByText(/current page only/i)).toBeVisible();
    await expect(dialog.getByText(/CNIC/i)).toHaveCount(0);
    await expect(dialog.getByText(/bank/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The actual printed content (invisible on-screen, `hidden print:block`): report title,
    // "current page only," a generated timestamp, and — with no Cycle selected — Recovered This
    // Cycle prints as "Not selected," never a fabricated 0.00.
    await page.emulateMedia({ media: 'print' });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Advance Recovery Report');
    expect(bodyText).toMatch(/Current page only/i);
    expect(bodyText).toMatch(/Generated /);

    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['Employee Name', 'Current Outstanding Balance', 'Recovered This Cycle']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    await expect(printTable.getByText('Not selected').first()).toBeVisible();

    const lowerBodyText = bodyText.toLowerCase();
    for (const forbidden of ['cnic', 'account number', 'iban', 'branch code', 'correction']) {
      expect(lowerBodyText).not.toContain(forbidden);
    }
    await page.emulateMedia({ media: 'screen' });
  });
});

test.describe('Advance Recovery Report — Responsive layout', () => {
  test('the filter row wraps cleanly at ~1024px with no horizontal document scroll', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `arr-responsive-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    await createLoanInstallment(context, employeeId, cycle, '5000', '1000');

    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/reports/advance-recovery');
    await expect(page.getByTestId('on-screen-table')).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await expect(page.locator('#arr-site-filter')).toBeVisible();
    await expect(page.locator('#arr-advance-type')).toBeVisible();
    await expect(page.locator('#arr-status')).toBeVisible();
    await expect(page.locator('#arr-has-outstanding-balance')).toBeVisible();
  });
});

test.describe('Advance Recovery Report — Permission', () => {
  test('a role holding reports:view can access; a role holding only statements:view cannot', async ({ browser }) => {
    const label = `arr-perm-${Date.now()}`;

    const noAccessEmail = `e2e-arr-no-access-${label}@example.test`;
    const noAccessPassword = 'E2EArrNoAccess1!';
    await createScopedUser({
      email: noAccessEmail,
      password: noAccessPassword,
      roleCode: 'TEST_E2E_ARR_STATEMENTS_ONLY',
      permissionKeys: ['statements:view'],
    });

    const noAccessContext = await browser.newContext();
    const noAccessPage = await noAccessContext.newPage();
    await login(noAccessPage, noAccessEmail, noAccessPassword);

    await expect(noAccessPage.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await noAccessPage.goto('/reports/advance-recovery');
    await expect(noAccessPage.getByText('You do not have permission to access this page.')).toBeVisible();

    // Direct URL bypass must also be denied on the detail route, not just the list route — permission
    // must not exist only at the catalogue-card/list level.
    await noAccessPage.goto('/reports/advance-recovery/00000000-0000-0000-0000-000000000000');
    await expect(noAccessPage.getByText('You do not have permission to access this page.')).toBeVisible();
    await noAccessContext.close();

    const accessEmail = `e2e-arr-access-${label}@example.test`;
    const accessPassword = 'E2EArrAccess1!';
    await createScopedUser({
      email: accessEmail,
      password: accessPassword,
      roleCode: 'TEST_E2E_ARR_REPORTS_VIEW',
      permissionKeys: ['reports:view'],
    });

    const accessContext = await browser.newContext();
    const accessPage = await accessContext.newPage();
    await login(accessPage, accessEmail, accessPassword);

    await accessPage.goto('/reports');
    await expect(accessPage.getByText('Advance Recovery Report')).toBeVisible();
    await accessPage.getByRole('link', { name: /Advance Recovery Report/ }).click();
    await expect(accessPage).toHaveURL(/\/reports\/advance-recovery$/);
    await expect(accessPage.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await accessContext.close();
  });
});
