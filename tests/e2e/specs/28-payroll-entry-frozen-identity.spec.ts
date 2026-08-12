import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { apiPost } from '../helpers/api';

/**
 * Frozen Employee Identity Pane — UAT data-entry-safety correction, 2026-08-12.
 *
 * Payroll Entry is a very wide, horizontally scrollable grid (~26 columns, 2,300px+). Before this
 * checkpoint, scrolling right moved the employee's name/code out of view along with every other
 * column, creating a real risk of entering a payroll value against the wrong employee. The fix:
 * `employeeCode`/`employeeName` are now `position: sticky; left: <offset>px` (`columns.ts`'s
 * `FROZEN_LEFT_COLUMN_IDS`/`stickyIdentityCellClassName`/`stickyLeftOffsets`), pinned to the LEFT of
 * the grid's single scroll container while every other payroll column scrolls underneath.
 *
 * **Row action correction, same UAT pass**: the `⋯` menu (Employee Row Actions, UAT 2026-08-11) was
 * originally implemented as a second, sticky-right grid column — further UAT feedback on that
 * implementation was that the `⋯` menu is a characteristic of the row itself, not a payroll data
 * column, so it was corrected to render as a trailing, in-flow control after the row's own last data
 * cell (`payroll-entry-row.tsx`) — it is **not** sticky, **not** a `PAYROLL_COLUMNS` entry, and (like
 * every other payroll column) scrolls out of view at scroll position 0 and back into view only once
 * the user scrolls far enough right, exactly like `netSalary` immediately to its left.
 *
 * These tests assert real, measured `getBoundingClientRect()` geometry in a real Chromium instance
 * rather than CSS-class presence — the strongest practical proof that identity genuinely stays
 * visible during real horizontal scrolling, not just that the intended CSS exists.
 */

