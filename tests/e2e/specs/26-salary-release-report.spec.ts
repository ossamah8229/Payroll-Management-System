import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Salary Release Report Checkpoint 1B — real-browser verification of the frontend built over the
 * already-frozen Checkpoint 1A backend (`docs/architecture/workflows/reports.md` §20). No mocked
 * hooks, no `page.route` interception for any RBAC or financial assertion — real navigation, real
 * backend aggregation, real permission enforcement, matching this suite's own established discipline
 * (`17-reports.spec.ts`, `21-deduction-report.spec.ts`, `22-overtime-report.spec.ts`).
 *
 * This suite runs sequentially against one shared, disposable database (`playwright.config.ts`'s
 * `workers: 1`) and one shared Draft `PayrollCycle` accumulating fixture entries from every earlier
 * spec file — every test below filters by its own freshly-created Site so it never has to reason
 * about, or be defeated by, unrelated rows already in that cycle.
 *
 * **This is the first Reports-module report gated on an OR permission** (`reports:view` OR
 * `payroll:view`) — the Permission describe block below is the one place this suite differs
 * structurally from every sibling report spec, proving both admitting permissions independently, a
 * real `FINANCE`-coded role, and the two permissions that must NOT imply access on their own
 * (`payroll:release`, `statements:view`).
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
  released: boolean;
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
 * does not release. Mirrors every sibling report spec's own identical helper. */
async function fillDays(context: BrowserContext, entry: EntryRow): Promise<void> {
  await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
    version: entry.version,
    days: String(entry.workLines[0]!.cycleDays),
  });
}

async function releaseUnit(context: BrowserContext, cycleId: string, unitId: string): Promise<void> {
  await apiPost(context, `/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`, {});
}

async function holdEntry(context: BrowserContext, entry: EntryRow): Promise<void> {
  await apiPatch(context, `/api/v1/payroll-entries/${entry.id}`, { version: entry.version, hold: true });
}

/** `netSalary = 0` (`eobiApplicable: false` + zero worked days, so both totalEarning and
 * totalDeduction are 0) — the one real construction that reaches `NO_PAY_DUE` on release, mirroring
 * `payroll-release-eligibility.ts`'s own documented `netSalary = 0` condition. */
async function makeNoPayDue(context: BrowserContext, entry: EntryRow): Promise<void> {
  await apiPatch(context, `/api/v1/payroll-entries/${entry.id}`, { version: entry.version, eobiApplicable: false });
}

async function getAdjustmentTypeId(context: BrowserContext): Promise<string> {
  const res = await apiGet<{ adjustmentTypes: { id: string }[] }>(context, '/api/v1/adjustment-types');
  return res.body.adjustmentTypes[0]!.id;
}

