import { test, expect } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';

/**
 * Drives one full Draft -> Released -> Archived(+rollover) payroll cycle through the real UI
 * against the real backend/database — the highest-value end-to-end path in this application.
 * Deliberately does not re-assert every business rule Phase 5's own 500+ backend integration
 * tests already cover (over-release guards, concurrency, audit-entry shape, etc.) — this is a
 * smoke test proving the real stack wires together, not a re-run of that suite.
 *
 * **Owns the one-time cycle bootstrap.** `POST /api/v1/payroll-cycles` only ever succeeds for the
 * very first `PayrollCycle` the whole application creates — every one after that comes only from
 * rollover. This spec is numbered to run before any other spec that merely needs *a* cycle to
 * exist (`03-navigation.spec.ts`'s nested-route check) so it can safely be the one to create it.
 * Running this file in isolation against an already-provisioned database (rather than the full
 * suite) skips gracefully instead of failing on an assumption it can't meet.
 */
/** The `PayrollCycleStatusBadge` renders as a `<span>` (`"January 2900 · Draft"`), but the same
 * text also appears inside the historical cycle `<select>`'s own `<option>` — scoping to `span`
 * disambiguates the badge from the option. */
function statusBadge(page: import('@playwright/test').Page, text: string) {
  return page.locator('span').filter({ hasText: text });
}

test.describe('Payroll lifecycle smoke', () => {
  test('Draft -> Released -> Archived + rollover, driven through the real UI', async ({ authenticatedPage: page }) => {
    const context = page.context();

    const existingCycles = await apiGet<{ cycles: { id: string }[] }>(context, '/api/v1/payroll-cycles');
    test.skip(
      existingCycles.body.cycles.length > 0,
      'A payroll cycle already exists — this spec owns the one-time bootstrap and expects to run ' +
        'first against a fresh database (see playwright.config.ts test ordering). Run the full ' +
        'suite, not this file alone, to exercise this path.',
    );

    await createSiteWithEmployee(context, `lifecycle-${Date.now()}`);
    const created = await apiPost<{ cycle: { id: string } }>(context, '/api/v1/payroll-cycles', {
      year: 2900,
      month: 1,
    });
    const draftCycleId = created.cycle.id;

    // --- 1. Draft view ---
    await page.goto(`/payroll-cycles/${draftCycleId}/release`);
    await expect(page.locator('#salary-release-cycle')).toBeVisible();
    await expect(statusBadge(page, '· Draft')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();

    // --- 2. Release the one Project Unit ---
    await page.getByRole('button', { name: 'Release', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Release Unit' }).click();
    await expect(page.getByText('Released', { exact: true })).toBeVisible();

    // --- 3. Finalize -> Released ---
    await page.getByRole('button', { name: 'Finalize Cycle' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Finalize Cycle' }).click();
    await expect(statusBadge(page, '· Released')).toBeVisible();

    // --- 4. Archive and create next -> a fresh Draft ---
    await page.getByRole('button', { name: 'Start New Payroll Cycle' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start New Payroll Cycle' }).click();
    // Navigates straight to the new Draft's own Release page (salary-release-page.tsx's own
    // documented post-rollover behavior) — never the just-archived cycle's URL.
    await page.waitForURL((url) => /\/payroll-cycles\/(?!$)/.test(url.pathname) && !url.pathname.includes(draftCycleId));
    await expect(statusBadge(page, '· Draft')).toBeVisible();
    const newDraftUrl = page.url();
    expect(newDraftUrl).not.toContain(draftCycleId);

    // --- 5. Historical selector shows both cycles; the archived one is genuinely read-only ---
    const cycleOptions = await page.locator('#salary-release-cycle option').allTextContents();
    expect(cycleOptions.some((text) => text.includes('Draft'))).toBe(true);
    expect(cycleOptions.some((text) => text.includes('Archived'))).toBe(true);

    await page.goto(`/payroll-cycles/${draftCycleId}/payroll-entry`);
    await expect(page.getByText('This cycle is Archived and permanently read-only')).toBeVisible();
    // No Finalize/Rollover action exists for an Archived cycle's own Release page either.
    await page.goto(`/payroll-cycles/${draftCycleId}/release`);
    await expect(page.getByRole('button', { name: 'Finalize Cycle' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start New Payroll Cycle' })).toHaveCount(0);
  });
});
