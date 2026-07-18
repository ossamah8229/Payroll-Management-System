import { test, expect } from '../fixtures/auth';
import { apiGet } from '../helpers/api';

/**
 * Phase 6 Checkpoint 6 — the Corrections frontend workflow, driven through the real UI against the
 * real backend/database. Reuses the ARCHIVED cycle + employee `02-payroll-lifecycle.spec.ts`
 * already produced (this suite's own established convention — "later specs deliberately reuse
 * earlier specs' created data when possible," `tests/e2e/README.md`) rather than re-bootstrapping a
 * second `PayrollCycle` from scratch, which only ever succeeds once system-wide. Skips gracefully
 * if run in isolation against a database with no such cycle yet.
 */

interface PayrollCycleRow {
  id: string;
  status: 'DRAFT' | 'RELEASED' | 'ARCHIVED';
}

interface EntryRow {
  id: string;
  employeeId: string;
  siteId: string;
  site: { id: string; name: string };
}

/** Disambiguates the `PayrollCycleStatusBadge` span from the cycle `<select>`'s own option text
 * that shows the same status word — same technique `02-payroll-lifecycle.spec.ts` uses. */
function statusBadge(page: import('@playwright/test').Page, text: string) {
  return page.locator('span').filter({ hasText: text });
}

async function findCorrectableEntry(context: import('@playwright/test').BrowserContext) {
  const cycles = await apiGet<{ cycles: PayrollCycleRow[] }>(context, '/api/v1/payroll-cycles');
  const archived = cycles.body.cycles?.find((c) => c.status === 'ARCHIVED');
  if (!archived) return null;

  const entries = await apiGet<{ entries: EntryRow[] }>(context, `/api/v1/payroll-cycles/${archived.id}/entries`);
  const entry = entries.body.entries?.[0];
  if (!entry) return null;

  return { cycleId: archived.id, entryId: entry.id, siteName: entry.site.name };
}