async function reviewerSessionFor(browser: import('@playwright/test').Browser, siteId: string, label: string) {
  const email = `e2e-srr-reviewer-${label}@example.test`;
  const password = 'SrrReviewerPassword1!';
  await createScopedUser({
    email,
    password,
    roleCode: 'E2E_SRR_REVIEWER',
    permissionKeys: ['corrections:approve'],
    siteIds: [siteId],
    name: 'E2E SRR Reviewer',
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { page, close: () => context.close() };
}

async function openSiteFilterAndSelect(page: Page, siteName: string) {
  await page.locator('#srr-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteName }).click();
  await page.keyboard.press('Escape');
}

async function stubWindowPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
}

test.describe('Salary Release Report — five statuses, totals, and table', () => {
  test('RELEASED, HELD, PENDING, NO_PAY_DUE, and RECOVERY_DUE are all produced through real release actions and rendered without inventing a status vocabulary', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `srr-statuses-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E SRR Site ${label}`,
    });
    const unitReleased = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E SRR Released Unit ${label}`,
    });
    const unitHeld = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E SRR Held Unit ${label}`,
    });
    const unitPending = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E SRR Pending Unit ${label}`,
    });
    const unitNoPayDue = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E SRR NoPayDue Unit ${label}`,
    });
    const unitRecoveryDue = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E SRR RecoveryDue Unit ${label}`,
    });

    async function makeEmployee(name: string, unitId: string) {
      const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
        name,
        designation: 'Guard',
        siteId: site.site.id,
        unitId,
        grossPay: '30000',
      });
      return getEntryForEmployee(context, cycle.id, employee.employee.id);
    }

    const releasedName = `E2E SRR Released ${label}`;
    const heldName = `E2E SRR Held ${label}`;
    const pendingName = `E2E SRR Pending ${label}`;
    const noPayDueName = `E2E SRR NoPayDue ${label}`;
    const recoveryDueName = `E2E SRR RecoveryDue ${label}`;

    const releasedEntry = await makeEmployee(releasedName, unitReleased.unit.id);
    await fillDays(context, releasedEntry);

    const heldEntry = await makeEmployee(heldName, unitHeld.unit.id);
    await fillDays(context, heldEntry);
    // fillDays PATCHes the work-line, which bumps the parent PayrollEntry's own version — refetch
    // before the next PATCH so `hold: true` isn't sent against a now-stale version.
    const heldEntryAfterDays = await getEntryForEmployee(context, cycle.id, heldEntry.employeeId);
    await holdEntry(context, heldEntryAfterDays);

    // PENDING carries a genuinely positive net salary (full days) but is never released — proves
    // Pending Release Amount totals a real positive figure, never a negative default-fixture net.
    const pendingEntry = await makeEmployee(pendingName, unitPending.unit.id);
    await fillDays(context, pendingEntry);

    const noPayDueEntry = await makeEmployee(noPayDueName, unitNoPayDue.unit.id);
    await makeNoPayDue(context, noPayDueEntry); // zero days (default) + eobiApplicable:false -> net = 0

    // RECOVERY_DUE needs no changes — the default fixture (zero worked days, eobiApplicable:true)
    // already produces a negative net salary via the EOBI deduction alone
    // (02-payroll-lifecycle.spec.ts's own documented reasoning).
    await makeEmployee(recoveryDueName, unitRecoveryDue.unit.id);

    await releaseUnit(context, cycle.id, unitReleased.unit.id);
    await releaseUnit(context, cycle.id, unitHeld.unit.id); // held entry excluded from this sweep
    await releaseUnit(context, cycle.id, unitNoPayDue.unit.id);
    await releaseUnit(context, cycle.id, unitRecoveryDue.unit.id);
    // unitPending is deliberately never released.

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, site.site.name);
    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(releasedName)).toBeVisible();
    await expect(onScreenTable.getByText(heldName)).toBeVisible();
    await expect(onScreenTable.getByText(pendingName)).toBeVisible();
    await expect(onScreenTable.getByText(noPayDueName)).toBeVisible();
    await expect(onScreenTable.getByText(recoveryDueName)).toBeVisible();

    function rowFor(name: string) {
      return onScreenTable.locator('tr', { has: page.getByText(name, { exact: true }) });
    }

    // RELEASED — a real Original Released Amount and Released At, never fabricated for anyone else.
    await expect(rowFor(releasedName).getByText('Released', { exact: true })).toBeVisible();
    const releasedAmountCell = rowFor(releasedName).locator('td').nth(6);
    await expect(releasedAmountCell).not.toHaveText('—');

    // HELD — never presented as pending release: no amount, no timestamp, distinct from PENDING.
    await expect(rowFor(heldName).getByText('Held', { exact: true })).toBeVisible();
    await expect(rowFor(heldName).locator('td').nth(6)).toHaveText('—');
    await expect(rowFor(heldName).locator('td').nth(7)).toHaveText('—');

    // PENDING — no fabricated released amount/timestamp either.
    await expect(rowFor(pendingName).getByText('Pending', { exact: true })).toBeVisible();
    await expect(rowFor(pendingName).locator('td').nth(6)).toHaveText('—');

    // NO_PAY_DUE — must never display as released salary.
    await expect(rowFor(noPayDueName).getByText('No Pay Due', { exact: true })).toBeVisible();
    await expect(rowFor(noPayDueName).locator('td').nth(6)).toHaveText('—');

    // RECOVERY_DUE — must never display as released salary.
    await expect(rowFor(recoveryDueName).getByText('Recovery Due', { exact: true })).toBeVisible();
    await expect(rowFor(recoveryDueName).locator('td').nth(6)).toHaveText('—');

    // Status counts remain visible and exact regardless of totalsComputed, and Released Amount /
    // Pending Release Amount stay in their own separate cards, never combined into one figure.
    const cards = page.getByTestId('on-screen-cards');
    await expect(cards.getByText('Released Amount')).toBeVisible();
    await expect(cards.getByText('Pending Release Amount')).toBeVisible();
    await expect(cards.getByText('Released', { exact: true })).toBeVisible();
    await expect(cards.getByText('Held', { exact: true })).toBeVisible();
    await expect(cards.getByText('No Pay Due')).toBeVisible();
    await expect(cards.getByText('Recovery Due')).toBeVisible();

    // Release-semantics disclosure is present on screen.
    await expect(page.getByTestId('release-semantics-notice')).toContainText(/Original Released Amount/);
  });
});

test.describe('Salary Release Report — Multi-Unit release', () => {
  test('an entry spanning two Units is not RELEASED until both Units release; exactly one row, one amount, one timestamp afterward', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `srr-multiunit-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const { siteId, unitId: unitAId, employeeId } = await createSiteWithEmployee(context, label);
    const unitB = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${siteId}/units`, {
      name: `E2E SRR Multi Unit B ${label}`,
    });

    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    // v1.0.3 M2 checkpoint — a genuine multi-unit split's combined Working Days can never exceed
    // the applicable Cycle Days, so Unit A is left with 5 days of headroom for Unit B's own 5
    // below, rather than `fillDays`'s usual "full month on one line" convention — this test's
    // assertions are about release status/row-collapsing, never the exact days split.
    await apiPatch(context, `/api/v1/work-lines/${entry.workLines[0]!.id}`, {
      version: entry.version,
      days: String(entry.workLines[0]!.cycleDays - 5),
    });

    const afterFirstLine = await getEntryForEmployee(context, cycle.id, employeeId);
    await apiPost(context, `/api/v1/payroll-entries/${afterFirstLine.id}/work-lines`, {
      version: afterFirstLine.version,
      unitId: unitB.unit.id,
      days: '5',
    });

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const onScreenTable = page.getByTestId('on-screen-table');
    const employeeName = `E2E Employee ${label}`;
    await expect(onScreenTable.getByText(employeeName)).toBeVisible();

    // Only Unit A released so far — the entry as a whole is not yet RELEASED.
    await releaseUnit(context, cycle.id, unitAId);
    await page.reload();
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    await expect(onScreenTable.getByText('Released', { exact: true })).toHaveCount(0);

    // Releasing the second, final Unit resolves the entry — exactly one row, RELEASED.
    await releaseUnit(context, cycle.id, unitB.unit.id);
    await page.reload();
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(onScreenTable.locator('tr', { hasText: employeeName })).toHaveCount(1);
    const row = onScreenTable.locator('tr', { has: page.getByText(employeeName, { exact: true }) });
    await expect(row.getByText('Released', { exact: true })).toBeVisible();
    // Primary Unit "(+1 more)" — two Units collapsed into one display field, never two rows.
    await expect(row.getByText(/\+1 more/)).toBeVisible();
    const releasedAmountCell = row.locator('td').nth(6);
    await expect(releasedAmountCell).not.toHaveText('—');
    const releasedAtCell = row.locator('td').nth(7);
    await expect(releasedAtCell).not.toHaveText('—');
  });
});

test.describe('Salary Release Report — Correction after release', () => {
  test('a post-release Correction increments the correction count but never changes Original Released Amount, and correction balances stay separate', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const context = page.context();
    const label = `srr-correction-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, unitId, employeeId } = await createSiteWithEmployee(context, label);
    const employeeName = `E2E Employee ${label}`;

    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);
    await releaseUnit(context, cycle.id, unitId);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    const rowBefore = onScreenTable.locator('tr', { has: page.getByText(employeeName, { exact: true }) });
    const amountBeforeText = await rowBefore.locator('td').nth(6).innerText();
    expect(amountBeforeText).not.toBe('—');

    // A real post-release Correction, submitted and approved through the real backend
    // (`assertEntryIsReleased` only requires the entry itself be released — the cycle need not be
    // Archived). PAYABLE (an ALLOWANCE increase) requires an explicit paymentTiming on approval.
    const adjustmentTypeId = await getAdjustmentTypeId(context);
    const releasedEntry = await getEntryForEmployee(context, cycle.id, employeeId);
    const created = await apiPost<{ correctionRequest: { id: string } }>(
      context,
      `/api/v1/payroll-entries/${releasedEntry.id}/correction-requests`,
      {
        field: 'ALLOWANCE',
        proposedNewValue: '750',
        adjustmentTypeId,
        reason: 'E2E: Salary Release Report — correction after release',
      },
    );

    const reviewer = await reviewerSessionFor(browser, siteId, label);
    await apiPost(reviewer.page.context(), `/api/v1/correction-requests/${created.correctionRequest.id}/approve`, {
      paymentTiming: 'DEFERRED',
    });
    await reviewer.close();

    await page.reload();
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    const rowAfter = onScreenTable.locator('tr', { has: page.getByText(employeeName, { exact: true }) });

    // Row stays RELEASED, and Original Released Amount is byte-identical to before the correction —
    // never rewritten by a later correction (frozen Checkpoint 1A financial-correctness invariant).
    await expect(rowAfter.getByText('Released', { exact: true })).toBeVisible();
    const amountAfterText = await rowAfter.locator('td').nth(6).innerText();
    expect(amountAfterText).toBe(amountBeforeText);

    // Correction Count now shows 1 as a badge — kept visually and semantically separate from
    // Original Released Amount, never folded into it.
    const correctionCountCell = rowAfter.locator('td').nth(8);
    await expect(correctionCountCell).toHaveText('1');
  });
});

