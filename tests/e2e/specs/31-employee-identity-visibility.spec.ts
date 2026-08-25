import { test, expect } from '../fixtures/auth';
import { apiPost } from '../helpers/api';

/** Visual UAT evidence (Step 7, v1.0.1 Checkpoint 1) — explicit screenshots at the harness's own
 * realistic desktop viewport (1280x720, `playwright.config.ts`), saved outside the default
 * only-on-failure `test-results/` location so they exist regardless of pass/fail and are easy to
 * retrieve for manual review. */
const UAT_SCREENSHOT_DIR =
  '/private/tmp/claude-501/-Users-ossamahsuhail-Documents-Payroll-Management-System/8bf23d90-d11b-419c-ad91-7a1815ea1fdd/scratchpad/uat-screenshots';

/**
 * Employee Identity Visibility (v1.0.1 Checkpoint 1, 2026-08-25).
 *
 * Two employees can legitimately share a name (e.g. two "Muhammad Talha"s) — before this
 * checkpoint, distinguishing them in the operational grids (Payroll Entry, Advances, Employee
 * Registry) required opening each one's own detail page. `Employee Code`/`Father Name`/`CNIC` are
 * canonical `Employee` fields (already fetched by every one of these screens' existing queries —
 * see this checkpoint's own data-path audit in `docs/PROJECT_PROGRESS.md`), now rendered directly
 * in all three grids. These tests create two same-named, distinctly-identified employees through
 * the real backend API (never hand-written SQL, never a production database) and prove each is
 * independently identifiable in the real running app, in a real Chromium instance.
 */

async function createSiteAndUnit(context: import('@playwright/test').BrowserContext, label: string) {
  const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E ${label}` });
  const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
    name: `E2E ${label} Unit`,
  });
  return { siteId: site.site.id, unitId: unit.unit.id };
}

async function filterToSite(page: import('@playwright/test').Page, locatorId: string, siteLabel: string) {
  await page.locator(`#${locatorId}`).click();
  await page.getByRole('menuitemcheckbox', { name: siteLabel }).click();
  await page.keyboard.press('Escape');
}

/** Two distinct, valid, exactly-13-digit synthetic CNICs, unique per test run — derived from the
 * current epoch millis (already 13 digits at this application's current date) rather than a
 * hand-picked literal, so parallel/repeated runs never collide (`shared/src/schemas/employee.ts`'s
 * `cnic: z.string().regex(/^\d{13}$/)`). */
function syntheticCnics(): [string, string] {
  const base = Date.now() % 10_000_000_000_000;
  const a = base.toString().padStart(13, '0');
  const b = ((base + 1) % 10_000_000_000_000).toString().padStart(13, '0');
  return [a, b];
}