test.describe('Corrections workflow', () => {
  test('Scenario 1 — request and approve a PAYABLE correction, source payroll stays read-only', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findCorrectableEntry(context);
    test.skip(!target, 'No Archived cycle with an entry exists yet — run the full suite, not this file alone.');
    if (!target) return;

    // --- 1. Open the Archived Payroll Entry view and request a correction ---
    await page.goto(`/payroll-cycles/${target.cycleId}/payroll-entry`);
    await expect(page.getByText('This cycle is Archived and permanently read-only')).toBeVisible();

    await page.getByRole('button', { name: 'Request Correction' }).click();
    const requestModal = page.getByRole('dialog');
    await expect(requestModal.getByText('Request Correction')).toBeVisible();

    // ALLOWANCE, not GROSS_PAY: this fixture's own work line has `days: 0` (never edited through
    // the UI), and `calcNet`'s own earnedAmount = dailyRate * days — a GROSS_PAY change against a
    // zero-days line moves nothing. ALLOWANCE is a flat addition, unaffected by days.
    await requestModal.locator('#correction-entry').selectOption({ index: 1 });
    await requestModal.locator('#correction-field').selectOption('ALLOWANCE');
    await requestModal.locator('#correction-adjustment-type').selectOption({ index: 1 });
    await requestModal.locator('#correction-proposed-value').fill('5000');
    await requestModal.locator('#correction-reason').fill('E2E: allowance increase');

    // Preview is debounced (400ms) — wait for the classification badge to appear.
    await expect(requestModal.getByTestId('delta-classification')).toHaveText('Payable', { timeout: 5000 });

    await requestModal.getByRole('button', { name: 'Submit Request' }).click();
    await page.waitForURL(/\/corrections\/requests\//);

    // --- 2. Approve it from the request detail page ---
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    const approveModal = page.getByRole('dialog');
    await expect(approveModal.getByText('Fresh Preview')).toBeVisible();
    await approveModal.locator('#approve-payment-timing').selectOption('DEFERRED');
    await approveModal.getByRole('button', { name: 'Approve', exact: true }).click();

    // --- 3. Verify the immutable Correction now shows on the request detail page ---
    await expect(page.getByText('Resulting Correction')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    // --- 4. Source payroll remains read-only — Archived banner still present, unchanged ---
    await page.goto(`/payroll-cycles/${target.cycleId}/payroll-entry`);
    await expect(page.getByText('This cycle is Archived and permanently read-only')).toBeVisible();
  });

  test('Scenario 2 — request and approve a RECOVERY correction, no immediate PayrollEntry mutation', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findCorrectableEntry(context);
    test.skip(!target, 'No Archived cycle with an entry exists yet — run the full suite, not this file alone.');
    if (!target) return;

    // Runs after Scenario 1 in the same file (sequential, workers: 1) — ALLOWANCE's current
    // effective value is already 5000 from that approval, so proposing something lower here
    // produces a negative delta (RECOVERY), not another PAYABLE.
    await page.goto(`/payroll-cycles/${target.cycleId}/payroll-entry`);
    await page.getByRole('button', { name: 'Request Correction' }).click();
    const requestModal = page.getByRole('dialog');
    await requestModal.locator('#correction-entry').selectOption({ index: 1 });
    await requestModal.locator('#correction-field').selectOption('ALLOWANCE');
    await requestModal.locator('#correction-adjustment-type').selectOption({ index: 1 });
    await requestModal.locator('#correction-proposed-value').fill('0');
    await requestModal.locator('#correction-reason').fill('E2E: allowance overpayment recovery');
    await expect(requestModal.getByTestId('delta-classification')).toHaveText('Recovery', { timeout: 5000 });
    await requestModal.getByRole('button', { name: 'Submit Request' }).click();
    await page.waitForURL(/\/corrections\/requests\//);

    await page.getByRole('button', { name: 'Approve' }).click();
    const approveModal = page.getByRole('dialog');
    await expect(approveModal.getByText('Fresh Preview')).toBeVisible();
    // No payment-timing field for RECOVERY — the installment field is optional and left blank
    // (full recovery next cycle, the documented default).
    await expect(approveModal.locator('#approve-payment-timing')).toHaveCount(0);
    await approveModal.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Resulting Correction')).toBeVisible();

    // Follow the Ledger link this approval produced through to the BalanceAdjustment detail page
    // and confirm nothing has been materialized/settled yet — approval alone never touches any
    // PayrollEntry (Checkpoint 5's own "reservation, not settlement" invariant).
    await page.goto('/corrections');
    await page.getByRole('button', { name: 'Corrections Ledger' }).click();
    await page.getByRole('cell', { name: 'Recovery', exact: true }).first().click();
    await expect(page.getByText('No Draft-cycle reservations yet')).toBeVisible();
    await expect(page.getByText('No settlement recorded yet')).toBeVisible();
  });

  test('Scenario 4 — rollover materializes a reservation; standalone payment is then blocked', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findCorrectableEntry(context);
    const cycles = await apiGet<{ cycles: PayrollCycleRow[] }>(context, '/api/v1/payroll-cycles');
    const draft = cycles.body.cycles?.find((c) => c.status === 'DRAFT');
    test.skip(!draft || !target, 'No Draft cycle / Archived entry exists yet — run the full suite, not this file alone.');
    if (!draft || !target) return;

    // Scenarios 1/2 above left a PENDING DEFERRED-PAYABLE and a PENDING RECOVERY
    // BalanceAdjustment for the same employee, still un-materialized. Rolling over the current
    // Draft cycle (the exact same Release -> Finalize -> Start New Payroll Cycle UI flow
    // `02-payroll-lifecycle.spec.ts` already exercises) fires the automatic Materialization Hook.
    // The Site filter must be pointed at this employee's own site — other specs in the full suite
    // create additional, unrelated sites (some with zero Project Units), and the filter's default
    // selection is not guaranteed to land on the right one.
    await page.goto(`/payroll-cycles/${draft.id}/release`);
    await page.locator('#salary-release-site').selectOption({ label: target.siteName });
    await page.getByRole('button', { name: 'Release', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Release Unit' }).click();
    await expect(page.getByText('Released', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finalize Cycle' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Finalize Cycle' }).click();
    await expect(statusBadge(page, '· Released')).toBeVisible();
    await page.getByRole('button', { name: 'Start New Payroll Cycle' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start New Payroll Cycle' }).click();
    await page.waitForURL((url) => !url.pathname.includes(draft.id));

    // The PAYABLE BalanceAdjustment from Scenario 1 is now reserved into the new Draft cycle.
    await page.goto('/corrections');
    await page.getByRole('button', { name: 'Corrections Ledger' }).click();
    await page.getByRole('cell', { name: 'Payable', exact: true }).first().click();
    await expect(page.getByText('Outstanding Balance')).toBeVisible();
    await expect(page.getByText('Reserved in payroll')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record Settlement' })).toBeVisible();
    await page.getByRole('button', { name: 'Record Settlement' }).click();
    await expect(
      page.getByText('a standalone payment is unavailable until that reservation is resolved'),
    ).toBeVisible();
  });

  test('Scenario 3 — reject a request: no Correction or BalanceAdjustment is created', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findCorrectableEntry(context);
    test.skip(!target, 'No Archived cycle with an entry exists yet — run the full suite, not this file alone.');
    if (!target) return;

    await page.goto(`/payroll-cycles/${target.cycleId}/payroll-entry`);
    await page.getByRole('button', { name: 'Request Correction' }).click();
    const requestModal = page.getByRole('dialog');
    await requestModal.locator('#correction-entry').selectOption({ index: 1 });
    await requestModal.locator('#correction-field').selectOption('ALLOWANCE');
    await requestModal.locator('#correction-adjustment-type').selectOption({ index: 1 });
    await requestModal.locator('#correction-proposed-value').fill('500');
    await requestModal.locator('#correction-reason').fill('E2E: reject path — allowance correction');
    await expect(requestModal.getByTestId('delta-classification')).toBeVisible({ timeout: 5000 });
    await requestModal.getByRole('button', { name: 'Submit Request' }).click();
    await page.waitForURL(/\/corrections\/requests\//);

    await page.getByRole('button', { name: 'Reject' }).click();
    const rejectModal = page.getByRole('dialog');
    await rejectModal.locator('#reject-reason').fill('E2E: rejecting for test coverage');
    await rejectModal.getByRole('button', { name: 'Reject Request' }).click();

    await expect(page.getByText('REJECTED')).toBeVisible();
    await expect(page.getByText('Resulting Correction')).toHaveCount(0);
  });

  test('Scenario 5 — historical navigation from the Corrections Ledger back to source payroll', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const target = await findCorrectableEntry(context);
    test.skip(!target, 'No Archived cycle with an entry exists yet — run the full suite, not this file alone.');
    if (!target) return;

    await page.goto('/corrections');
    await expect(page.getByRole('heading', { name: 'Corrections' })).toBeVisible();
    await page.getByRole('button', { name: 'Corrections Ledger' }).click();
    // Scenario 1 already produced at least one PAYABLE BalanceAdjustment row.
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await firstRow.click();

    await expect(page.getByText('Outstanding Balance')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Corrections' }).click();
    await expect(page.getByRole('heading', { name: 'Corrections' })).toBeVisible();
  });
});