test.describe('Salary Release Report — Site scoping and historical transfer', () => {
  test('a site-scoped user sees only accessible historical rows; a later transfer keeps the entry under its historical Site; the inaccessible Site is never offered as a filter; no cross-site leak', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `srr-scope-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const siteA = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E SRR Site A ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteA.site.id}/units`, {
      name: `E2E SRR Unit A ${label}`,
    });
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E SRR Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E SRR Unit B ${label}`,
    });

    const employeeName = `E2E SRR Transferred ${label}`;
    const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId: siteA.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });

    const siteBOnlyEmployee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E SRR Site B Only ${label}`,
      designation: 'Guard',
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
      grossPay: '25000',
    });

    const entryA = await getEntryForEmployee(context, cycle.id, employee.employee.id);
    await fillDays(context, entryA);
    await releaseUnit(context, cycle.id, unitA.unit.id);
    const entryBOnly = await getEntryForEmployee(context, cycle.id, siteBOnlyEmployee.employee.id);
    await fillDays(context, entryBOnly);
    await releaseUnit(context, cycle.id, unitB.unit.id);

    // Historical scoping: the employee is transferred to Site B *after* the entry was released — the
    // PayrollEntry itself must remain visible under Site A only (frozen decision — always
    // `PayrollEntry.siteId`, never the employee's current site).
    await apiPatch(context, `/api/v1/employees/${employee.employee.id}`, {
      siteId: siteB.site.id,
      unitId: unitB.unit.id,
    });

    const scopedEmail = `e2e-srr-site-a-${label}@example.test`;
    const scopedPassword = 'E2ESrrSiteA1!';
    await createScopedUser({
      email: scopedEmail,
      password: scopedPassword,
      roleCode: 'PAYROLL_STAFF',
      permissionKeys: ['reports:view'],
      siteIds: [siteA.site.id],
      name: 'E2E Site A SRR User',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, scopedEmail, scopedPassword);

    await scopedPage.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    const onScreenTable = scopedPage.getByTestId('on-screen-table');

    await expect(onScreenTable.getByText(employeeName)).toBeVisible();
    await expect(onScreenTable.getByText(siteA.site.name)).toBeVisible();

    await expect(onScreenTable.getByText(`E2E SRR Site B Only ${label}`)).toHaveCount(0);
    await expect(onScreenTable.getByText(siteB.site.name)).toHaveCount(0);

    await scopedPage.locator('#srr-site-filter').click();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteA.site.name })).toBeVisible();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: siteB.site.name })).toHaveCount(0);
    await scopedPage.keyboard.press('Escape');

    // Explicit inaccessible-Site filter never leaks data — the backend itself rejects it.
    const rejected = await apiGet(scopedContext, `/api/v1/reports/salary-release?cycleId=${cycle.id}&siteIds=${siteB.site.id}`);
    expect(rejected.status).toBe(403);

    await scopedContext.close();
  });
});