async function createSiteAndUnit(context: import('@playwright/test').BrowserContext, label: string) {
  const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E ${label}` });
  const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
    name: `E2E ${label} Unit`,
  });
  return { siteId: site.site.id, unitId: unit.unit.id };
}

async function filterToSite(page: Page, siteLabel: string) {
  await page.locator('#payroll-entry-site-filter').click();
  await page.getByRole('menuitemcheckbox', { name: siteLabel }).click();
  await page.keyboard.press('Escape');
}

/** Scrolls the grid's own single scroll container (`role="table"`, `payroll-entry-grid.tsx`'s
 * `containerRef`) horizontally to an explicit pixel offset — never `page.mouse.wheel`, which would
 * scroll whichever element happens to be under the cursor; this targets the exact element under
 * test. */
async function scrollGridHorizontally(page: Page, distance: number) {
  const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
  await grid.evaluate((el, d) => {
    el.scrollLeft = d;
  }, distance);
  // Let the sticky/virtualizer layout settle before measuring.
  await page.waitForTimeout(100);
  return grid;
}

/** The grid's own real, measured `scrollWidth`/`clientWidth` — used to derive a "substantially
 * scrolled but not yet at the extreme" offset that reliably brings a genuinely mid-grid column
 * (e.g. Allowance) on-screen, rather than a guessed pixel constant that may or may not clear
 * whichever columns' actual measured widths this run's test data happens to produce
 * (`computeColumnWidths` sizes every column from loaded content, so the grid's total width is not a
 * fixed number run to run). */
async function midScrollOffset(page: Page): Promise<number> {
  const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
  const { scrollWidth, clientWidth } = await grid.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  const maxScrollLeft = scrollWidth - clientWidth;
  return Math.round(maxScrollLeft * 0.6);
}

test.describe('Payroll Entry — Frozen Employee Identity Pane', () => {
  test('Scenario A: at scroll position 0, employee identity is visible; the trailing row action is not — it is not sticky/pinned, unlike identity', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 1 }).catch(() => undefined);
    const label = `FrozenIdA ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E FrozenId Employee ${Date.now()}`;
    await apiPost(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '35000',
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    // Row-level-control correction (UAT 2026-08-12): the `⋯` trigger is the row's own trailing,
    // in-flow control, not a sticky-right column — at scroll position 0 it sits far off the visible
    // right edge of this ~2,300px+ grid, exactly like `netSalary` immediately to its left, and is
    // genuinely not on-screen (never merely "present in the DOM but scrolled away").
    const actionsButton = page.getByRole('button', { name: `Employee actions for ${employeeName}` });
    await expect(actionsButton).toHaveCount(1);
    await expect(actionsButton).not.toBeInViewport();
  });

  test('Scenario B/C: after scrolling substantially right, employee identity stays frozen; the trailing row action scrolls into view naturally by the extreme right and remains clear of the identity pane', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 2 }).catch(() => undefined);
    const label = `FrozenIdBC ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E FrozenId BC Employee ${Date.now()}`;
    await apiPost(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '35000',
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    // The outer sticky cell div, not the inner `<span>` text node — `data-col-id`/`role="cell"`
    // identifies the actual positioned element (`payroll-entry-row.tsx`'s `ReadOnlyCell`), the same
    // element the CSS `sticky`/`left` treatment is applied to.
    const nameCell = grid.locator('[data-col-id="employeeName"][role="cell"]').first();
    // Row-level-control correction (UAT 2026-08-12): the trailing `⋯` control carries a
    // `data-row-action` attribute precisely because it is *not* a `[data-col-id]` cell — this
    // locator identifies the actual positioned element the row renders it into.
    const actionSlot = grid.locator('[data-row-action="employee-actions"]').first();
    const actionsButton = page.getByRole('button', { name: `Employee actions for ${employeeName}` });

    const beforeGridBox = (await grid.boundingBox())!;
    // At scroll position 0 the trailing action sits far off the grid's visible right edge — it is
    // not sticky, so it has no "engaged/clamped" position to reach; only the identity pane does.
    await expect(actionsButton).not.toBeInViewport();

    // `serial`+`status` (fixed 60px + 90px) precede `employeeCode`/`employeeName` in column order
    // but are deliberately *not* part of the frozen pane (`columns.ts`'s own
    // `FROZEN_LEFT_COLUMN_IDS` doc comment) — at scrollLeft 0 they are still in ordinary, unscrolled
    // flow, so the identity pane's *natural* (not-yet-clamped) position sits to the right of them,
    // not yet pinned to the container's left edge. That is expected, correct sticky behavior, not
    // the thing under test here — the actual proof of stickiness is that position stays fixed
    // across *further* scrolling once the pane has engaged (asserted via `midNameBox`/
    // `extremeNameBox` below), not that it never moves at all starting from an unscrolled grid.

    // Scroll substantially right (well past the 150px serial+status width, so the identity pane is
    // already fully engaged/clamped) — Scenario B.
    await scrollGridHorizontally(page, await midScrollOffset(page));
    const scrollLeftMid = await grid.evaluate((el) => el.scrollLeft);
    expect(scrollLeftMid).toBeGreaterThan(400); // proves a real scroll actually happened

    const midNameBox = (await nameCell.boundingBox())!;
    // Identity stays within the grid's own on-screen bounds — genuinely visible, not merely
    // present in the DOM off-screen.
    expect(midNameBox.x).toBeGreaterThanOrEqual(beforeGridBox.x - 1);

    // A mid-grid payroll column (Allowance) must now be on-screen too, proving the scroll actually
    // reached new content, not just that the identity pane failed to move.
    const allowanceInput = page.getByRole('textbox', { name: `Allowance for ${employeeName}` });
    await expect(allowanceInput).toBeVisible();
    const allowanceBox = (await allowanceInput.boundingBox())!;
    expect(allowanceBox.x).toBeGreaterThanOrEqual(beforeGridBox.x);
    expect(allowanceBox.x).toBeLessThan(beforeGridBox.x + beforeGridBox.width);

    // Scroll to the absolute extreme right — Scenario C.
    await scrollGridHorizontally(page, 100_000);
    const scrollLeftMax = await grid.evaluate((el) => el.scrollLeft);
    expect(scrollLeftMax).toBeGreaterThan(scrollLeftMid);

    // Net Salary (the last payroll column) is now reachable at the extreme scroll position —
    // proves the scroll genuinely reached the far end of the grid, not just that the frozen
    // identity pane failed to move.
    const netSalaryHeader = page.locator('[data-col-id="netSalary"][role="columnheader"]');
    const netSalaryBox = await netSalaryHeader.boundingBox();
    expect(netSalaryBox).not.toBeNull();
    expect(netSalaryBox!.x).toBeGreaterThanOrEqual(beforeGridBox.x);
    expect(netSalaryBox!.x).toBeLessThan(beforeGridBox.x + beforeGridBox.width);

    const extremeNameBox = (await nameCell.boundingBox())!;
    // The direct, measured proof of "sticky": once engaged (at `scrollLeftMid`, well past the
    // 150px threshold), further scrolling all the way to the extreme right does not move the
    // frozen identity pane by even one pixel.
    expect(Math.round(extremeNameBox.x)).toBe(Math.round(midNameBox.x));
    expect(Math.round(extremeNameBox.y)).toBe(Math.round(midNameBox.y));

    // The trailing row action, by contrast, is now on-screen precisely *because* the scroll reached
    // the grid's own far end — natural in-flow behavior, not stickiness — and sits at the row's own
    // trailing edge, clear of the frozen identity pane on the opposite side of the row.
    await expect(actionsButton).toBeInViewport();
    const extremeActionsBox = (await actionSlot.boundingBox())!;
    expect(extremeNameBox.x + extremeNameBox.width).toBeLessThan(extremeActionsBox.x);
    // Not pinned to the grid's own right edge either (that would just be a differently-placed sticky
    // pane) — its right edge sits at the grid's true content end, inside the reserved trailing
    // margin `columns.ts`'s `ROW_ACTION_WIDTH` reserves for it.
    const gridRightEdge = beforeGridBox.x + beforeGridBox.width;
    expect(extremeActionsBox.x + extremeActionsBox.width).toBeLessThanOrEqual(gridRightEdge + 1);
    expect(extremeActionsBox.x + extremeActionsBox.width).toBeGreaterThan(gridRightEdge - 60);

    // The actions menu is still genuinely usable at the extreme scroll position — not merely
    // visually present.
    await actionsButton.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Scenario D: editing a payroll input while horizontally scrolled still keeps the row identifiable, and keyboard navigation still works', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 3 }).catch(() => undefined);
    const label = `FrozenIdD ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E FrozenId D Employee ${Date.now()}`;
    await apiPost(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '35000',
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    await scrollGridHorizontally(page, await midScrollOffset(page));

    // Still able to read the identity while the Allowance input (a mid-grid payroll column) is now
    // in view and editable.
    await expect(grid.getByText(employeeName)).toBeVisible();
    const allowanceInput = page.getByRole('textbox', { name: `Allowance for ${employeeName}` });
    await expect(allowanceInput).toBeVisible();
    await allowanceInput.fill('500');
    await expect(allowanceInput).toHaveValue('500');

    // Arrow-key vertical navigation (`use-grid-keyboard-nav.ts`) still functions with the identity
    // pane active — focus should stay on an input in the same column after ArrowDown (only one row
    // here, so it's a no-op move, but the handler must not throw/break focus).
    await allowanceInput.press('ArrowDown');
    await expect(allowanceInput).toBeFocused();
  });

  test('Scenario E/F: vertical scrolling through many virtualized rows while horizontally scrolled never shows a stale or mismatched employee identity', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `FrozenIdEF ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);

    const employeeNames = Array.from({ length: 40 }, (_, i) => `E2E FrozenId Virt ${label} ${i}`);
    await Promise.all(
      employeeNames.map((name) =>
        apiPost(context, '/api/v1/employees', { name, designation: 'Guard', siteId, unitId, grossPay: '30000' }),
      ),
    );

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    const firstName = employeeNames[0]!;
    const lastName = employeeNames[employeeNames.length - 1]!;
    await expect(grid.getByText(firstName)).toBeVisible({ timeout: 5000 });

    // Horizontally scroll first, then vertically scroll to the bottom — both axes active together.
    await scrollGridHorizontally(page, await midScrollOffset(page));
    await grid.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(150);

    await expect(grid.getByText(firstName)).not.toBeVisible();
    await expect(grid.getByText(lastName)).toBeVisible({ timeout: 5000 });

    // The identity pane must still be pinned left even mid-vertical-scroll (horizontal stickiness
    // is per-cell, not disturbed by which rows are currently mounted).
    const nameCellBox = (await grid.getByText(lastName).first().boundingBox())!;
    const gridBox = (await grid.boundingBox())!;
    expect(Math.round(nameCellBox.x)).toBeLessThanOrEqual(Math.round(gridBox.x) + 250);

    // Its own row action menu opens for the correct (bottom-most) employee — no recycled/stale name
    // from whichever employee previously occupied this DOM slot near the top of the list.
    await page.getByRole('button', { name: `Employee actions for ${lastName}` }).click();
    await page.getByRole('menuitem', { name: 'Edit Employee' }).click();
    await expect(page.locator('#emp-name')).toHaveValue(lastName);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Scroll back to the top — the recycled slot must now correctly show the first employee again.
    await grid.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(150);
    await expect(grid.getByText(firstName)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: `Employee actions for ${firstName}` }).click();
    await page.getByRole('menuitem', { name: 'Edit Employee' }).click();
    await expect(page.locator('#emp-name')).toHaveValue(firstName);
    await page.keyboard.press('Escape');
  });

  test('Scenario G/H/I: header and totals row stay pixel-aligned with the frozen identity pane through horizontal scroll', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 4 }).catch(() => undefined);
    const label = `FrozenIdGHI ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E FrozenId GHI Employee ${Date.now()}`;
    await apiPost(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '35000',
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    await scrollGridHorizontally(page, await midScrollOffset(page));

    // The outer sticky cell divs (`role`/`data-col-id`, the actual positioned elements), not the
    // inner text nodes — comparing a header's own padded box against a body cell's inner `<span>`
    // would show a spurious few-pixel offset from the span's own padding, not a real misalignment.
    const headerNameCell = page.locator('[data-col-id="employeeName"][role="columnheader"]');
    // Exactly two `[role="cell"]` matches for this column with one entry loaded: the body row
    // (first in DOM order) and the totals row's own "N employees" cell (second/last).
    const identityCells = grid.locator('[data-col-id="employeeName"][role="cell"]');
    const bodyNameCell = identityCells.first();
    const totalsNameCell = identityCells.last();

    const headerBox = (await headerNameCell.boundingBox())!;
    const bodyBox = (await bodyNameCell.boundingBox())!;
    // Header and body columns are pixel-aligned (same left edge) even mid-scroll.
    expect(Math.round(headerBox.x)).toBe(Math.round(bodyBox.x));

    // The totals row's own Employee cell (the "N employees" summary) is likewise pinned at the same
    // left edge — no drift between header/body/totals under horizontal scroll.
    await expect(totalsNameCell).toContainText('employee');
    const totalsBox = await totalsNameCell.boundingBox();
    expect(totalsBox).not.toBeNull();
    expect(Math.round(totalsBox!.x)).toBe(Math.round(bodyBox.x));
  });

  /** Responsive/viewport coverage — a narrower, tablet-like viewport (UAT acceptance criteria's own
   * "narrower desktop/tablet-like viewport" requirement). At this width the grid's overall client
   * area is much smaller relative to its ~2,300px+ content, but the frozen identity pane must still
   * fit, and the trailing row action (now in-flow, not sticky) must still be reachable at the
   * extreme scroll without overlapping the frozen identity pane. */
  test('a narrower (tablet-like) viewport: frozen identity and the trailing row action both remain visible and non-overlapping at the extreme scroll', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 5 }).catch(() => undefined);
    const label = `FrozenIdNarrow ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E FrozenId Narrow Employee ${Date.now()}`;
    await apiPost(context, '/api/v1/employees', {
      name: employeeName,
      designation: 'Guard',
      siteId,
      unitId,
      grossPay: '35000',
    });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    const nameCell = grid.locator('[data-col-id="employeeName"][role="cell"]').first();
    const actionsButton = page.getByRole('button', { name: `Employee actions for ${employeeName}` });
    const gridBox = (await grid.boundingBox())!;

    await scrollGridHorizontally(page, 100_000);

    const nameBox = (await nameCell.boundingBox())!;
    const actionsBox = (await actionsButton.boundingBox())!;
    // Both frozen regions still sit within the (now much narrower) grid viewport.
    expect(nameBox.x).toBeGreaterThanOrEqual(gridBox.x - 1);
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(gridBox.x + gridBox.width + 1);
    // No overlap between the two frozen regions even at this width.
    expect(nameBox.x + nameBox.width).toBeLessThan(actionsBox.x);

    await actionsButton.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
