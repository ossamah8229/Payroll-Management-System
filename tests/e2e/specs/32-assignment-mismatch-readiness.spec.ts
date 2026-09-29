import type { BrowserContext, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPatch, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';
import { createScopedUser } from '../helpers/create-scoped-user';

interface CycleRow {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

/** Mirrors `22-overtime-report.spec.ts`'s own identical helper — this report requires a genuine
 * Draft cycle (never just "any" cycle, unlike `helpers/fixtures.ts`'s own
 * `ensureAnyPayrollCycleExists`), so it is re-derived here rather than reused from a helper whose
 * contract is deliberately looser. */
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

/**
 * Bulk Assignment-Mismatch Readiness Audit (approved 2026-09-28 architecture review) — real-browser
 * verification of the frontend built over the read-only backend
 * (`shared/src/schemas/assignment-mismatch-readiness.ts`, `reports.routes.ts`'s
 * `/assignment-mismatch-readiness` routes). No mocked hooks, no `page.route` interception for any
 * RBAC assertion — real navigation, real backend predicate, real permission enforcement, matching
 * this suite's own established discipline (`22-overtime-report.spec.ts`, `29-variance-report.spec.ts`).
 *
 * **This report is strictly read-only.** No test in this file ever clicks an Apply/sync/mutation
 * control from this page — there is none to click; this suite explicitly asserts that absence.
 * Any actual reconciliation exercised here happens exclusively through the pre-existing, already-
 * covered Payroll Entry grid action (`27-payroll-entry-employee-row-actions.spec.ts`), never from
 * this report.
 *
 * Runs against this harness's own disposable, isolated database
 * (`tests/e2e/setup/e2e-environment.ts`) — never production, never `payroll_dev`/`payroll_manual`.
 */

interface EntryRow {
  id: string;
  employeeId: string;
  version: number;
  siteId: string;
  workLines: { id: string; unitId: string }[];
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

async function openSiteFilterAndSelect(page: Page, siteName: string) {
  await page.locator('#amr-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteName }).click();
  await page.keyboard.press('Escape');
}

/** Every control this read-only report must never render, anywhere on the page — asserted as a
 * single reusable check so every test below proves the same absence rather than each re-deriving
 * its own partial list. */
async function assertNoMutationControls(page: Page) {
  for (const name of [/apply/i, /sync/i, /classify/i, /reconcile/i, /reassign/i]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
}

test.describe('Assignment Mismatch Readiness — Master User', () => {
  test('navigation, Site mismatch, Site filter, no mutation control, pagination, and CSV export', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `amr-${Date.now()}`;
    // Ensures a Draft cycle exists before the fixture employee's own entry auto-creates against
    // it — this test never needs the cycle's own id (only one Draft cycle ever exists at a time).
    await getCurrentDraftCycle(context);
    const { employeeId } = await createSiteWithEmployee(context, label);

    // A second Site the employee transfers to *after* the entry already exists — the frozen
    // no-cascade rule (`docs/architecture/database/payroll-entry.md` §12) means the entry keeps
    // pointing at its original Site, which is exactly the divergence this report exists to surface.
    const siteB = await apiPost<{ site: { id: string; name: string } }>(context, '/api/v1/sites', {
      name: `E2E AMR Site B ${label}`,
    });
    const unitB = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteB.site.id}/units`, {
      name: `E2E AMR Unit B ${label}`,
    });
    await apiPatch(context, `/api/v1/employees/${employeeId}`, { siteId: siteB.site.id, unitId: unitB.unit.id });

    // --- Navigation: Reports catalogue -> Assignment Mismatch Readiness -----------------------
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByText('Assignment Mismatch Readiness')).toBeVisible();
    await page.getByRole('link', { name: /Assignment Mismatch Readiness/ }).click();
    await expect(page).toHaveURL(/\/reports\/assignment-mismatch-readiness$/);

    // --- Site filter narrows to exactly our fixture's one mismatched row ----------------------
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const table = page.getByTestId('amr-table');
    await expect(table.getByText(`E2E Employee ${label}`)).toBeVisible();
    await expect(table.getByText(`E2E Site ${label}`)).toBeVisible();
    await expect(table.getByText(`E2E AMR Site B ${label}`)).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(1);

    // --- Totals -------------------------------------------------------------------------------
    await expect(page.getByTestId('amr-stat-matching').getByText('1')).toBeVisible();

    // --- Strictly read-only: no Apply/sync/mutation control anywhere on this page -------------
    await assertNoMutationControls(page);

    // --- Pagination: server-provided metadata, singular "entry" -------------------------------
    await expect(page.getByText('Showing 1–1 of 1 entry')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

    // --- CSV export: complete filtered dataset, no financial column ---------------------------
    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/assignment-mismatch-readiness.*\.csv$/i);
    const csvPath = await csvDownload.path();
    const csvContent = csvPath ? await readFile(csvPath, 'utf-8') : '';
    expect(csvContent).toContain('Employee Name');
    expect(csvContent).toContain('Payroll Site');
    expect(csvContent).toContain('Current Employee Site');
    expect(csvContent).toContain(`E2E Employee ${label}`);
    expect(csvContent.toLowerCase()).not.toContain('net salary');
    expect(csvContent.toLowerCase()).not.toContain('gross pay');
    expect(csvContent.toLowerCase()).not.toContain('cnic');
  });

  test('a split entry whose primary line matches but a secondary line diverges appears, with Shape: Split', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `amr-split-${Date.now()}`;
    const cycle = await getCurrentDraftCycle(context);
    const { siteId, employeeId } = await createSiteWithEmployee(context, label);
    const entry = await getEntryForEmployee(context, cycle.id, employeeId);

    const secondUnit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${siteId}/units`, {
      name: `E2E AMR Split Second Unit ${label}`,
    });
    await apiPost(context, `/api/v1/payroll-entries/${entry.id}/work-lines`, {
      version: entry.version,
      unitId: secondUnit.unit.id,
      days: '0',
    });

    await page.goto('/reports/assignment-mismatch-readiness');
    await openSiteFilterAndSelect(page, `E2E Site ${label}`);
    const table = page.getByTestId('amr-table');
    await expect(table.getByText(`E2E Employee ${label}`)).toBeVisible();
    // Scoped to this fixture's own row and matched exactly — a bare substring "Split" also hits this
    // fixture's own "E2E AMR Split Second Unit" name in the Payroll Unit(s) cell.
    const row = table.getByRole('row').filter({ hasText: `E2E Employee ${label}` });
    await expect(row.getByRole('cell', { name: 'Split', exact: true })).toBeVisible();
    await assertNoMutationControls(page);
  });
});

test.describe('Assignment Mismatch Readiness — Site scoping', () => {
  test('a site-scoped user sees only their own accessible mismatch; the entry keeps its original Site attribution; no cross-site leak', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const context = adminPage.context();
    const label = `amr-scope-${Date.now()}`;
    await getCurrentDraftCycle(context);

    const { siteId: siteAId, employeeId: employeeAId } = await createSiteWithEmployee(context, `${label}-a`);
    const { employeeId: employeeBId } = await createSiteWithEmployee(context, `${label}-b`);

    // Both employees transfer to a fresh Site elsewhere, each producing a genuine mismatch —
    // entry attribution never cascades, so each entry stays under its own original Site.
    const elsewhere = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', {
      name: `E2E AMR Scope Elsewhere ${label}`,
    });
    const elsewhereUnit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${elsewhere.site.id}/units`, {
      name: `E2E AMR Scope Elsewhere Unit ${label}`,
    });
    await apiPatch(context, `/api/v1/employees/${employeeAId}`, { siteId: elsewhere.site.id, unitId: elsewhereUnit.unit.id });
    await apiPatch(context, `/api/v1/employees/${employeeBId}`, { siteId: elsewhere.site.id, unitId: elsewhereUnit.unit.id });

    const scopedEmail = `e2e-amr-site-a-${label}@example.test`;
    const scopedPassword = 'E2EAmrSiteA1!';
    await createScopedUser({
      email: scopedEmail,
      password: scopedPassword,
      roleCode: 'E2E_AMR_SITE_A_STAFF',
      permissionKeys: ['payroll:entry'],
      siteIds: [siteAId],
      name: 'E2E AMR Site A Staff',
    });

    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await login(scopedPage, scopedEmail, scopedPassword);

    await scopedPage.goto('/reports/assignment-mismatch-readiness');
    const table = scopedPage.getByTestId('amr-table');
    await expect(table.getByText(`E2E Employee ${label}-a`)).toBeVisible();
    await expect(table.getByText(`E2E Employee ${label}-b`)).not.toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(1);

    // Site B is never offered in this user's own Site filter.
    await scopedPage.locator('#amr-site-filter').click();
    await expect(scopedPage.getByRole('menuitemcheckbox', { name: `E2E Site ${label}-b` })).toHaveCount(0);
    await scopedPage.keyboard.press('Escape');

    await assertNoMutationControls(scopedPage);
    await scopedContext.close();
  });
});
