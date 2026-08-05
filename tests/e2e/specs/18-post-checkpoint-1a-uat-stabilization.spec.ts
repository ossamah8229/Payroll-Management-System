import { test, expect } from '../fixtures/auth';
import { apiPost } from '../helpers/api';

/**
 * Post-Checkpoint-1A UAT Stabilization — real-browser verification of the two remaining reported
 * defects that need interactive/live-editing coverage (the sticky-header containment fix is
 * covered by `06-ui-regression.spec.ts` instead, alongside its own existing "no document-level
 * scroll" test):
 *
 * 1. EOBI totals must reflect the effective deduction (`eobiApplicable ? eobiAmount : 0`), never a
 *    raw `eobiAmount` sum — and the new Bulk Apply "EOBI Amount" control must update every matched
 *    entry's *amount* only, never `eobiApplicable`.
 * 2. The Project Site create form must always open blank — including "Add another," close→reopen
 *    Create, and close→Edit→close→Create — never retaining a previously typed or just-created
 *    site's values. The Edit path must continue loading the selected site's real values.
 */

async function createSiteWithUnit(context: import('@playwright/test').BrowserContext, label: string) {
  const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E ${label}` });
  const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
    name: `E2E ${label} Unit`,
  });
  return { siteId: site.site.id, unitId: unit.unit.id };
}

test.describe('Payroll Entry — EOBI effective-deduction total and bulk amount apply', () => {
  test('footer sums only eobiApplicable rows; bulk-changing the amount updates every matched row without touching applicability; disabled rows still contribute zero', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `eobi-uat-${Date.now()}`;
    const { siteId, unitId } = await createSiteWithUnit(context, label);

    // Three employees: two EOBI-applicable, one not — mirrors the required "mixed applicable/
    // non-applicable rows" scenario.
    const employeeA = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E EOBI Applicable A ${label}`,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '30000',
      defaultEobiApplicable: true,
    });
    const employeeB = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E EOBI Disabled B ${label}`,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '30000',
      defaultEobiApplicable: false,
    });
    const employeeC = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
      name: `E2E EOBI Applicable C ${label}`,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '30000',
      defaultEobiApplicable: true,
    });
    void employeeA;
    void employeeB;
    void employeeC;

    await apiPost(context, '/api/v1/payroll-cycles', { year: 2900, month: 5 }).catch(() => undefined);

    await page.goto('/payroll-entry');
    await expect(page.getByRole('table', { name: 'Payroll Entry grid' })).toBeVisible();

    // Scope the grid to this test's own site so the footer total is exact, not polluted by any
    // other site's employees.
    await page.locator('#payroll-entry-site-filter').click();
    await page.getByRole('menuitemcheckbox', { name: `E2E ${label}` }).click();
    await page.keyboard.press('Escape');

    const eobiFooterCell = page.locator('[data-col-id="eobiAmount"]').last();

    // Default state: two applicable rows at the schema default (400 each) = 800; the disabled
    // row's own 400 must not appear anywhere in this total.
    await expect(eobiFooterCell).toHaveText('PKR 800.00');

    // Bulk-apply a new EOBI amount (statutory change) across the whole filtered population.
    await page.locator('#bulk-eobiAmount').fill('550');
    // `#bulk-eobiAmount` and its own "Copy to All" button are siblings two levels up (the input's
    // own label+control wrapper, then the field's outer `flex items-end` group — `copy-to-all-
    // toolbar.tsx`) — scoping to that group is what selects *this* field's own button, not Cycle
    // Days/OT Rate/Leave Rate's.
    const bulkGroup = page.locator('#bulk-eobiAmount').locator('../..');
    await bulkGroup.getByRole('button', { name: 'Copy to All' }).click();
    await expect(page.getByText(/Applied to 3 of 3 employee/)).toBeVisible();

    // Every matched row (applicable or not) received the new amount, but only the applicable rows
    // contribute — 550 + 550 = 1,100, never 1,650.
    await expect(eobiFooterCell).toHaveText('PKR 1,100.00');

    // The disabled row's own EOBI Amount cell shows the new amount was in fact applied to it too
    // (ready for later use), while its own row contributes zero to the total above.
    const disabledRow = page.getByRole('row', { name: new RegExp(`E2E EOBI Disabled B ${label}`) });
    await expect(disabledRow.locator('[data-col-id="eobiAmount"] input')).toHaveValue('550');
    const disabledToggle = disabledRow.locator('[data-col-id="eobiApplicable"] button');
    await expect(disabledToggle).toHaveAttribute('aria-checked', 'false');

    // Toggling an applicable row off updates the footer immediately, with no reload.
    const applicableRowA = page.getByRole('row', { name: new RegExp(`E2E EOBI Applicable A ${label}`) });
    await applicableRowA.locator('[data-col-id="eobiApplicable"] button').click();
    await expect(eobiFooterCell).toHaveText('PKR 550.00');
  });
});

test.describe('Project Sites — create-form reset lifecycle', () => {
  test('Add another opens blank; close/reopen Create opens blank; close→Edit→close→Create opens blank; Edit still loads real values', async ({
    authenticatedPage: page,
  }) => {
    const label = `sites-uat-${Date.now()}`;
    const firstSiteName = `E2E Sites UAT Alpha ${label}`;
    const secondSiteName = `E2E Sites UAT Beta ${label}`;

    await page.goto('/sites');

    // Create the first site with "Add another" checked.
    await page.getByRole('button', { name: 'New Site' }).click();
    await page.locator('#site-name').fill(firstSiteName);
    await page.locator('#site-unit-label').fill('Department');
    await page.locator('#site-address').fill('100 Alpha Street');
    await page.getByText('Add another after this one').click();
    await page.getByRole('button', { name: /Create & add another/ }).click();
    await expect(page.getByText('Site created — form cleared for the next one')).toBeVisible();

    // Every field must be blank/default now — never the just-created site's values.
    await expect(page.locator('#site-name')).toHaveValue('');
    await expect(page.locator('#site-unit-label')).toHaveValue('Branch');
    await expect(page.locator('#site-address')).toHaveValue('');

    // Create a second site, this time closing normally (no "Add another").
    await page.locator('#site-name').fill(secondSiteName);
    await page.getByText('Add another after this one').click(); // uncheck
    await page.getByRole('button', { name: 'Create site', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Reopen "New Site" — must be blank, never Beta's values.
    await page.getByRole('button', { name: 'New Site' }).click();
    await expect(page.locator('#site-name')).toHaveValue('');
    await expect(page.locator('#site-unit-label')).toHaveValue('Branch');
    await expect(page.locator('#site-address')).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Edit the first site — must load its own real values.
    const row = page.getByRole('row', { name: firstSiteName });
    await row.getByRole('button', { name: /actions for/i }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#site-name')).toHaveValue(firstSiteName);
    await expect(page.locator('#site-unit-label')).toHaveValue('Department');
    await expect(page.locator('#site-address')).toHaveValue('100 Alpha Street');

    // Close Edit, then open Create again — must be blank, never Alpha's edited-session values.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'New Site' }).click();
    await expect(page.locator('#site-name')).toHaveValue('');
    await expect(page.locator('#site-unit-label')).toHaveValue('Branch');
    await expect(page.locator('#site-address')).toHaveValue('');
  });
});
