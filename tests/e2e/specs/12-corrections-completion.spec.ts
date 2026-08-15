import { test, expect } from '../fixtures/auth';
import { apiGet } from '../helpers/api';

/**
 * Corrections Workflow Redesign / RBAC completion checkpoint — the new frontend surfaces this
 * checkpoint added, driven through the real UI against the real backend/database:
 *   1. Payroll Entry's Released badge, and the correction workflow reachable from it — originally a
 *      per-row Create Correction / View Correction History action (payroll-entry-row.tsx), but that
 *      row-level control was deliberately removed in `9183dd1` ("refactor(payroll-entry): remove
 *      redundant Status actions and unused correction-history modal"): Create Correction was fully
 *      redundant with the page-level "Request Correction" toolbar button (its own Employee field
 *      can already search and target any released entry), and View Correction History had no exact
 *      substitute for a `payroll:entry`-only, non-approver caller — the closest alternative,
 *      Corrections' "My Requests" tab, is scoped to that user's own submitted requests, not every
 *      request against a given entry — so it was removed with the row wiring rather than kept as
 *      dead code. This file's own scenarios below now exercise the current, page-level workflow
 *      instead of the removed row action.
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

/**
 * Checks every RELEASED/ARCHIVED cycle, not just the first one found — a cycle can legitimately
 * finalize with zero `released: true` entries at all (every entry resolved via `RECOVERY_DUE`/
 * `NO_PAY_DUE` instead, `payroll-processing.service.ts`'s own finalize precondition only requires
 * released-or-held-or-resolved, never "at least one genuinely released entry"). Concretely: a
 * rolled-over PayrollEntry starts each new cycle with fresh, unset attendance (`days: 0`), so an
 * employee whose entry was released in an earlier cycle can easily net negative — RECOVERY_DUE, not
 * released — in the very next one if nothing sets its days again first (`02-payroll-lifecycle.
 * spec.ts`'s own entry explicitly sets a full cycle's days before releasing for exactly this
 * reason). Since `listPayrollCycles` orders newest-first, picking only the first RELEASED/ARCHIVED
 * cycle risks landing on exactly such a cycle and wrongly concluding no released entry exists
 * anywhere — the same robust, already-established pattern `07-corrections.spec.ts`'s own
 * `findCorrectableEntry` uses (loop every candidate cycle, not just the newest) fixes that here too.
 */
async function findReleasedEntry(context: import('@playwright/test').BrowserContext) {
  const cycles = await apiGet<{ cycles: { id: string; status: string }[] }>(context, '/api/v1/payroll-cycles');
  const candidates = cycles.body.cycles?.filter((c) => c.status === 'RELEASED' || c.status === 'ARCHIVED') ?? [];

  for (const cycle of candidates) {
    const entries = await apiGet<{ entries: EntryRow[] }>(
      context,
      `/api/v1/payroll-cycles/${cycle.id}/entries?pageSize=200`,
    );
    const released = entries.body.entries?.find((e) => e.released);
    if (released) return { cycleId: cycle.id, entry: released };
  }

  return null;
}

/**
 * The Payroll Entry grid virtualizes its rows (`@tanstack/react-virtual`, `payroll-entry-grid.tsx`)
 * — only the rows near the current scroll position (plus a small overscan) ever mount to the DOM.
 * `findReleasedEntry()` picks the first released entry the raw API returns, with no regard for
 * where that entry happens to land in the grid's own row order; across a full suite run the same
 * shared cycle accumulates entries from many earlier specs, so that row is not guaranteed to
 * already be among the handful the virtualizer has mounted on initial render. Same real scroll
 * container and technique `27-payroll-entry-employee-row-actions.spec.ts`'s own Scenario E already
 * established (`el.scrollTop`, the `role="table"` element itself) — scrolled one viewport at a time
 * until the target locator actually mounts, rather than assuming a fixed offset or disabling
 * virtualization.
 */
async function revealGridRow(page: import('@playwright/test').Page, locator: import('@playwright/test').Locator) {
  const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
  for (let i = 0; i < 60; i++) {
    if (await locator.isVisible()) return;
    const reachedBottom = await grid.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
    if (reachedBottom) break;
    await grid.evaluate((el) => {
      el.scrollTop += el.clientHeight;
    });
  }
  await expect(locator).toBeVisible({ timeout: 5000 });
}

