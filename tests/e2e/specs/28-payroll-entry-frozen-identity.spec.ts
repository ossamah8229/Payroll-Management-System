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

/**
 * Layering correction (UAT 2026-08-12b — production report: scrolling content, e.g. a sort arrow,
 * painting over the frozen identity pane). The root cause: this grid's header/group-header/body/
 * totals rows are all `display: grid` or `display: flex` containers, and per the CSS Grid/Flexbox
 * stacking rules, sibling items with equally-`auto` z-index paint in *document order* — every
 * scrolling `PAYROLL_COLUMNS` entry sorts after `employeeCode`/`employeeName`, so without an
 * explicit z-index a scrolling sibling wins the tie wherever its own rendered box (including a small
 * child like a sort-chevron icon, not just the cell's own background) happens to physically coincide
 * with the frozen pane's fixed on-screen position. Confirmed via real-Chromium `elementFromPoint`
 * hit-testing during triage, then fixed by moving `z-10` into `stickyIdentityCellClassName` itself
 * (`columns.ts`) so it's a shared, mandatory part of the frozen-cell treatment rather than a detail
 * only `payroll-entry-row.tsx` happened to add for the body row.
 *
 * This helper is the direct, real-browser proof of that invariant: for a real `identityBox` (the
 * frozen pane's own *actual, currently-stuck* `getBoundingClientRect()`, not a guessed x-range),
 * sweep a wide spread of horizontal scroll offsets and hit-test multiple points across the frozen
 * pane's own width at the given row's own y-coordinate — every hit must resolve to an element whose
 * ancestor chain includes the frozen pane's own `data-col-id` (`employeeCode`/`employeeName`).
 * Never asserts CSS class/z-index presence alone (that would only prove the intended styling exists,
 * not that it actually wins in a real paint), and never hardcodes a specific scroll offset the
 * defect happened to reproduce at during triage (`computeColumnWidths` sizes every column from
 * loaded content, so a fixed pixel offset is not portable run to run) — it instead sweeps the whole
 * scrollable range so a regression at *any* offset, from any column, is caught.
 */
