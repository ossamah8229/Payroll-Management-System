import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, login, getCsrfToken } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createScopedUser } from '../helpers/create-scoped-user';
import { BACKEND_URL } from '../setup/config';

/**
 * Employee Row Actions — RBAC split + Draft-payroll removal (UAT 2026-08-11, corrected 2026-08-12
 * — independent-permission revision).
 *
 * Two business requirements this suite proves end-to-end, against the real backend, with real
 * permission-scoped users (never `page.route` fakes):
 *
 * 1. `Edit Employee` and `Mark as Left` are governed by two entirely independent permissions:
 *    `Edit Employee` stays gated on `employees:edit` alone; `Mark as Left` is gated solely on
 *    `payroll:entry` (Payroll Staff's day-to-day Payroll Entry operational permission) —
 *    `employees.routes.ts`'s `requirePermission(PAYROLL_ENTRY)` gate on `POST /:id/leave`. An
 *    earlier revision of this checkpoint accepted `employees:edit` OR `payroll:entry` for Mark as
 *    Left — a confirmed defect (an employee-edit-only user with no Payroll Entry access could mark
 *    an employee left) — now corrected and covered below (Scenario A2) by an explicit denial case,
 *    proven both in Payroll Entry's own row menu and in Employee Registry's. Both actions still
 *    route through Employee Registry's own canonical, shared `EmployeeFormModal`/`MarkLeftModal` —
 *    never a second, Payroll-Entry-local implementation.
 * 2. Marking an employee Left now transactionally removes their `PayrollEntry` from the *current
 *    Draft* cycle (`removeEmployeeFromCurrentDraftCycle`, `payroll-processing.service.ts`) —
 *    Released/Archived history is never touched, regardless of which cycle is being viewed when the
 *    action is taken.
 */

async function ensureCycleExists(context: BrowserContext): Promise<void> {
  await apiPost(context, '/api/v1/payroll-cycles', { year: 2901, month: 3 }).catch(() => undefined);
}

