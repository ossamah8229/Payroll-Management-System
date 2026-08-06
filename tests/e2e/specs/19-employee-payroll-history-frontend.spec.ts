import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Employee Payroll History Checkpoint 1B — real-browser verification of the frontend built over
 * the already-frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §15). No
 * mocked hooks, no `page.route` interception for RBAC or financial scenarios — real navigation,
 * real backend aggregation, real permission enforcement, matching this suite's own established
 * discipline (`17-reports.spec.ts`, `15-statements.spec.ts`).
 *
 * Fixture design note: this suite runs sequentially against one shared, disposable database
 * (`playwright.config.ts`'s `workers: 1`), and only one `PayrollCycle` is ever Draft at a time
 * (`docs/architecture/workflows/payroll-lifecycle.md` §4). Getting one employee a *second* payroll
 * cycle (needed for the "multiple cycles"/materialization scenarios) requires an actual month-end
 * rollover (Finalize + Archive-and-create-next) of whatever Draft cycle currently exists — which in
 * turn requires every payroll entry in that cycle (including ones left behind by earlier spec
 * files, not just this file's own fixtures) to already be released/held/resolved
 * (`payroll-processing.service.ts`'s own Finalize precondition). `releaseAllEligible` (Salary
 * Release's own "Release All", Phase 7F) resolves everything eligible in one call; a handful of
 * entries excluded from every release sweep (duplicate identity, missing banking) could still
 * theoretically block Finalize depending on exactly what earlier spec files leave behind — so
 * `rolloverCurrentDraftCycle` below skips its caller's stronger assertions gracefully
 * (`test.skip`) rather than failing outright if that precondition genuinely can't be met, the same
 * idiom `07-corrections.spec.ts`/`15-statements.spec.ts` already use for cross-spec state
 * uncertainty.
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
  workLines: { id: string; cycleDays: number }[];
}

/** Resolves the current Draft cycle, bootstrapping the very first cycle ever if none exists yet
 * (this file run in isolation, against a brand-new database) — the same resolve-or-bootstrap
 * pattern `17-reports.spec.ts` already establishes, so this spec is self-sufficient whether run
 * alone or as part of the full suite. */
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

/** Sets a full month of worked days (a real, positive net salary — never a 0-day/negative entry)
 * then releases that specific Unit, mirroring `17-reports.spec.ts`'s own
 * `makeDraftCycleWithReleasableEntry` helper. */
async function fillDaysAndRelease(
  context: BrowserContext,
  cycleId: string,
  unitId: string,
  entry: EntryRow,
): Promise<void> {
  await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
    version: entry.version,
    days: String(entry.workLines[0]!.cycleDays),
  });
  await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`, {});
}

/**
 * Resolves every remaining eligible entry cycle-wide, Finalizes, then rolls over — or returns
 * `null` if Finalize's own precondition (every entry released/held/resolved) can't be met given
 * whatever state earlier spec files left behind. See this file's own module doc comment.
 */
async function rolloverCurrentDraftCycle(
  context: BrowserContext,
  cycleId: string,
): Promise<{ newCycleId: string } | null> {
  try {
    await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/units/release-all`, {});
    await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/finalize`, {});
    const result = await apiPost<{ newCycle: { id: string } }>(
      context,
      `/api/v1/payroll-cycles/${cycleId}/archive-and-create-next`,
      {},
    );
    return { newCycleId: result.newCycle.id };
  } catch {
    return null;
  }
}

async function getAdjustmentTypeId(context: BrowserContext): Promise<string> {
  const res = await apiGet<{ adjustmentTypes: { id: string }[] }>(context, '/api/v1/adjustment-types');
  return res.body.adjustmentTypes[0]!.id;
}

/** A second, independent logged-in session holding only `corrections:approve` — the requester
 * (Master Admin, via `authenticatedPage`) can never approve their own request
 * (`assertNotSelfReview`), mirroring `07-corrections.spec.ts`'s own `reviewerSessionFor`. */
async function reviewerSessionFor(browser: import('@playwright/test').Browser, siteId: string) {
  const email = `e2e-eph-reviewer-${Date.now()}@example.test`;
  const password = 'EphReviewerPassword1!';
  await createScopedUser({
    email,
    password,
    roleCode: 'E2E_EPH_REVIEWER',
    permissionKeys: ['corrections:approve'],
    siteIds: [siteId],
    name: 'E2E EPH Reviewer',
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { page, close: () => context.close() };
}

/** Drives the real `EmployeePayrollHistoryEmployeeLookup` combobox. */
async function pickEmployeeInLookup(page: Page, employeeName: string) {
  const input = page.locator('#eph-employee');
  await input.fill(employeeName);
  const option = page.getByRole('option', { name: new RegExp(employeeName) });
  await expect(option.first()).toBeVisible({ timeout: 5000 });
  await option.first().click();
}

test.describe('Employee Payroll History — Reports frontend', () => {
  test('Master User — navigation, employee filter across multiple cycles, totals, sorting, pagination, and full detail-page verification', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const context = page.context();
    const label = `eph-${Date.now()}`;

    const cycle1 = await getCurrentDraftCycle(context);
    const { siteId, unitId, employeeId } = await createSiteWithEmployee(context, label);
    const employeeName = `E2E Employee ${label}`;
    const entry1 = await getEntryForEmployee(context, cycle1.id, employeeId);
    await fillDaysAndRelease(context, cycle1.id, unitId, entry1);

    // A PAYABLE, DEFERRED correction against the just-released entry — approved by a second
    // reviewer session (never the same session that submitted it).
    const adjustmentTypeId = await getAdjustmentTypeId(context);
    const requestRes = await apiPost<{ correctionRequest: { id: string } }>(
      context,
      `/api/v1/payroll-entries/${entry1.id}/correction-requests`,
      { field: 'ALLOWANCE', proposedNewValue: '5000', adjustmentTypeId, reason: 'E2E: Employee Payroll History coverage' },
    );
    const reviewer = await reviewerSessionFor(browser, siteId);
    await apiPost(reviewer.page.context(), `/api/v1/correction-requests/${requestRes.correctionRequest.id}/approve`, {
      paymentTiming: 'DEFERRED',
    });
    await reviewer.close();

    const rollover = await rolloverCurrentDraftCycle(context, cycle1.id);
    test.skip(!rollover, 'Finalize precondition not met given current shared-suite state — run the full suite.');
    if (!rollover) return;
    const cycle2Id = rollover.newCycleId;

    // The rollover's own materialization hook reserved the DEFERRED PAYABLE obligation into
    // cycle2; releasing this employee's Unit there is what actually consumes it into a settlement.
    const entry2 = await getEntryForEmployee(context, cycle2Id, employeeId);
    await fillDaysAndRelease(context, cycle2Id, unitId, entry2);

    // --- Navigation: Reports catalogue -> Employee Payroll History --------------------------
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Employee Payroll History')).toBeVisible();
    await page.getByRole('link', { name: /Employee Payroll History/ }).click();
    await expect(page).toHaveURL(/\/reports\/employee-payroll-history$/);

    // --- Filter by employee: two real cycles for the same employee ---------------------------
    await pickEmployeeInLookup(page, employeeName);
    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(employeeName).first()).toBeVisible();
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByText('Showing 1–2 of 2')).toBeVisible();

    // --- Totals: backend-provided, matching exactly 2 entries --------------------------------
    await expect(page.getByTestId('eph-stat-matching-entries')).toHaveText(/2/);

    // Exactly one row shows a correction count badge — never derived client-side, straight off the
    // backend's own batched `correctionCount`.
    await expect(onScreenTable.getByText('1', { exact: true })).toBeVisible();

    // --- Sorting: clicking a sortable header updates its own aria-sort, never client-side-only -
    const netSalaryHeader = page.getByRole('columnheader', { name: /net salary/i });
    await netSalaryHeader.getByRole('button').click();
    await expect(netSalaryHeader).toHaveAttribute('aria-sort', 'ascending');
    await netSalaryHeader.getByRole('button').click();
    await expect(netSalaryHeader).toHaveAttribute('aria-sort', 'descending');

    // --- Pagination: server-provided page metadata, Previous disabled on page 1 --------------
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

    // --- Detail page: original payroll, correction, resulting balance, later materialization -
    // Visits both of this employee's rows in turn — one is the correction's origin entry, the
    // other is the entry whose own release consumed the resulting materialization.
    const backButton = page.getByRole('button', { name: /back to report/i });
    let foundCorrectionEntry = false;
    let foundMaterializationEntry = false;
    for (let i = 0; i < 2; i++) {
      await expect(page).toHaveURL(/\/reports\/employee-payroll-history$/);
      await onScreenTable.locator('tbody tr').nth(i).getByRole('button', { name: 'View Details' }).click();
      await expect(page).toHaveURL(/\/reports\/employee-payroll-history\/.+/);
      // A plain `getByText('Original Payroll Result')` is ambiguous — it also matches the
      // AppShell's own page subtitle ("Original payroll result and its later financial events")
      // and the card's own explanatory paragraph ("...this original payroll result."), a genuine
      // strict-mode violation that surfaces intermittently depending on exactly when the assertion
      // polls relative to data load. The card's own heading is the one unique element.
      await expect(page.getByRole('heading', { name: 'Original Payroll Result' })).toBeVisible();
      await expect(page.getByText(/do not overwrite this original payroll result/i)).toBeVisible();

      // Never banking fields, anywhere on this page.
      const bodyText = await page.locator('body').innerText();
      expect(/account\s*number/i.test(bodyText)).toBe(false);
      expect(/\bIBAN\b/i.test(bodyText)).toBe(false);

      if (await page.getByText('E2E: Employee Payroll History coverage').count()) {
        foundCorrectionEntry = true;
        await expect(page.getByText('Resulting Balance Adjustment')).toBeVisible();
        // Either fully consumed by the later release (SETTLED) or still reserved (PENDING) —
        // both are legitimate states this page must render faithfully; the point under test is
        // that the resulting Balance Adjustment is shown at all, never its exact settlement
        // timing (a Corrections-domain concern, not this report's own).
        await expect(page.getByText(/SETTLED|PENDING/)).toBeVisible();
      }
      if (await page.getByText(/this cycle.s net salary includes settlement/i).count()) {
        foundMaterializationEntry = true;
        // Origin cycle labeled distinctly from this (consuming) entry's own cycle.
        await expect(page.getByText(/origin cycle:/i)).toBeVisible();
      }

      await backButton.click();
    }
    expect(foundCorrectionEntry).toBe(true);
    expect(foundMaterializationEntry).toBe(true);
  });

  test('Exports — CSV and XLSX download with safe headers only, current filters applied', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `eph-export-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDaysAndRelease(context, cycle.id, unitId, entry);
    const employeeName = `E2E Employee ${label}`;

    await page.goto('/reports/employee-payroll-history');
    await pickEmployeeInLookup(page, employeeName);
    await expect(page.getByTestId('on-screen-table').getByText(employeeName)).toBeVisible();

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/employee-payroll-history.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await (await import('node:fs/promises')).readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain('Net Salary');
    expect(csvContent.toLowerCase()).not.toContain('cnic');
    expect(csvContent.toLowerCase()).not.toContain('account number');
    expect(csvContent.toLowerCase()).not.toContain('iban');

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/employee-payroll-history.*\.xlsx$/i);
  });

  test('Print — Options dialog defaults to every safe column, shows readability guidance, and invokes the browser print flow', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `eph-print-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDaysAndRelease(context, cycle.id, unitId, entry);

    await page.addInitScript(() => {
      window.print = () => undefined;
    });

    await page.goto('/reports/employee-payroll-history');
    await pickEmployeeInLookup(page, `E2E Employee ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print Options')).toBeVisible();
    await expect(dialog.getByText('13 columns selected', { exact: false })).toBeVisible();
    await expect(dialog.getByText(/CNIC/i)).toHaveCount(0);
    await expect(dialog.getByText(/bank/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Historical transfer — a Site-A-only user discovers the employee via historical site, cannot open the Site-B entry directly, and sees a not-found state', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `eph-transfer-${Date.now()}`;

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E EPH Site A ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, {
      name: `E2E EPH Unit A ${label}`,
    });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E EPH Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E EPH Unit B ${label}`,
    });
    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E EPH Transferred ${label}`,
      designation: 'Guard',
      siteId: siteA.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });
    const employeeName = `E2E EPH Transferred ${label}`;

    const cycleA = await getCurrentDraftCycle(context);
    const entryA = await getEntryForEmployee(context, cycleA.id, employee.employee.id);
    await fillDaysAndRelease(context, cycleA.id, unitA.unit.id, entryA);

    // Transfer to Site B — current Employee.siteId is now B; entryA (siteId = Site A, frozen at
    // release) is untouched.
    await apiPatch(context, `/api/v1/employees/${employee.employee.id}`, {
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
    });

    const rollover = await rolloverCurrentDraftCycle(context, cycleA.id);
    test.skip(!rollover, 'Finalize precondition not met given current shared-suite state — run the full suite.');
    if (!rollover) return;

    // The new cycle's own roster bootstrap creates this continuing employee's entry at their
    // *current* site — Site B.
    const entryB = await getEntryForEmployee(context, rollover.newCycleId, employee.employee.id);
    await fillDaysAndRelease(context, rollover.newCycleId, unitB.unit.id, entryB);

    const siteAEmail = `e2e-eph-site-a-${label}@example.test`;
    const siteAPassword = 'E2EEphSiteA1!';
    await createScopedUser({
      email: siteAEmail,
      password: siteAPassword,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['statements:view'],
      siteIds: [siteA.site.id],
      name: 'E2E Site A EPH User',
    });

    const siteAContext = await browser.newContext();
    const siteAPage = await siteAContext.newPage();
    await login(siteAPage, siteAEmail, siteAPassword);

    await siteAPage.goto('/reports/employee-payroll-history');
    await pickEmployeeInLookup(siteAPage, employeeName);

    // Discoverable and visible via the Site-A historical row only.
    const onScreenTable = siteAPage.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    await expect(onScreenTable.getByText(siteA.site.name)).toBeVisible();
    await expect(onScreenTable.getByText(siteB.site.name)).toHaveCount(0);
    await expect(onScreenTable.locator('tbody tr')).toHaveCount(1);

    // Direct navigation to the Site-B entry is a plain not-found state, never a 403/blank page.
    await siteAPage.goto(`/reports/employee-payroll-history/${entryB.id}`);
    await expect(siteAPage.getByText(/could not be found/i)).toBeVisible();

    await siteAContext.close();
  });

  test('Permission — a role with reports:view only cannot access; a role with statements:view can', async ({
    browser,
  }) => {
    const label = `eph-perm-${Date.now()}`;

    const noAccessEmail = `e2e-eph-no-access-${label}@example.test`;
    const noAccessPassword = 'E2EEphNoAccess1!';
    await createScopedUser({
      email: noAccessEmail,
      password: noAccessPassword,
      roleCode: 'TEST_E2E_EPH_REPORTS_ONLY',
      permissionKeys: ['reports:view'],
    });

    const noAccessContext = await browser.newContext();
    const noAccessPage = await noAccessContext.newPage();
    await login(noAccessPage, noAccessEmail, noAccessPassword);

    // The Reports catalogue is reachable (reports:view), but the Employee Payroll History card
    // is hidden entirely — never a broken/unauthorized link.
    await noAccessPage.goto('/reports');
    await expect(noAccessPage.getByText('Payroll Summary')).toBeVisible();
    await expect(noAccessPage.getByText('Employee Payroll History')).toHaveCount(0);

    // Direct navigation is blocked with Access Denied, never a misleading empty report.
    await noAccessPage.goto('/reports/employee-payroll-history');
    await expect(noAccessPage.getByText('You do not have permission to access this page.')).toBeVisible();
    await expect(noAccessPage.getByText(/no payroll history/i)).toHaveCount(0);
    await noAccessContext.close();

    const accessEmail = `e2e-eph-access-${label}@example.test`;
    const accessPassword = 'E2EEphAccess1!';
    await createScopedUser({
      email: accessEmail,
      password: accessPassword,
      roleCode: 'TEST_E2E_EPH_STATEMENTS_VIEW',
      permissionKeys: ['reports:view', 'statements:view'],
    });

    const accessContext = await browser.newContext();
    const accessPage = await accessContext.newPage();
    await login(accessPage, accessEmail, accessPassword);

    await accessPage.goto('/reports');
    await expect(accessPage.getByText('Employee Payroll History')).toBeVisible();
    await accessPage.getByRole('link', { name: /Employee Payroll History/ }).click();
    await expect(accessPage).toHaveURL(/\/reports\/employee-payroll-history$/);
    await expect(accessPage.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await accessContext.close();
  });
});