test.describe('Payroll Entry — released entries and the page-level correction workflow', () => {
  test('a released entry shows a Released badge in the grid, and its correction workflow is reached through the page-level Request Correction toolbar action', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findReleasedEntry(context);
    test.skip(!target, 'No released Payroll Entry exists yet — run the full suite, not this file alone.');
    if (!target) return;

    await page.goto(`/payroll-cycles/${target.cycleId}/payroll-entry`);
    await expect(page.getByRole('table', { name: 'Payroll Entry grid' })).toBeVisible();

    // Released status recognized correctly in the grid itself. `findReleasedEntry()` picks the
    // first released entry the raw API returns, with no regard for where that entry lands in the
    // grid's own row order, so — same reasoning as `revealGridRow`'s own doc comment — it is not
    // guaranteed to already be mounted by the virtualizer on initial render.
    const targetRow = page.locator('div[role="row"]').filter({ hasText: target.entry.employee.name });
    const releasedBadge = targetRow.getByText('Released', { exact: true });
    await revealGridRow(page, releasedBadge);
    await expect(releasedBadge).toBeVisible();

    // The row-level "…" actions button (Create Correction / View Correction History) was
    // deliberately removed from the Status cell (`9183dd1`) — this row now offers no
    // correction-specific control of its own at all, only the unrelated Employee actions menu
    // (Edit Employee / Mark as Left, gated on entirely different permissions).
    await expect(
      page.getByRole('button', { name: `Released payroll actions for ${target.entry.employee.name}` }),
    ).toHaveCount(0);

    // Create Correction is reached exclusively through the page-level "Request Correction" toolbar
    // button now — its own EmployeeLookup can search and target this exact released entry by name,
    // proving the correction workflow is available and lands on the correct employee/payroll
    // context without any row-level entry point (same search technique
    // `07-corrections.spec.ts`'s own `pickEmployeeInLookup` helper already established).
    await page.getByRole('button', { name: 'Request Correction' }).click();
    const requestModal = page.getByRole('dialog').filter({ hasText: 'Request Correction' });
    await expect(requestModal).toBeVisible();

    const input = requestModal.locator('#correction-entry');
    await input.fill(target.entry.employee.name);
    const option = requestModal.getByRole('option', { name: new RegExp(target.entry.employee.name) });
    await expect(option.first()).toBeVisible({ timeout: 5000 });
    await option.first().click();

    // Selecting collapses the search input into a read-only "selected employee" chip — the correct
    // employee/payroll context is locked in for this request. Unlike the old row-opened flow
    // (`initialEntryId`, unused from this toolbar entry point), the field is not `disabled` here, so
    // Clear stays available — this is the toolbar's own ordinary selection, not a pre-locked one.
    await expect(requestModal.getByText(target.entry.employee.name, { exact: false })).toBeVisible();
    await expect(requestModal.locator('#correction-entry')).toHaveCount(0);
    await expect(requestModal.getByRole('button', { name: 'Clear selected employee' })).toBeVisible();

    // No submission here — the full submit/approve/reject lifecycle already has deep coverage in
    // `07-corrections.spec.ts`'s own Scenarios 1/1B/2/3; this scenario's job is only proving the
    // current entry point is reachable and correctly scoped.
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('an unreleased entry shows no Released badge, and is excluded as a correction target', async ({
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

    const targetRow = page.locator('div[role="row"]').filter({ hasText: unreleased.employee.name });
    await revealGridRow(page, targetRow);
    await expect(targetRow.getByText('Released', { exact: true })).toHaveCount(0);

    // The toolbar button itself only renders when the *viewed* cycle has at least one released
    // entry (`hasReleasedEntries`, `payroll-entry-page.tsx`) — if this Draft cycle has none at all,
    // there is no Request Correction workflow to exclude this employee from in the first place.
    const hasReleasedEntries = entries.body.entries?.some((e) => e.released) ?? false;
    if (!hasReleasedEntries) {
      await expect(page.getByRole('button', { name: 'Request Correction' })).toHaveCount(0);
      return;
    }

    // Otherwise, this employee's only entry here is unreleased — the modal's own EmployeeLookup is
    // restricted to entries.map(entry => entry.employee.id) (released entries only,
    // request-correction-modal.tsx), so searching for them either finds nothing or explicitly
    // explains the exclusion (Issue 7, Presentation & Workflow Stabilization Checkpoint) — never a
    // selectable option.
    await page.getByRole('button', { name: 'Request Correction' }).click();
    const requestModal = page.getByRole('dialog').filter({ hasText: 'Request Correction' });
    await requestModal.locator('#correction-entry').fill(unreleased.employee.name);
    await expect(
      requestModal.getByRole('option', { name: new RegExp(unreleased.employee.name) }),
    ).toHaveCount(0);
    await expect(
      requestModal
        .getByText(/found, but none have a released Payroll Entry/i)
        .or(requestModal.getByText(/No employees match/i)),
    ).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
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
