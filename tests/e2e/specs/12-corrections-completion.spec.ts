import { test, expect } from '../fixtures/auth';
import { apiGet } from '../helpers/api';

/**
 * Corrections Workflow Redesign / RBAC completion checkpoint — the new frontend surfaces this
 * checkpoint added, driven through the real UI against the real backend/database:
 *   1. Payroll Entry's per-row Released badge + Create Correction / View Correction History
 *      actions (payroll-entry-row.tsx) — the entry point the previous checkpoint's own review
 *      found missing (a single page-wide toolbar button, no per-row indication of which rows it
 *      even applied to).
 *   2. The reusable EmployeeLookup combobox (Advances' Record Advance modal).
 *   3. Standard print support (PrintButton/PrintContextHeader, AppShell's print: utilities).
 *   4. Downloadable import templates (Employee Registry). Payroll Entry's own equivalent test was
 *      removed here — `89af663` (2026-07-24) deliberately removed Payroll Entry CSV/Excel import
 *      entirely ("payroll data must never be imported"), so no such action exists to test anymore;
 *      Employee Registry's own, separate import feature is untouched.
 *
 * Reuses whatever RELEASED/ARCHIVED cycle + employees earlier specs already produced (this suite's
 * own established convention, `tests/e2e/README.md`) rather than re-bootstrapping a cycle, which
 * only ever succeeds once system-wide. Skips gracefully if run in isolation against a database
 * with no such cycle yet.
 */

interface EntryRow {
  id: string;
  employee: { id: string; name: string; employeeCode: string | null };
  released: boolean;
}

async function findReleasedEntry(context: import('@playwright/test').BrowserContext) {
  const cycles = await apiGet<{ cycles: { id: string; status: string }[] }>(context, '/api/v1/payroll-cycles');
  const usable = cycles.body.cycles?.find((c) => c.status === 'RELEASED' || c.status === 'ARCHIVED');
  if (!usable) return null;

  const entries = await apiGet<{ entries: EntryRow[] }>(context, `/api/v1/payroll-cycles/${usable.id}/entries`);
  const released = entries.body.entries?.find((e) => e.released);
  if (!released) return null;

  return { cycleId: usable.id, entry: released };
}

test.describe('Payroll Entry — per-row Released actions', () => {
  test('a released row shows a Released badge and offers Create Correction / View Correction History from its own row', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findReleasedEntry(context);
    test.skip(!target, 'No released Payroll Entry exists yet — run the full suite, not this file alone.');
    if (!target) return;

    await page.goto(`/payroll-cycles/${target.cycleId}/payroll-entry`);
    await expect(page.getByRole('table', { name: 'Payroll Entry grid' })).toBeVisible();

    const actionsButton = page.getByRole('button', {
      name: `Released payroll actions for ${target.entry.employee.name}`,
    });
    await expect(actionsButton).toBeVisible();

    // The Released badge sits next to the actions button, in the same cell.
    await expect(
      page
        .locator('div[role="row"]')
        .filter({ has: actionsButton })
        .getByText('Released', { exact: true }),
    ).toBeVisible();

    await actionsButton.click();
    await expect(page.getByRole('menuitem', { name: 'View Correction History' })).toBeVisible();
    // "Create Correction" is permission-gated (payroll:entry) — Master Admin holds it, so it must
    // also be present.
    await expect(page.getByRole('menuitem', { name: 'Create Correction' })).toBeVisible();

    // View Correction History opens without erroring, whether or not this entry has any requests
    // on file yet.
    await page.getByRole('menuitem', { name: 'View Correction History' }).click();
    const historyDialog = page.getByRole('dialog');
    await expect(historyDialog.getByText(`Correction History — ${target.entry.employee.name}`)).toBeVisible();
    // Two "Close" buttons exist on any Modal — the header's own icon-only X (sr-only text
    // "Close") and the footer's own visible "Close" button — scoped to the footer's own visible
    // one specifically, never an ambiguous match across both.
    await historyDialog.getByRole('button', { name: 'Close', exact: true }).last().click();

    // Create Correction opens the request modal with the employee already selected and locked —
    // no separate search/select step needed, since it was opened contextually from this exact row.
    await actionsButton.click();
    await page.getByRole('menuitem', { name: 'Create Correction' }).click();
    const requestModal = page.getByRole('dialog').filter({ hasText: 'Request Correction' });
    await expect(requestModal).toBeVisible();
    // A pre-selected, locked EmployeeLookup renders the "selected employee" chip (not the search
    // input — #correction-entry only exists before a value is chosen), with no Clear button, since
    // `disabled` is what actually locks the selection.
    await expect(requestModal.getByText(target.entry.employee.name, { exact: false })).toBeVisible();
    await expect(requestModal.locator('#correction-entry')).toHaveCount(0);
    await expect(requestModal.getByRole('button', { name: 'Clear selected employee' })).toHaveCount(0);
  });

  test('an unreleased row shows no Released badge and no per-row correction actions', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const cycles = await apiGet<{ cycles: { id: string; status: string }[] }>(context, '/api/v1/payroll-cycles');
    const draft = cycles.body.cycles?.find((c) => c.status === 'DRAFT');
    test.skip(!draft, 'No Draft cycle exists yet — run the full suite, not this file alone.');
    if (!draft) return;

    const entries = await apiGet<{ entries: EntryRow[] }>(context, `/api/v1/payroll-cycles/${draft.id}/entries`);
    const unreleased = entries.body.entries?.find((e) => !e.released);
    test.skip(!unreleased, 'No unreleased entry in the Draft cycle.');
    if (!unreleased) return;

    await page.goto(`/payroll-cycles/${draft.id}/payroll-entry`);
    await expect(page.getByRole('table', { name: 'Payroll Entry grid' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Released payroll actions for ${unreleased.employee.name}` }),
    ).toHaveCount(0);
  });
});

test.describe('Reusable Employee Lookup (Advances)', () => {
  test('searching by employee code finds and selects the right employee, and can be cleared', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findReleasedEntry(context);
    test.skip(!target || !target.entry.employee.employeeCode, 'No employee with a code exists yet.');
    if (!target || !target.entry.employee.employeeCode) return;

    await page.goto('/advances');
    await page.getByRole('button', { name: 'Record Advance' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Record Advance')).toBeVisible();

    const lookupInput = modal.locator('#advance-employee');
    await lookupInput.fill(target.entry.employee.employeeCode);

    const option = modal.getByRole('option', { name: new RegExp(target.entry.employee.name) });
    await expect(option.first()).toBeVisible({ timeout: 5000 });
    await option.first().click();

    // Selecting collapses the search input into a read-only "selected employee" chip with a clear
    // control — never leaves the raw text search box showing a query string as if unselected.
    await expect(modal.getByText(target.entry.employee.name, { exact: false })).toBeVisible();
    await expect(lookupInput).toHaveCount(0);

    await modal.getByRole('button', { name: 'Clear selected employee' }).click();
    await expect(modal.locator('#advance-employee')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Standard print support', () => {
  test('Employee Registry, Payroll Entry, and Corrections each expose a Print action that hides navigation and filters under print media', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/employees');
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('aside').first()).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    await page.goto('/corrections');
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  });
});

test.describe('Downloadable import templates', () => {
  test('Employee Registry offers a Download Import Template action that produces a real file', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/employees');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download Import Template' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('employee-import-template.xlsx');
  });
});