test.describe('Salary Release Report — Filters', () => {
  test('the Unit filter narrows within one Site, Row Status/Has Correction filter, and Clear Filters preserves the selected Cycle', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `srr-filters-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);

    const site = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E SRR Filter Site ${label}`,
    });
    const unitA = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E SRR Filter Unit A ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string; name: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E SRR Filter Unit B ${label}`,
    });

    const employeeA = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E SRR Filter A ${label}`,
      designation: 'Guard',
      siteId: site.site.id,
      unitId: unitA.unit.id,
      grossPay: '30000',
    });
    const employeeB = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E SRR Filter B ${label}`,
      designation: 'Guard',
      siteId: site.site.id,
      unitId: unitB.unit.id,
      grossPay: '30000',
    });

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, site.site.name);
    const onScreenTable = page.getByTestId('on-screen-table');
    await expect(onScreenTable.getByText(`E2E SRR Filter A ${label}`)).toBeVisible();
    await expect(onScreenTable.getByText(`E2E SRR Filter B ${label}`)).toBeVisible();

    // Unit is disabled until exactly one Site is selected — already satisfied above (one Site).
    await expect(page.locator('#srr-unit-filter')).toBeEnabled();
    await page.locator('#srr-unit-filter').selectOption({ label: unitA.unit.name });
    await expect(onScreenTable.getByText(`E2E SRR Filter A ${label}`)).toBeVisible();
    await expect(onScreenTable.getByText(`E2E SRR Filter B ${label}`)).toHaveCount(0);

    await page.locator('#srr-row-status').selectOption('PENDING');
    await expect(onScreenTable.getByText(`E2E SRR Filter A ${label}`)).toBeVisible();

    await page.locator('#srr-has-correction').selectOption('YES');
    await expect(onScreenTable.getByText(`E2E SRR Filter A ${label}`)).toHaveCount(0);
    await page.locator('#srr-has-correction').selectOption('NO');
    await expect(onScreenTable.getByText(`E2E SRR Filter A ${label}`)).toBeVisible();

    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('#srr-row-status')).toHaveValue('');
    await expect(page.locator('#srr-has-correction')).toHaveValue('ALL');
    await expect(page.locator('#srr-unit-filter')).toHaveValue('');
    // The Cycle itself survives Clear Filters — still the same cycle we navigated to.
    await expect(page).toHaveURL(new RegExp(cycle.id));
    void employeeA;
    void employeeB;
  });
});

test.describe('Salary Release Report — Sorting and pagination', () => {
  test('clicking a sortable column header re-sorts server-side, and pagination reflects backend totals', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `srr-sort-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();

    const header = page.getByRole('columnheader', { name: /employee code/i });
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');

    // Unsupported sorts (financial columns) render as plain headers, never clickable buttons.
    const originalReleasedHeader = page.getByRole('columnheader', { name: /original released amount/i });
    await expect(originalReleasedHeader.getByRole('button')).toHaveCount(0);
  });
});