test.describe('Employee Identity Visibility — duplicate-name distinguishability (v1.0.1 Checkpoint 1)', () => {
  test('two same-named employees (Muhammad Talha) are independently identifiable by Code/Father Name/CNIC in Payroll Entry, Advances, and Employee Registry', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2903, month: 1 }).catch(() => undefined);
    const label = `IdentityViz ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const [cnicA, cnicB] = syntheticCnics();
    const sharedName = 'Muhammad Talha';
    const codeA = `EMP-${Date.now()}-A`;
    const codeB = `EMP-${Date.now()}-B`;

    const employeeA = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: sharedName,
      employeeCode: codeA,
      fatherName: 'Abdul Rehman',
      cnic: cnicA,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '35000',
    });
    const employeeB = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: sharedName,
      employeeCode: codeB,
      fatherName: 'Muhammad Farooq',
      cnic: cnicB,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '38000',
    });

    // --- Payroll Entry -----------------------------------------------------------------------
    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, 'payroll-entry-site-filter', `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(sharedName).first()).toBeVisible({ timeout: 5000 });

    const peCodeCells = await grid.locator('[data-col-id="employeeCode"][role="cell"]').allTextContents();
    const peFatherCells = await grid.locator('[data-col-id="fatherName"][role="cell"]').allTextContents();
    const peCnicCells = await grid.locator('[data-col-id="cnic"][role="cell"]').allTextContents();
    expect(peCodeCells).toEqual(expect.arrayContaining([codeA, codeB]));
    expect(peFatherCells).toEqual(expect.arrayContaining(['Abdul Rehman', 'Muhammad Farooq']));
    expect(peCnicCells).toEqual(expect.arrayContaining([cnicA, cnicB]));
    await page.screenshot({ path: `${UAT_SCREENSHOT_DIR}/01-payroll-entry-identity-block.png` });

    // Both rows are frozen-left sticky, exactly like the original Code/Employee pair. Scroll well
    // right and confirm the pane (now four columns) stays visually pinned, with no overlap/clipping.
    await grid.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(150);
    const fatherHeaderBox = await page.locator('[data-col-id="fatherName"][role="columnheader"]').boundingBox();
    const cnicHeaderBox = await page.locator('[data-col-id="cnic"][role="columnheader"]').boundingBox();
    expect(fatherHeaderBox).not.toBeNull();
    expect(cnicHeaderBox).not.toBeNull();
    // No overlap between adjacent frozen cells at the extreme scroll position.
    expect(fatherHeaderBox!.x + fatherHeaderBox!.width).toBeLessThanOrEqual(cnicHeaderBox!.x + 1);
    await expect(grid.getByText(sharedName).first()).toBeVisible();
    await page.screenshot({ path: `${UAT_SCREENSHOT_DIR}/02-payroll-entry-scrolled-identity-pinned.png` });
    await grid.evaluate((el) => {
      el.scrollLeft = 0;
    });

    // --- Advances ------------------------------------------------------------------------------
    const today = new Date().toISOString().slice(0, 10);
    await apiPost(context, '/api/v1/advances', {
      employeeId: employeeA.employee.id,
      type: 'LOAN',
      totalAmount: '5000',
      dateGiven: today,
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2903, month: 1 },
    });
    await apiPost(context, '/api/v1/advances', {
      employeeId: employeeB.employee.id,
      type: 'LOAN',
      totalAmount: '7000',
      dateGiven: today,
      repaymentType: 'FULL_DEDUCTION',
      originalPeriod: { year: 2903, month: 1 },
    });

    await page.goto('/advances');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, 'advances-site-filter', `E2E ${label}`);

    const advancesTable = page.locator('table');
    await expect(advancesTable.getByText(sharedName).first()).toBeVisible({ timeout: 5000 });
    const advRows = advancesTable.locator('tbody tr');
    await expect(advRows).toHaveCount(2);
    const advRowTexts = await advRows.allTextContents();
    // Each row carries its own Code + Father Name + CNIC alongside the shared name — genuinely
    // distinguishable by reading the row, not by any secondary lookup.
    expect(advRowTexts.some((t) => t.includes(codeA) && t.includes('Abdul Rehman') && t.includes(cnicA))).toBe(true);
    expect(advRowTexts.some((t) => t.includes(codeB) && t.includes('Muhammad Farooq') && t.includes(cnicB))).toBe(true);
    await page.screenshot({ path: `${UAT_SCREENSHOT_DIR}/03-advances-identity-columns.png` });

    // --- Employee Registry -----------------------------------------------------------------------
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    await page.locator('#filter-search').fill(label);
    await page.waitForLoadState('networkidle');

    const registryTable = page.locator('table');
    await expect(registryTable.getByText(sharedName).first()).toBeVisible({ timeout: 5000 });
    const regRows = registryTable.locator('tbody tr').filter({ hasText: sharedName });
    await expect(regRows).toHaveCount(2);
    const regRowTexts = await regRows.allTextContents();
    expect(regRowTexts.some((t) => t.includes(codeA) && t.includes('Abdul Rehman') && t.includes(cnicA))).toBe(true);
    expect(regRowTexts.some((t) => t.includes(codeB) && t.includes('Muhammad Farooq') && t.includes(cnicB))).toBe(true);
    await page.screenshot({ path: `${UAT_SCREENSHOT_DIR}/04-employee-registry-identity-columns.png` });
  });

  test('a same-named employee with no Father Name on record shows the established "—" empty-value convention in Payroll Entry, never a blank or broken cell', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2903, month: 2 }).catch(() => undefined);
    const label = `IdentityVizEmpty ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E IdentityViz Empty ${Date.now()}`;

    // fatherName/cnic both omitted — optional per `employeeObjectSchema`.
    await apiPost(context, '/api/v1/employees', {
      name: employeeName,
      employeeCode: `EMP-${Date.now()}-N`,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '30000',
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, 'payroll-entry-site-filter', `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    const fatherCell = grid.locator('[data-col-id="fatherName"][role="cell"]').first();
    const cnicCell = grid.locator('[data-col-id="cnic"][role="cell"]').first();
    await expect(fatherCell).toHaveText('—');
    await expect(cnicCell).toHaveText('—');
  });
});