async function createSiteAndUnit(context: BrowserContext, label: string) {
  const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E ${label}` });
  const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
    name: `E2E ${label} Unit`,
  });
  return { siteId: site.site.id, unitId: unit.unit.id };
}

async function createEmployee(
  context: BrowserContext,
  opts: { name: string; siteId: string; unitId: string; designation?: string },
): Promise<{ employee: { id: string } }> {
  return apiPost(context, '/api/v1/employees', {
    name: opts.name,
    designation: opts.designation ?? 'Guard',
    siteId: opts.siteId,
    unitId: opts.unitId,
    grossPay: '35000',
  });
}

async function openRowMenu(page: Page, employeeName: string) {
  await page.getByRole('button', { name: `Employee actions for ${employeeName}` }).click();
}

async function filterToSite(page: Page, siteLabel: string) {
  await page.locator('#payroll-entry-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteLabel }).click();
  await page.keyboard.press('Escape');
}

async function draftEntriesForSite(context: BrowserContext, cycleId: string, siteId: string) {
  const res = await apiGet<{ entries: ({ id: string; employeeId: string } & Record<string, unknown>)[] }>(
    context,
    `/api/v1/payroll-cycles/${cycleId}/entries?siteId=${siteId}`,
  );
  return res.body.entries;
}

async function currentDraftCycleId(context: BrowserContext): Promise<string> {
  const res = await apiGet<{ cycles: { id: string; status: string }[] }>(context, '/api/v1/payroll-cycles');
  const draft = res.body.cycles.find((c) => c.status === 'DRAFT');
  if (!draft) throw new Error('No Draft cycle exists — run the full suite, not this file alone.');
  return draft.id;
}

/** A fresh logged-in context for a permission-scoped E2E user (`createScopedUser`), mirroring the
 * pattern the RBAC scenarios below all need — login always goes through the real form (never a
 * bypass), only user *creation* is a direct-DB shortcut (see that helper's own doc comment). */
async function scopedUserContext(
  browser: import('@playwright/test').Browser,
  opts: { email: string; password: string; roleCode: string; permissionKeys: string[]; siteIds: string[] },
) {
  await createScopedUser({
    email: opts.email,
    password: opts.password,
    roleCode: opts.roleCode,
    permissionKeys: opts.permissionKeys,
    siteIds: opts.siteIds,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, opts.email, opts.password);
  return { context, page };
}

test.describe('Payroll Entry — Employee Row Actions', () => {
  test('Scenario A: Payroll Entry operational permission only — Mark as Left exists, Edit Employee does not, and Mark as Left succeeds', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const adminContext = adminPage.context();
    await ensureCycleExists(adminContext);
    const label = `RowRbacPeOnly ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(adminContext, label);
    const employeeName = `E2E RowRbacPeOnly Employee ${Date.now()}`;
    const { employee } = await createEmployee(adminContext, { name: employeeName, siteId, unitId });

    const email = `e2e-rowactions-pe-only-${Date.now()}@example.test`;
    const password = 'RowActionsPeOnly1!';
    const { context, page } = await scopedUserContext(browser, {
      email,
      password,
      roleCode: 'E2E_ROWACTIONS_PE_ONLY',
      // The Payroll Entry operational permission alone — deliberately no `employees:edit`, the
      // exact combination this checkpoint's business rule requires Mark as Left to still work for.
      permissionKeys: ['payroll:entry'],
      siteIds: [siteId],
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    await openRowMenu(page, employeeName);
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Mark as Left' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Edit Employee' })).not.toBeVisible();

    await menu.getByRole('menuitem', { name: 'Mark as Left' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Mark Employee as Left', { exact: true })).toBeVisible();

    const [leaveResponse] = await Promise.all([
      page.waitForResponse((res) => /\/api\/v1\/employees\/[^/]+\/leave$/.test(res.url()) && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm' }).click(),
    ]);
    expect(leaveResponse.status()).toBe(200);
    await expect(page.getByText(`${employeeName} marked as left`)).toBeVisible();

    // The backend independently enforces this too — the same PE-only session's own direct Edit
    // Employee attempt is rejected, proving Payroll Entry is not a bypass around `employees:edit`,
    // not merely a hidden button.
    const csrfToken = await getCsrfToken(context);
    const directEditAttempt = await context.request.patch(`${BACKEND_URL}/api/v1/employees/${employee.id}`, {
      data: { designation: 'Bypass Attempt' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(directEditAttempt.status()).toBe(403);

    await context.close();
  });

  test('Scenario A2: employees:edit permission only — cannot reach Payroll Entry at all (route itself requires payroll:entry); Employee Registry offers Edit but not Mark as Left; the direct API bypass is rejected', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const adminContext = adminPage.context();
    const label = `RowRbacEditOnly ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(adminContext, label);
    const employeeName = `E2E RowRbacEditOnly Employee ${Date.now()}`;
    const { employee } = await createEmployee(adminContext, { name: employeeName, siteId, unitId });

    const email = `e2e-rowactions-edit-only-${Date.now()}@example.test`;
    const password = 'RowActionsEditOnly1!';
    const { context, page } = await scopedUserContext(browser, {
      email,
      password,
      roleCode: 'E2E_ROWACTIONS_EDIT_ONLY',
      // employees:edit alone — deliberately no payroll:entry — proving employees:edit must never
      // grant Mark as Left on its own.
      permissionKeys: ['employees:view', 'employees:edit'],
      siteIds: [siteId],
    });

    // This user has no `payroll:entry`, so `App.tsx`'s own `RequirePermission` guard on the
    // `/payroll-entry` route denies the page entirely — an employees:edit-only user can never even
    // reach a Payroll Entry row menu, let alone act on one. The Payroll Entry side of this
    // permission combination is therefore proven by this route guard, not by a row menu.
    await page.goto('/payroll-entry');
    await expect(page.getByRole('heading', { name: 'You do not have permission to access this page.' })).toBeVisible(
      { timeout: 5000 },
    );

    // Employee Registry is where this user's own row menu is actually reachable — Edit visible,
    // Mark as Left hidden (this permission grants employee-master-data administration only).
    await page.goto(`/employees?search=${encodeURIComponent(employeeName)}`);
    const registryRow = page.getByRole('row', { name: new RegExp(employeeName) });
    await expect(registryRow).toBeVisible({ timeout: 5000 });
    await registryRow.getByRole('button', { name: `Actions for ${employeeName}` }).click();
    const registryMenu = page.getByRole('menu');
    await expect(registryMenu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(registryMenu.getByRole('menuitem', { name: 'Mark as left' })).not.toBeVisible();
    await page.keyboard.press('Escape');

    // The backend independently enforces this too — the same employees:edit-only session's own
    // direct Mark as Left attempt is rejected, proving the hidden menu item isn't the only guard.
    const csrfToken = await getCsrfToken(context);
    const directLeaveAttempt = await context.request.post(`${BACKEND_URL}/api/v1/employees/${employee.id}/leave`, {
      data: { dateOfLeaving: '2026-01-01' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(directLeaveAttempt.status()).toBe(403);

    await context.close();
  });

  test('Scenario B: Payroll Entry + employees:edit — menu offers both, and Edit Employee opens the canonical shared modal', async ({
    authenticatedPage: adminPage,
    browser,
  }) => {
    const adminContext = adminPage.context();
    await ensureCycleExists(adminContext);
    const label = `RowRbacBoth ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(adminContext, label);
    const employeeName = `E2E RowRbacBoth Employee ${Date.now()}`;
    await createEmployee(adminContext, { name: employeeName, siteId, unitId, designation: 'Site Engineer' });

    const email = `e2e-rowactions-both-${Date.now()}@example.test`;
    const password = 'RowActionsBoth1!';
    const { context, page } = await scopedUserContext(browser, {
      email,
      password,
      roleCode: 'E2E_ROWACTIONS_BOTH',
      permissionKeys: ['employees:view', 'employees:edit', 'payroll:entry'],
      siteIds: [siteId],
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    await openRowMenu(page, employeeName);
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Edit Employee' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Mark as Left' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Edit Employee' }).click();

    // Same shared modal Employee Registry itself uses — same title, same field ids, populated with
    // this row's own employee (never a second, Payroll-Entry-local edit form).
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Edit Employee', { exact: true })).toBeVisible();
    await expect(page.locator('#emp-name')).toHaveValue(employeeName);
    await expect(page.locator('#emp-designation')).toHaveValue('Site Engineer');

    await page.locator('#emp-designation').fill('Senior Site Engineer');
    const [updateResponse] = await Promise.all([
      page.waitForResponse((res) => /\/api\/v1\/employees\/[^/]+$/.test(res.url()) && res.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save changes' }).click(),
    ]);
    expect(updateResponse.status()).toBe(200);
    await expect(dialog).not.toBeVisible();

    const employeeRow = grid.getByRole('row', { name: new RegExp(employeeName) });
    await expect(employeeRow.getByText('Senior Site Engineer')).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test('Scenario C: Mark as Left removes the employee from the current Draft payroll — the row disappears live, no full refresh required', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await ensureCycleExists(context);
    const label = `RowDraftRemoval ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E RowDraftRemoval Employee ${Date.now()}`;
    await createEmployee(context, { name: employeeName, siteId, unitId });

    const draftCycleId = await currentDraftCycleId(context);
    const beforeEntries = await draftEntriesForSite(context, draftCycleId, siteId);
    expect(beforeEntries.length).toBe(1);

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    await openRowMenu(page, employeeName);
    await page.getByRole('menuitem', { name: 'Mark as Left' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Mark Employee as Left', { exact: true })).toBeVisible();

    const [leaveResponse] = await Promise.all([
      page.waitForResponse((res) => /\/api\/v1\/employees\/[^/]+\/leave$/.test(res.url()) && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm' }).click(),
    ]);
    expect(leaveResponse.status()).toBe(200);

    // Live on-screen removal — no `page.reload()`/`page.goto()` anywhere in this assertion. The
    // page's own `handleEmployeeMarkedLeft` invalidates the actual Draft cycle's query, which is
    // exactly the cycle currently being viewed here.
    await expect(grid.getByText(employeeName)).not.toBeVisible({ timeout: 5000 });

    // Backend truth, independent of the UI: the Draft PayrollEntry for this employee is gone. This
    // fixture site has exactly one employee, so zero remaining entries at this site unambiguously
    // proves the removal.
    const afterEntries = await draftEntriesForSite(context, draftCycleId, siteId);
    expect(afterEntries.length).toBe(0);

    // Employee Registry — the canonical roster status — shows Left.
    await page.goto(`/employees?search=${encodeURIComponent(employeeName)}`);
    await page.getByRole('checkbox', { name: 'Active employees only' }).click();
    const registryRow = page.getByRole('row', { name: new RegExp(employeeName) });
    await expect(registryRow.getByText('Left', { exact: true })).toBeVisible();
  });

  test('Scenario D: historical preservation — Mark as Left from an Archived cycle view leaves that cycle\'s row untouched and only removes current-Draft membership', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const draftCycleBefore = await currentDraftCycleId(context).catch(() => undefined);
    test.skip(!draftCycleBefore, 'No Draft cycle exists yet — run the full suite, not this file alone.');
    if (!draftCycleBefore) return;

    const label = `RowHistoricalRemoval ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E RowHistoricalRemoval Employee ${Date.now()}`;
    await createEmployee(context, { name: employeeName, siteId, unitId, designation: 'Original Designation' });

    // Non-zero worked days before releasing — a zero-day entry nets negative (the flat EOBI
    // deduction with no earned Gross Pay), which resolves to `RECOVERY_DUE` rather than an ordinary
    // `released=true` PAID outcome and projects a real `BalanceAdjustmentMaterialization` onto the
    // *next* Draft cycle's entry (Negative Payroll Recovery checkpoint) — exactly the financial
    // linkage `removeEmployeeFromCurrentDraftCycle` deliberately retains rather than deletes. This
    // scenario means to prove ordinary historical preservation, not that retention path (which has
    // its own coverage in the backend integration suite), so attendance is set first.
    const entryBefore = (await draftEntriesForSite(context, draftCycleBefore, siteId))[0] as unknown as {
      id: string;
      version: number;
      workLines: { id: string }[];
    };
    await context.request.patch(`${BACKEND_URL}/api/v1/work-lines/${entryBefore.workLines[0]!.id}`, {
      data: { version: entryBefore.version, days: '26' },
      headers: { 'x-csrf-token': await getCsrfToken(context) },
    });

    // Roll the current Draft over into Archived so a real historical cycle exists — this employee's
    // entry (created just above, synced into the Draft about to be archived) becomes a genuine
    // historical, released/archived row with its own frozen snapshot. The rollover also bootstraps
    // this still-active employee into the *new* Draft cycle, exactly the row Mark as Left must
    // remove below.
    const rolled = await apiPost<{ newCycle: { id: string } }>(
      context,
      `/api/v1/payroll-cycles/${draftCycleBefore}/units/release-all`,
      {},
    )
      .then(() => apiPost(context, `/api/v1/payroll-cycles/${draftCycleBefore}/finalize`, {}))
      .then(() =>
        apiPost<{ newCycle: { id: string } }>(
          context,
          `/api/v1/payroll-cycles/${draftCycleBefore}/archive-and-create-next`,
          {},
        ),
      )
      .catch(() => null);
    test.skip(!rolled, 'Could not roll the shared Draft cycle over (unrelated precondition) — skipping.');
    if (!rolled) return;

    const archivedCycleId = draftCycleBefore;
    const newDraftCycleId = rolled.newCycle.id;

    const archivedEntriesBefore = await draftEntriesForSite(context, archivedCycleId, siteId);
    const draftEntriesBefore = await draftEntriesForSite(context, newDraftCycleId, siteId);
    expect(archivedEntriesBefore.length).toBe(1);
    expect(draftEntriesBefore.length).toBe(1);

    // Mark as Left invoked from the Archived cycle's own row menu.
    await page.goto(`/payroll-cycles/${archivedCycleId}/payroll-entry`);
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    const employeeRow = grid.getByRole('row', { name: new RegExp(employeeName) });
    await expect(employeeRow).toBeVisible({ timeout: 5000 });
    await expect(employeeRow.getByText('Original Designation')).toBeVisible();

    await openRowMenu(page, employeeName);
    await page.getByRole('menuitem', { name: 'Mark as Left' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Mark Employee as Left', { exact: true })).toBeVisible();

    const [leaveResponse] = await Promise.all([
      page.waitForResponse((res) => /\/api\/v1\/employees\/[^/]+\/leave$/.test(res.url()) && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Confirm' }).click(),
    ]);
    expect(leaveResponse.status()).toBe(200);

    // The Archived cycle's own row — still visible on this exact page, untouched.
    await expect(employeeRow).toBeVisible();
    await expect(employeeRow.getByText('Original Designation')).toBeVisible();

    // Backend truth: the Archived cycle's own PayrollEntry snapshot is byte-for-byte the same; the
    // *new* Draft cycle's membership for this employee is gone. Never assume "viewed cycle == Draft
    // cycle". Compared with each entry's nested `employee` sub-object stripped out first —
    // `Employee` is one shared row, so its own live `dateOfLeaving` correctly changes on the joined
    // object; what must never change is the historical `PayrollEntry` row's own frozen fields.
    const stripEmployee = (entries: Record<string, unknown>[]) => entries.map(({ employee: _employee, ...rest }) => rest);
    const archivedEntriesAfter = await draftEntriesForSite(context, archivedCycleId, siteId);
    expect(stripEmployee(archivedEntriesAfter)).toEqual(stripEmployee(archivedEntriesBefore));
    const draftEntriesAfter = await draftEntriesForSite(context, newDraftCycleId, siteId);
    expect(draftEntriesAfter.length).toBe(0);

    // Employee Registry shows Left.
    await page.goto(`/employees?search=${encodeURIComponent(employeeName)}`);
    await page.getByRole('checkbox', { name: 'Active employees only' }).click();
    const registryRow = page.getByRole('row', { name: new RegExp(employeeName) });
    await expect(registryRow.getByText('Left', { exact: true })).toBeVisible();
  });

  test('Scenario E: virtualization — scrolling and opening menus on different rows never leaks another employee\'s data', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await ensureCycleExists(context);
    const label = `RowVirt ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);

    const employeeNames = Array.from({ length: 45 }, (_, i) => `E2E RowVirt Employee ${label} ${i}`);
    await Promise.all(
      employeeNames.map((name) => createEmployee(context, { name, siteId, unitId })),
    );

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    const firstName = employeeNames[0]!;
    const lastName = employeeNames[employeeNames.length - 1]!;
    await expect(grid.getByText(firstName)).toBeVisible({ timeout: 5000 });

    // The `role="table"` element (`grid`) is itself the real scroll container
    // (`payroll-entry-grid.tsx`'s own `containerRef`, `overflow-auto`) — not a wrapping ancestor.
    // Scrolled to the absolute bottom (rather than an arbitrary offset) so which row is now
    // visible is deterministic regardless of the container's actual measured height.
    await grid.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(grid.getByText(firstName)).not.toBeVisible();

    // The bottom-most, now-scrolled-into-view row's own menu opens for its own correct employee —
    // never a stale/recycled name left over from whichever employee previously occupied this
    // recycled DOM slot near the top of the list.
    await expect(grid.getByText(lastName)).toBeVisible({ timeout: 5000 });
    await openRowMenu(page, lastName);
    await page.getByRole('menuitem', { name: 'Edit Employee' }).click();
    await expect(page.locator('#emp-name')).toHaveValue(lastName);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Scroll back to the top — the recycled row that used to show `lastName` must now correctly
    // show `firstName` again, with its own menu opening for the correct (original) employee, not
    // whatever `lastName` data it last held.
    await grid.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(grid.getByText(firstName)).toBeVisible({ timeout: 5000 });
    await openRowMenu(page, firstName);
    await page.getByRole('menuitem', { name: 'Edit Employee' }).click();
    await expect(page.locator('#emp-name')).toHaveValue(firstName);
    await page.keyboard.press('Escape');
  });
});
