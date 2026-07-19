import { test, expect, login } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createScopedUser } from '../helpers/create-scoped-user';

/**
 * Phase 6 Checkpoint 6 — the Corrections frontend workflow, driven through the real UI against the
 * real backend/database. Reuses the ARCHIVED cycle + employee `02-payroll-lifecycle.spec.ts`
 * already produced (this suite's own established convention — "later specs deliberately reuse
 * earlier specs' created data when possible," `tests/e2e/README.md`) rather than re-bootstrapping a
 * second `PayrollCycle` from scratch, which only ever succeeds once system-wide. Skips gracefully
 * if run in isolation against a database with no such cycle yet.
 *
 * Scenario 6 (Phase 6 Checkpoint 6A) adds the one real-browser gap that checkpoint closed: a
 * reviewer holding only `corrections:approve` (no `payroll:entry`) must be able to discover and
 * use Corrections through normal sidebar navigation, not just direct URL access. It runs against
 * its own dedicated user (`createScopedUser`) in a second browser context, independent of the
 * Master-Admin `authenticatedPage` fixture every other scenario in this file uses.
 *
 * Scenario 4 (Phase 6 Checkpoint 7) now continues past the reservation/blocked-standalone-payment
 * assertion to release the new Draft cycle's own Unit — the exact moment
 * `releaseProjectUnit`'s new release-time consumption realizes the reservation as a genuine
 * `BalanceAdjustmentSettlement` and flips the `BalanceAdjustmentMaterialization` `ACTIVE ->
 * CONSUMED`. This is the first point in this suite's history the full PAYABLE lifecycle can reach
 * `SETTLED` at all — no prior checkpoint's frontend had any way to observe it, since nothing ever
 * consumed a Draft-cycle reservation before this checkpoint.
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

  return { cycleId: archived.id, entryId: entry.id, siteId: entry.siteId, siteName: entry.site.name };
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
    const balanceAdjustmentUrl = page.url();

    // --- Phase 6 Checkpoint 7: PAYABLE lifecycle to payroll completion ---
    // Releasing the same site's Unit in this new Draft cycle is the exact moment
    // `releaseProjectUnit` consumes the ACTIVE reservation above — the loop this checkpoint closes.
    // No prior checkpoint's frontend could ever reach this state (nothing settled a materialized
    // obligation), so this is the first time the full lifecycle is provably observable end to end.
    const cyclesAfterRollover = await apiGet<{ cycles: PayrollCycleRow[] }>(context, '/api/v1/payroll-cycles');
    const newDraft = cyclesAfterRollover.body.cycles?.find((c) => c.status === 'DRAFT');
    test.skip(!newDraft, 'No new Draft cycle from rollover — run the full suite, not this file alone.');
    if (!newDraft) return;

    await page.goto(`/payroll-cycles/${newDraft.id}/release`);
    await page.locator('#salary-release-site').selectOption({ label: target.siteName });
    await page.getByRole('button', { name: 'Release', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Release Unit' }).click();
    await expect(page.getByText('Released', { exact: true })).toBeVisible();

    // Back on the same BalanceAdjustment detail page: SETTLED, no more Record Settlement action,
    // the reservation realized as a genuine settlement row.
    await page.goto(balanceAdjustmentUrl);
    await expect(page.getByText('SETTLED', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record Settlement' })).toHaveCount(0);
    await expect(page.getByText('Settlement History')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Cycle-Scoped Settlement' })).toBeVisible();
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

    // Exact match — a case-insensitive substring match on 'REJECTED' also matches the transient
    // "Correction request rejected" success toast, a strict-mode ambiguity independent of this
    // checkpoint's own permission-navigation fix.
    await expect(page.getByText('REJECTED', { exact: true })).toBeVisible();
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

  test('Scenario 6 — reviewer-only navigation: corrections:approve without payroll:entry (Phase 6 Checkpoint 6A)', async ({
    browser,
    authenticatedPage: adminPage,
  }) => {
    const adminContext = adminPage.context();
    const target = await findCorrectableEntry(adminContext);
    test.skip(!target, 'No Archived cycle with an entry exists yet — run the full suite, not this file alone.');
    if (!target) return;

    // A fresh PENDING correction request for the reviewer to act on — created here (as Master
    // Admin, who holds payroll:entry) rather than reused from an earlier scenario, since every
    // earlier scenario in this file already resolves its own request to APPROVED or REJECTED.
    const adjustmentTypes = await apiGet<{ adjustmentTypes: { id: string }[] }>(adminContext, '/api/v1/adjustment-types');
    const adjustmentTypeId = adjustmentTypes.body.adjustmentTypes[0]!.id;
    await apiPost(adminContext, `/api/v1/payroll-entries/${target.entryId}/correction-requests`, {
      field: 'ALLOWANCE',
      proposedNewValue: '750',
      adjustmentTypeId,
      reason: 'E2E: Checkpoint 6A reviewer-only navigation coverage',
    });

    // A user holding only corrections:approve — no payroll:entry — has no seeded role
    // (MASTER_ADMIN/PAYROLL_STAFF/FINANCE) that matches, so this is created directly against the
    // database rather than through POST /api/v1/users (see create-scoped-user.ts's own comment).
    // Login itself still goes through the real form below, same as every other spec. Site-scoped
    // like every non-Master-Admin role (`corrections.service.ts`'s `listCorrectionRequestsForUser`
    // filters by `currentUser.siteIds` for anyone but Master Admin) — assigned to the target
    // entry's own site so the Review Queue it should be authorized to see isn't empty simply for
    // lack of a site assignment, the same requirement a Payroll Staff/Finance test user has.
    const email = `e2e-corrections-reviewer-${Date.now()}@example.test`;
    const password = 'ReviewerOnlyPassword1!';
    await createScopedUser({
      email,
      password,
      roleCode: 'E2E_CORRECTIONS_REVIEWER',
      permissionKeys: ['corrections:approve'],
      siteIds: [target.siteId],
      name: 'E2E Corrections Reviewer',
    });

    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    await login(reviewerPage, email, password);

    // 1-2. The Corrections sidebar item is visible and links to /corrections.
    const correctionsLink = reviewerPage.getByRole('link', { name: 'Corrections' });
    await expect(correctionsLink).toBeVisible();
    await correctionsLink.click();
    await expect(reviewerPage).toHaveURL('/corrections');

    // 3. The Corrections route is not rejected by the frontend guard.
    await expect(reviewerPage.getByRole('heading', { name: 'Corrections' })).toBeVisible();
    await expect(reviewerPage.getByText('You do not have access to Corrections')).toHaveCount(0);

    // 4. The Review Queue tab is visible and is the landing tab, showing the request just created.
    await expect(reviewerPage.getByRole('button', { name: 'Review Queue' })).toBeVisible();
    const queueRow = reviewerPage.locator('table tbody tr').first();
    await expect(queueRow).toBeVisible({ timeout: 5000 });

    // 5-6. The reviewer can open the pending request and approve/reject actions are available.
    await queueRow.click();
    await expect(reviewerPage.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(reviewerPage.getByRole('button', { name: 'Reject' })).toBeVisible();

    // 8. Request Correction is absent from this reviewer-only session anywhere in Corrections.
    await expect(reviewerPage.getByRole('button', { name: 'Request Correction' })).toHaveCount(0);

    // 9. Payroll Entry editing remains unavailable — no sidebar link, and the route itself
    // reflects the same access-denied state Payroll Entry's own page renders for an unauthorized
    // permission set (Payroll Entry has no dedicated guard message; absence of the grid + presence
    // of the sidebar gate together are this app's existing unauthorized experience).
    await expect(reviewerPage.getByRole('link', { name: 'Payroll Entry' })).toHaveCount(0);

    // 10. Direct navigation behaves the same as sidebar navigation.
    await reviewerPage.goto('/corrections');
    await expect(reviewerPage.getByRole('heading', { name: 'Corrections' })).toBeVisible();
    await expect(reviewerPage.getByRole('button', { name: 'Review Queue' })).toBeVisible();

    await reviewerContext.close();
  });
});