async function assertNoScrollingContentPaintsOverIdentity(
  page: Page,
  grid: import('@playwright/test').Locator,
  identityBox: { x: number; width: number },
  rowY: number,
  rowLabel: string,
) {
  const { scrollWidth, clientWidth } = await grid.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  const maxScrollLeft = scrollWidth - clientWidth;
  const xs = [identityBox.x + 2, identityBox.x + identityBox.width / 2, identityBox.x + identityBox.width - 2];

  for (let frac = 0.1; frac <= 1; frac += 0.06) {
    const target = Math.round(maxScrollLeft * frac);
    await grid.evaluate((el, d) => {
      el.scrollLeft = d;
    }, target);
    // Settling the sticky/virtualizer layout, matching this file's own `scrollGridHorizontally` convention.
    await page.waitForTimeout(40);

    for (const x of xs) {
      const hasIdentityAncestor = await page.evaluate(
        ({ x, y }) => {
          let node = document.elementFromPoint(x, y);
          for (let i = 0; i < 8 && node; i++) {
            const colId = node.getAttribute?.('data-col-id');
            if (colId === 'employeeCode' || colId === 'employeeName') return true;
            node = node.parentElement;
          }
          return false;
        },
        { x, y: rowY },
      );
      expect(
        hasIdentityAncestor,
        `${rowLabel}: scrolling content painted over the frozen identity pane at scrollLeft=${target}, x=${Math.round(x)}`,
      ).toBe(true);
    }
  }
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

  test('Scenario J: no scrolling content — including sort arrows and the Units badge — ever paints over the frozen identity pane, at any horizontal scroll offset, in the header, body, or totals row', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 6 }).catch(() => undefined);
    const label = `FrozenIdJ ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeNames = [0, 1, 2].map((i) => `E2E FrozenId J Employee ${i} ${Date.now()}`);
    await Promise.all(
      employeeNames.map((name) =>
        apiPost(context, '/api/v1/employees', { name, designation: 'Guard', siteId, unitId, grossPay: '35000' }),
      ),
    );

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeNames[0]!)).toBeVisible({ timeout: 5000 });

    // Sort by a *scrolling* sortable column (Deputed Branch/`unitCode`) so its own active chevron
    // icon — the exact kind of element the production report showed painting over the frozen pane —
    // is on-screen and swept underneath it below, not just the column's plain background.
    await page.locator('[data-col-id="unitCode"][role="columnheader"] button').click();

    // Engage stickiness (well past the `serial`+`status` natural-flow threshold) before capturing
    // the frozen pane's own *stuck* geometry — its unstuck, natural-flow position at scrollLeft 0 is
    // not where it visually sits once actually scrolled (see Scenario B/C's own comment on this).
    await scrollGridHorizontally(page, 400);
    const codeHeaderBox = (await page.locator('[data-col-id="employeeCode"][role="columnheader"]').boundingBox())!;
    const nameHeaderBox = (await page.locator('[data-col-id="employeeName"][role="columnheader"]').boundingBox())!;
    const identityBox = { x: codeHeaderBox.x, width: nameHeaderBox.x + nameHeaderBox.width - codeHeaderBox.x };

    const columnHeaderY = codeHeaderBox.y + codeHeaderBox.height / 2;
    // The group-header row sits directly above the column-header row (`GROUP_ROW_HEIGHT`, 22px).
    const groupHeaderY = codeHeaderBox.y - 11;
    const bodyNameBox = (await grid.locator('[data-col-id="employeeName"][role="cell"]').first().boundingBox())!;
    const bodyRowY = bodyNameBox.y + bodyNameBox.height / 2;
    const totalsNameBox = (await grid.locator('[data-col-id="employeeName"][role="cell"]').last().boundingBox())!;
    const totalsRowY = totalsNameBox.y + totalsNameBox.height / 2;

    await assertNoScrollingContentPaintsOverIdentity(page, grid, identityBox, groupHeaderY, 'group-header row');
    await assertNoScrollingContentPaintsOverIdentity(page, grid, identityBox, columnHeaderY, 'column-header row (sort arrows)');
    await assertNoScrollingContentPaintsOverIdentity(page, grid, identityBox, bodyRowY, 'body row (Units badge etc.)');
    await assertNoScrollingContentPaintsOverIdentity(page, grid, identityBox, totalsRowY, 'totals row');

    // The sort itself is still genuinely functional after all that scrolling — this test must not
    // silently pass by having broken sorting instead of fixing layering.
    await expect(page.locator('[data-col-id="unitCode"][role="columnheader"]')).toHaveAttribute('aria-sort', 'ascending');
  });

  /**
   * Scenario K — the exact production report (UAT 2026-08-14): a scrolling cell's *focus ring* (the
   * Units badge's `box-shadow`, or a `days`/etc. input's own) bleeding into the frozen identity pane
   * once that cell has scrolled underneath it.
   *
   * This is a fundamentally different failure mode than Scenario J's, and needs a fundamentally
   * different proof. `elementFromPoint` hit-testing (Scenario J's whole method) can only ever prove
   * "the topmost *hit-testable* element at this point belongs to the identity pane" — it queries
   * layout-box topology, never painted pixels. A `box-shadow`/`outline` is pure paint: it is not
   * itself hit-testable, can render a few px beyond its own element's layout box, and — root cause,
   * confirmed by tracing this exact defect in real Chromium — a virtualized row is `position:
   * absolute` with no explicit `z-index` of its own, so it does not establish its own stacking
   * context; a ring that extends past *this* row's own bounds is no longer compared against *this*
   * row's own identity cell at all, it is simply unclipped paint sitting on top of whatever is
   * underneath, including a neighboring row's identity pane. Scenario J's own sweep, however
   * thorough, structurally cannot see this — it would pass even with the defect present, exactly as
   * it did during triage.
   *
   * The real proof is pixel-level: the frozen pane's own on-screen region must render *identically*
   * whether or not a scrolled-underneath cell happens to be focused. Any difference at all — a ring,
   * a stray outline pixel, anything — means scrolled content painted somewhere it must not.
   */
  test('Scenario K: focusing a scrolling cell that has scrolled underneath the frozen pane (e.g. the Units badge) never changes a single pixel of the pane itself — proven by screenshot, not hit-testing, since a focus ring is pure paint and invisible to elementFromPoint', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 7 }).catch(() => undefined);
    const label = `FrozenIdK ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);
    const employeeName = `E2E FrozenId K Employee ${Date.now()}`;
    await apiPost(context, '/api/v1/employees', { name: employeeName, designation: 'Guard', siteId, unitId, grossPay: '35000' });

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeName)).toBeVisible({ timeout: 5000 });

    /** Scrolls the grid so `colId`'s own column sits fully underneath the frozen pane, then hands
     * back the frozen pane's own real, currently-stuck clip region — computed fresh from its own
     * `employeeCode`/`employeeName` geometry (never a guessed pixel box), the same discipline every
     * other scenario in this file already follows. */
    async function scrollColumnUnderneathPane(colId: string) {
      await grid.evaluate((el) => {
        el.scrollLeft = 0;
      });
      const codeHeaderBox0 = (await page.locator('[data-col-id="employeeCode"][role="columnheader"]').boundingBox())!;
      const targetHeaderBox0 = (await page.locator(`[data-col-id="${colId}"][role="columnheader"]`).boundingBox())!;
      const naturalLeft = targetHeaderBox0.x - codeHeaderBox0.x;
      await scrollGridHorizontally(page, Math.round(naturalLeft));

      const codeHeaderBox = (await page.locator('[data-col-id="employeeCode"][role="columnheader"]').boundingBox())!;
      const nameHeaderBox = (await page.locator('[data-col-id="employeeName"][role="columnheader"]').boundingBox())!;
      return { x: codeHeaderBox.x, width: nameHeaderBox.x + nameHeaderBox.width - codeHeaderBox.x };
    }

    /**
     * The real, geometric proof that a focused control's ring/outline can never reach the frozen
     * pane: not a screenshot. This codebase has no prior use of whole-image screenshot comparison
     * (byte-exact or snapshot-baseline) anywhere in this suite, deliberately — two screenshots of the
     * *same*, unchanged page taken moments apart are not reliably byte-identical (sub-pixel font-
     * hinting/anti-aliasing noise), which a byte-diff check was confirmed, while writing this
     * scenario, to false-positive on. `elementFromPoint` hit-testing (Scenario J's method) has the
     * opposite problem — structurally blind to `box-shadow`/`outline`, which are pure paint with no
     * hit-testable geometry of their own (see the `units` cell's own comment in
     * `payroll-entry-row.tsx` for why that matters here specifically).
     *
     * The fix this scenario proves is a *containment* fix (`overflow-hidden` on each scrolling cell
     * that holds a focusable control) — so the direct, deterministic proof is containment itself:
     * compute the focused ring's own real outer extent from its actual computed `box-shadow` (never
     * a hardcoded Tailwind class assumption — `ring-2`/`ring-offset-1` are read back from the
     * browser's own resolved style, so this stays correct even if those utilities change), and
     * assert that extent is fully inside the nearest ancestor whose own computed `overflow` clips it.
     * If it is, the ring cannot physically paint outside that box — regardless of z-index, regardless
     * of which row is virtualized where, regardless of anti-aliasing.
     */
    async function assertFocusRingIsContainedByAnAncestorClip(controlSelector: string, colId: string) {
      const paneClipXRange = await scrollColumnUnderneathPane(colId);
      const control = grid.locator(controlSelector).first();
      const controlBox = (await control.boundingBox())!;
      expect(
        controlBox.x >= paneClipXRange.x && controlBox.x + controlBox.width <= paneClipXRange.x + paneClipXRange.width,
        `${controlSelector}: expected this control to have scrolled fully underneath the frozen pane (pane x-range [${paneClipXRange.x}, ${paneClipXRange.x + paneClipXRange.width}], control x-range [${controlBox.x}, ${controlBox.x + controlBox.width}]) — test setup itself is wrong if not.`,
      ).toBe(true);

      await control.focus();
      await page.waitForTimeout(150);

      const result = await control.evaluate((el) => {
        const cs = getComputedStyle(el);
        // Every comma-separated box-shadow layer's own `blur-radius spread-radius` (the 3rd/4th
        // length in `offsetX offsetY blur spread color`, in whatever order the UA serializes it) —
        // the maximum of (blur + spread) across all layers is exactly how far this element's own
        // painted shadow can extend beyond its border box, in any direction.
        const lengths = (s: string) => (s.match(/-?[\d.]+px/g) ?? []).map((v) => parseFloat(v));
        let maxExtent = 0;
        if (cs.boxShadow && cs.boxShadow !== 'none') {
          for (const layer of cs.boxShadow.split(/,(?![^(]*\))/)) {
            // An `inset` shadow is drawn *inside* the border box — e.g. `focus:ring-inset` (this
            // codebase's own dense-grid-cell convention, `inline-cells.tsx`) — and can never extend
            // beyond it regardless of its own offset/blur/spread, unlike an ordinary outward shadow.
            if (/\binset\b/.test(layer)) continue;
            const nums = lengths(layer);
            // offsetX, offsetY, blur, spread — a layer may omit blur/spread (defaults 0).
            const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = nums;
            const extent = Math.max(Math.abs(offsetX), Math.abs(offsetY)) + blur + spread;
            maxExtent = Math.max(maxExtent, extent);
          }
        }
        // Tailwind's `outline-none` utility is a *transparent* 2px outline (`outline: 2px solid
        // transparent`), not `outline-style: none` — its width/offset are real but it paints nothing
        // visible, so it must not count as "escaping" paint. Only a non-transparent outline color
        // (an actual visible outline, e.g. a future control that never adopted this codebase's
        // shared ring convention) contributes to the extent.
        const outlineColorCompact = cs.outlineColor.replace(/\s/g, '');
        const outlineIsVisible =
          cs.outlineStyle !== 'none' && outlineColorCompact !== 'transparent' && outlineColorCompact !== 'rgba(0,0,0,0)';
        const outlineWidth = outlineIsVisible ? parseFloat(cs.outlineWidth) + Math.max(0, parseFloat(cs.outlineOffset)) : 0;
        const extent = Math.max(maxExtent, outlineWidth);

        const elRect = el.getBoundingClientRect();
        const ringBox = {
          top: elRect.top - extent,
          bottom: elRect.bottom + extent,
          left: elRect.left - extent,
          right: elRect.right + extent,
        };

        // Walk up to find the nearest ancestor whose own computed `overflow` would clip this
        // element's paint (matches any axis set to `hidden`/`clip`/`scroll`/`auto` — not `visible`).
        let node: HTMLElement | null = el.parentElement;
        while (node) {
          const nodeStyle = getComputedStyle(node);
          if (nodeStyle.overflow !== 'visible' || nodeStyle.overflowX !== 'visible' || nodeStyle.overflowY !== 'visible') {
            const clipRect = node.getBoundingClientRect();
            return { extent, ringBox, clipperFound: true, clipRect, clipperTag: node.tagName, clipperColId: node.getAttribute('data-col-id') };
          }
          node = node.parentElement;
        }
        return { extent, ringBox, clipperFound: false, clipRect: null, clipperTag: null, clipperColId: null };
      });

      expect(result.clipperFound, `${controlSelector}: no ancestor clips this control's paint at all — a ring/outline here can escape without bound.`).toBe(true);
      const { ringBox, clipRect } = result;
      expect(
        clipRect &&
          ringBox.top >= clipRect.top - 0.5 &&
          ringBox.bottom <= clipRect.bottom + 0.5 &&
          ringBox.left >= clipRect.left - 0.5 &&
          ringBox.right <= clipRect.right + 0.5,
        `${controlSelector} (colId="${colId}", clipped by <${result.clipperTag} data-col-id="${result.clipperColId}">): the focused ring's own extent ${JSON.stringify(ringBox)} is not fully contained by its clipping ancestor's box ${JSON.stringify(clipRect)} — it can paint outside its own row, including into the frozen identity pane.`,
      ).toBe(true);

      await page.keyboard.press('Escape'); // drop focus before the next control is checked
    }

    // The Units badge — the exact control the production report named.
    await assertFocusRingIsContainedByAnAncestorClip('[data-col-id="units"] button', 'units');
    // Every other kind of focusable scrolling control this grid has — proves the fix is general
    // (each cell's own `overflow-hidden`, `payroll-entry-row.tsx`), not a one-off patch on the Units
    // button alone: a plain text/number input, and a `ToggleSwitch`.
    await assertFocusRingIsContainedByAnAncestorClip('[data-col-id="days"] input', 'days');
    await assertFocusRingIsContainedByAnAncestorClip('[data-col-id="eobiApplicable"] button', 'eobiApplicable');
  });

  /**
   * Scenario L — the vertical-edge bleed that escaped Scenarios J and K (UAT 2026-08-15).
   *
   * Both prior fixes proved horizontal / paint-order containment: Scenario J's `elementFromPoint`
   * sweep samples each row at its own vertical *center* only, and Scenario K's ring-containment proof
   * only exercises a *focused* control. Neither can see this failure mode, because it needs neither
   * focus nor a center-y sample to reproduce: `employeeCode`/`employeeName` (`ReadOnlyCell`, no
   * `fullHeight`) sized to their own content height (~24px) and were vertically centered *within* the
   * row by the row's own `items-center` — while a bordered scrolling control in the same row
   * (`self-stretch`, the 2026-08-14 fix) is taller (~26px, its own 1px top+bottom border), centered on
   * the same row midpoint. Both centered on the same point but one shorter than the other leaves an
   * ~1px sliver at the row's own top and bottom edges where the frozen pane has no painted box at all
   * — not something `z-10` can win, since z-index only resolves a tie where both boxes overlap in the
   * first place. Fixed by giving `employeeCode`/`employeeName` (and the totals row's own identity
   * cells) `ReadOnlyCell`'s new `fullHeight` prop: `self-stretch` so the cell's own box is the row's
   * full height, `flex items-center` so its content stays visually centered inside that taller box.
   *
   * This proof is purely geometric — `getBoundingClientRect()` on real, currently-stuck elements in a
   * real Chromium instance — checking the exact invariant the fix must uphold for every row, at both
   * the top and bottom edge, never only the center: **`frozenTop <= controlTop` AND
   * `frozenBottom >= controlBottom`**. No focus, no hover, anywhere in this test — the defect this
   * proves against was a static, always-present sliver. Uses the same 40-employee virtualized dataset
   * as Scenario E/F so the invariant is checked across freshly-mounted, scrolled-past, and recycled
   * rows alike, not just whichever single row a smaller fixture would happen to mount once.
   */
  test('Scenario L: the frozen identity pane fully covers every scrolling cell it sits above — top edge and bottom edge, every row, no focus/hover involved, surviving virtualization recycling', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2902, month: 8 }).catch(() => undefined);
    const label = `FrozenIdL ${Date.now()}`;
    const { siteId, unitId } = await createSiteAndUnit(context, label);

    const employeeNames = Array.from({ length: 40 }, (_, i) => `E2E FrozenId L ${label} ${i}`);
    await Promise.all(
      employeeNames.map((name) =>
        apiPost(context, '/api/v1/employees', { name, designation: 'Guard', siteId, unitId, grossPay: '30000' }),
      ),
    );

    await page.goto('/payroll-entry');
    await page.waitForLoadState('networkidle');
    await filterToSite(page, `E2E ${label}`);

    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid.getByText(employeeNames[0]!)).toBeVisible({ timeout: 5000 });

    /** For every currently-mounted body row, asserts the frozen `employeeName` cell's own painted
     * box fully covers `colId`'s own scrolling control — both edges, never just the center — via
     * real, current `getBoundingClientRect()` geometry (never CSS/class inspection, never
     * `elementFromPoint`, which Scenario J's own doc comment already established is blind to this
     * failure mode for a different reason: here the boxes usually don't even overlap enough at the
     * edge for a hit-test at that exact pixel to be a meaningful proof either way). Requires at
     * least one row actually checked, so a selector/setup mistake fails loudly instead of silently
     * passing on zero matches. */
    async function assertFrozenPaneCoversControlEveryRow(colId: string, controlTag: 'button' | 'input') {
      // `[data-col-id="employeeName"][role="cell"]` matches every *virtualized body row* plus the
      // totals row's own "N employees" cell (same convention Scenario G/H/I's own
      // `identityCells.first()`/`.last()` already relies on) — the totals row has no per-column
      // control of its own, so it's excluded here before comparing counts against `controls` below.
      const allNameCells = await grid.locator('[data-col-id="employeeName"][role="cell"]').all();
      const nameCells = allNameCells.slice(0, -1);
      const controls = await grid.locator(`[data-col-id="${colId}"] ${controlTag}`).all();
      expect(nameCells.length, `Scenario L setup: no mounted employeeName body-row cells found for colId="${colId}"`).toBeGreaterThan(0);
      expect(controls.length, `Scenario L setup: no mounted ${controlTag} controls found for colId="${colId}"`).toBe(nameCells.length);

      for (let i = 0; i < nameCells.length; i++) {
        const nameBox = (await nameCells[i]!.boundingBox())!;
        const controlBox = (await controls[i]!.boundingBox())!;
        expect(
          nameBox.y <= controlBox.y + 0.5,
          `${colId} row ${i}: frozen employeeName top (${nameBox.y}) does not cover the scrolling control's own top (${controlBox.y}) — a top-edge sliver is visible.`,
        ).toBe(true);
        expect(
          nameBox.y + nameBox.height >= controlBox.y + controlBox.height - 0.5,
          `${colId} row ${i}: frozen employeeName bottom (${nameBox.y + nameBox.height}) does not cover the scrolling control's own bottom (${controlBox.y + controlBox.height}) — a bottom-edge sliver is visible.`,
        ).toBe(true);
      }
    }

    async function scrollColumnUnderneathPane(colId: string) {
      await grid.evaluate((el) => {
        el.scrollLeft = 0;
      });
      const codeHeaderBox0 = (await page.locator('[data-col-id="employeeCode"][role="columnheader"]').boundingBox())!;
      const targetHeaderBox0 = (await page.locator(`[data-col-id="${colId}"][role="columnheader"]`).boundingBox())!;
      await scrollGridHorizontally(page, Math.round(targetHeaderBox0.x - codeHeaderBox0.x));
    }

    // Top of the grid (vertical scroll 0) — the first virtualized mount, no recycling yet.
    await scrollColumnUnderneathPane('units');
    await assertFrozenPaneCoversControlEveryRow('units', 'button');
    await scrollColumnUnderneathPane('days');
    await assertFrozenPaneCoversControlEveryRow('days', 'input');
    await scrollColumnUnderneathPane('fine');
    await assertFrozenPaneCoversControlEveryRow('fine', 'input');

    // Scroll vertically to the bottom — forces the virtualizer to unmount the top rows and mount a
    // fresh set at the bottom (row recycling), proving the fix isn't specific to whichever DOM nodes
    // happened to mount first.
    await grid.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(150);
    await expect(grid.getByText(employeeNames[employeeNames.length - 1]!)).toBeVisible({ timeout: 5000 });
    await scrollColumnUnderneathPane('units');
    await assertFrozenPaneCoversControlEveryRow('units', 'button');
    await scrollColumnUnderneathPane('eobiAmount');
    await assertFrozenPaneCoversControlEveryRow('eobiAmount', 'input');

    // Back to the top — the recycled-back-again row set must still hold the invariant.
    await grid.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(150);
    await expect(grid.getByText(employeeNames[0]!)).toBeVisible({ timeout: 5000 });
    await scrollColumnUnderneathPane('otHours');
    await assertFrozenPaneCoversControlEveryRow('otHours', 'input');

    // The totals row's own identity cell must also occupy its full row height (Part 7 of this UAT
    // correction — consistency across every layer, not a body-row-only hack), even though it has no
    // bordered control of its own to visibly bleed today: checked directly against the totals row's
    // own container height, the same invariant applied at the one remaining layer. `closest()` via
    // `evaluate` (rather than a second Playwright locator with a `has:` filter, which resolved
    // ambiguously against every `[role="row"]` on the page and timed out) — the totals row is this
    // cell's own unique DOM ancestor, so this is both simpler and unambiguous.
    //
    // Compared against the row's own *content* box, not its outer border box: the totals row itself
    // carries a real, always-opaque `border-t-2` (`payroll-entry-totals-row.tsx`) that is part of the
    // row's own static decoration, not scrolling content a frozen cell could ever need to occlude —
    // `self-stretch` correctly fills the flex container's content box (inside the border), so the
    // border width must be subtracted from the row's own box before comparing, or this assertion
    // would fail on the border itself rather than on any real coverage gap.
    const totalsNameCell = grid.locator('[data-col-id="employeeName"][role="cell"]').last();
    const totalsGeometry = await totalsNameCell.evaluate((cell) => {
      const cellRect = cell.getBoundingClientRect();
      const row = cell.closest('[role="row"]')!;
      const rowRect = row.getBoundingClientRect();
      const rowStyle = getComputedStyle(row);
      const borderTop = parseFloat(rowStyle.borderTopWidth) || 0;
      const borderBottom = parseFloat(rowStyle.borderBottomWidth) || 0;
      return {
        cellTop: cellRect.top,
        cellBottom: cellRect.bottom,
        rowContentTop: rowRect.top + borderTop,
        rowContentBottom: rowRect.bottom - borderBottom,
      };
    });
    expect(Math.round(totalsGeometry.cellTop)).toBe(Math.round(totalsGeometry.rowContentTop));
    expect(Math.round(totalsGeometry.cellBottom)).toBe(Math.round(totalsGeometry.rowContentBottom));
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