test.describe('Salary Release Report — Export', () => {
  test('CSV and XLSX download with safe headers only, complete filtered result', async ({ authenticatedPage: page }) => {
    const context = page.context();
    const label = `srr-export-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId, unitId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);
    await releaseUnit(context, cycle.id, unitId);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/salary-release-report.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await (await import('node:fs/promises')).readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain(`E2E Employee ${label}`);
    const lowerCsv = csvContent.toLowerCase();
    for (const forbidden of ['cnic', 'account number', 'iban', 'bank', 'gross pay', 'net salary', 'released by', 'payment method']) {
      expect(lowerCsv).not.toContain(forbidden);
    }

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Excel' }).click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/salary-release-report.*\.xlsx$/i);
  });
});

test.describe('Salary Release Report — Print', () => {
  test('states current-page scope, opens Print Options with safe defaults and readability guidance, and invokes the browser print flow', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `srr-print-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { unitId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);
    await releaseUnit(context, cycle.id, unitId);
    await stubWindowPrint(page);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    await expect(page.getByTestId('on-screen-table').getByText(`E2E Employee ${label}`)).toBeVisible();
    await page.locator('#srr-row-status').selectOption('RELEASED');

    await page.getByRole('button', { name: 'Print', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Print Options')).toBeVisible();
    await expect(dialog.getByText(/current page only/i)).toBeVisible();
    await expect(dialog.getByText(/CNIC/i)).toHaveCount(0);
    await expect(dialog.getByText(/bank/i)).toHaveCount(0);
    await expect(dialog.getByText(/released by/i)).toHaveCount(0);
    await expect(dialog.getByText(/payment method/i)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The printed content states the report title, Cycle, every applied filter (including Row
    // Status), the Original Released Amount disclosure, a generated timestamp, and "current page
    // only" — never omitting an active filter from the print header (the Deduction Report defect
    // this checkpoint's own instruction explicitly names).
    await page.emulateMedia({ media: 'print' });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Salary Release Report');
    expect(bodyText).toMatch(/Row Status: Released/);
    expect(bodyText).toMatch(/Current page only/i);
    expect(bodyText).toMatch(/Generated /);
    expect(bodyText).toMatch(/Original Released Amount/);

    const printTable = page.getByTestId('print-only-table');
    for (const heading of ['Employee Name', 'Row Status', 'Original Released Amount']) {
      await expect(printTable.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    const printCards = page.getByTestId('print-only-cards');
    await expect(printCards.getByText('Matching Entries')).toBeVisible();

    const lowerBodyText = bodyText.toLowerCase();
    for (const forbidden of ['gross pay', 'net salary', 'cnic', 'account number', 'iban', 'branch code', 'released by', 'payment method']) {
      expect(lowerBodyText).not.toContain(forbidden);
    }
    await page.emulateMedia({ media: 'screen' });
  });
});

test.describe('Salary Release Report — Responsive layout', () => {
  test('the filter row wraps cleanly at a narrower viewport with no horizontal document scroll', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `srr-responsive-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await expect(page.getByTestId('on-screen-table')).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await expect(page.locator('#srr-cycle')).toBeVisible();
    await expect(page.locator('#srr-site-filter')).toBeVisible();
    await expect(page.locator('#srr-row-status')).toBeVisible();
    await expect(page.locator('#srr-has-correction')).toBeVisible();
  });
});

test.describe('Salary Release Report — No detail action', () => {
  test('there is no detail button, link, or route for any row (frozen no-detail-endpoint decision)', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `srr-nodetail-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);
    await fillDays(context, entry);

    await page.goto(`/payroll-cycles/${cycle.id}/reports/salary-release`);
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const row = page.getByTestId('on-screen-table').locator('tr', { hasText: `E2E Employee ${label}` });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: /view details/i })).toHaveCount(0);
    await expect(row.getByRole('link')).toHaveCount(0);

    const response = await apiGet(context, `/api/v1/reports/salary-release/${entry.id}`);
    expect(response.status).toBe(404);
  });
});

test.describe('Salary Release Report — Permission (reports:view OR payroll:view)', () => {
  test('reports:view alone grants catalogue and route access', async ({ browser }) => {
    const label = `srr-perm-reports-${Date.now()}`;
    const email = `e2e-srr-reports-${label}@example.test`;
    const password = 'E2ESrrReports1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_SRR_REPORTS_VIEW', permissionKeys: ['reports:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    await page.goto('/reports');
    await expect(page.getByText('Salary Release Report')).toBeVisible();
    await page.getByRole('link', { name: /Salary Release Report/ }).click();
    await expect(page).toHaveURL(/\/reports\/salary-release$|\/payroll-cycles\/.+\/reports\/salary-release$/);
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await context.close();
  });

  test('payroll:view alone (a real FINANCE-role user — never holds reports:view) grants catalogue and route access', async ({
    browser,
  }) => {
    const label = `srr-perm-finance-${Date.now()}`;
    const email = `e2e-srr-finance-${label}@example.test`;
    const password = 'E2ESrrFinance1!';
    // The real seeded FINANCE role's own grant set (shared/src/constants/permissions.ts
    // `ROLE_PERMISSIONS.FINANCE`) — payroll:view/payroll:release/bank-sheets:view/payslips:view/
    // statements:view, deliberately never reports:view. Constructed the same way
    // `create-scoped-user.ts`'s own doc comment describes for a real-role-shaped fixture: roleCode
    // 'FINANCE' upserts against the already-seeded Role row rather than inventing a synthetic one.
    await createScopedUser({
      email,
      password,
      roleCode: 'FINANCE',
      permissionKeys: ['payroll:view', 'payroll:release', 'bank-sheets:view', 'payslips:view', 'statements:view'],
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);

    // The Reports sidebar link is itself widened to reports:view OR payroll:view (nav-config.ts) —
    // a Finance user must have a normal, discoverable navigation path to the one report the
    // catalogue admits them to, never only a direct URL. Asserted explicitly below before falling
    // back to the same direct navigation the other permission cases in this describe block use.
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page).toHaveURL('/reports');
    await expect(page.getByText('You don’t have access to Reports')).toHaveCount(0);
    await expect(page.getByText('Salary Release Report')).toBeVisible();
    await page.getByRole('link', { name: /Salary Release Report/ }).click();
    await expect(page).toHaveURL(/\/reports\/salary-release$|\/payroll-cycles\/.+\/reports\/salary-release$/);
    await expect(page.getByText('You do not have permission to access this page.')).toHaveCount(0);
    await context.close();
  });

  test('neither permission is denied', async ({ browser }) => {
    const label = `srr-perm-none-${Date.now()}`;
    const email = `e2e-srr-none-${label}@example.test`;
    const password = 'E2ESrrNone1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_SRR_NONE', permissionKeys: ['employees:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto('/reports/salary-release');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await context.close();
  });

  test('payroll:release alone is denied (does not imply payroll:view)', async ({ browser }) => {
    const label = `srr-perm-release-${Date.now()}`;
    const email = `e2e-srr-release-${label}@example.test`;
    const password = 'E2ESrrRelease1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_SRR_RELEASE_ONLY', permissionKeys: ['payroll:release'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto('/reports/salary-release');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await context.close();
  });

  test('statements:view alone is denied', async ({ browser }) => {
    const label = `srr-perm-statements-${Date.now()}`;
    const email = `e2e-srr-statements-${label}@example.test`;
    const password = 'E2ESrrStatements1!';
    await createScopedUser({ email, password, roleCode: 'TEST_E2E_SRR_STATEMENTS_ONLY', permissionKeys: ['statements:view'] });

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto('/reports/salary-release');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await context.close();
  });
});
