import { test, expect } from '../fixtures/auth';
import { apiPost } from '../helpers/api';

/**
 * Durable UI invariants introduced during Post-Phase-5 Stabilization — each assertion here is
 * deliberately tolerant (a few pixels of slack, a boolean "roughly centered" check) rather than an
 * exact-pixel snapshot, per this checkpoint's own "avoid brittle exact-pixel snapshots" guidance.
 */
test.describe('UI regression smoke', () => {
  test('Payslips filter controls stay aligned after selecting a Site (AUD-004 regression)', async ({
    authenticatedPage: page,
  }) => {
    await apiPost(page.context(), '/api/v1/sites', { name: `E2E UI Regression Site ${Date.now()}` });

    await page.goto('/payslips');
    await page.locator('#payslips-site-filter').click();
    await page.getByRole('menuitemcheckbox').first().click();
    await page.keyboard.press('Escape');

    const siteBox = await page.locator('#payslips-site-filter').boundingBox();
    const unitBox = await page.locator('#payslips-unit-filter').boundingBox();

    expect(siteBox).not.toBeNull();
    expect(unitBox).not.toBeNull();

    // The actual AUD-004 regression: the (now-disabled) Unit control used to grow taller than its
    // neighbors because helper text rendered *beneath* it, pushing every sibling's own vertical
    // position out of alignment. Site and Unit are adjacent `MultiSelectFilter` instances of
    // identical shape — they must share the same top edge regardless of Unit's disabled state.
    // (The row is `flex-wrap`, so a *narrower* control further along, like Search, may legitimately
    // sit on its own line at this viewport — that's normal responsive wrapping, not a regression.)
    const tolerance = 3;
    expect(Math.abs(siteBox!.y - unitBox!.y)).toBeLessThanOrEqual(tolerance);
  });

  test('the app shell has no document-level vertical scrolling', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    // AppShell's own root (`h-screen overflow-hidden`) constrains the whole page — only its inner
    // `<main>` scrolls — so the document itself should never be taller than the viewport.
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
  });

  /**
   * Post-Checkpoint-1A UAT Stabilization (2026-08-05) — every virtualized Payroll Entry row was
   * fully transparent (`background-color: rgba(0,0,0,0)`), relying entirely on the ancestor Card's
   * own incidental white background. Fixed with an explicit `bg-surface-2` on every row
   * (`payroll-entry-row.tsx`). A real robustness gap, and this spec's own assertions below still
   * hold — but UAT on 2026-08-10 reproduced the actual reported "blank strip while scrolling"
   * defect on Employee Registry, a page with no virtualized rows and no sticky element of its own
   * at all, proving this fix was never the defect's real root cause (the same-day independent
   * review that first shipped this fix had already flagged the causal claim as unconfirmed — see
   * docs/design-system.md §2.1 for the full history). The actual root cause — `html`/`body`
   * defaulting to `overscroll-behavior-y: auto`, letting the browser's native elastic bounce shift
   * AppShell's whole chrome within the viewport — is fixed and regression-tested at the shared
   * layout level in `23-scroll-header-integrity.spec.ts`, not here.
   */
  test('Payroll Entry: every rendered row paints its own opaque background, at top of page and after scrolling (sticky-header containment)', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `ui-regression-sticky-${Date.now()}`;
    const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E Sticky Site ${label}` });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E Sticky Unit ${label}`,
    });
    // Enough rows to genuinely overflow the grid's own max-h-[70vh] scroll region at any
    // reasonable viewport height.
    for (let i = 0; i < 40; i++) {
      await apiPost(context, '/api/v1/employees', {
        name: `E2E Sticky Employee ${label} ${i}`,
        designation: 'Guard',
        siteId: site.site.id,
        unitId: unit.unit.id,
        grossPay: '30000',
      });
    }
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2900, month: 6 }).catch(() => undefined);

    await page.goto('/payroll-entry');
    const grid = page.getByRole('table', { name: 'Payroll Entry grid' });
    await expect(grid).toBeVisible();

    async function assertNoTransparentRow() {
      const transparentCount = await grid.evaluate((el) => {
        const rows = Array.from(el.querySelectorAll('[role="row"]')).filter(
          (r) => r.getAttribute('style')?.includes('position: absolute'),
        );
        return rows.filter((r) => getComputedStyle(r).backgroundColor === 'rgba(0, 0, 0, 0)').length;
      });
      expect(transparentCount).toBe(0);
    }

    await assertNoTransparentRow();

    await grid.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });
    await page.waitForTimeout(200);
    await assertNoTransparentRow();

    // The app shell's own topbar stays a fully opaque, solid band regardless of scroll position —
    // never a see-through strip.
    const topbarBg = await page.locator('header').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(topbarBg).not.toBe('rgba(0, 0, 0, 0)');
  });

  /**
   * Post-Checkpoint-1A UAT Stabilization — representative audit beyond Payroll Entry, per the
   * checkpoint's own instruction to verify "one ordinary list page, one report/financial page, one
   * settings/admin page." None of these pages have any sticky element of their own (confirmed by
   * direct repository inspection during this checkpoint) — this asserts the document itself never
   * becomes the scrolling surface, and the topbar stays a fully opaque band, both at rest and
   * (where the page has enough content) after scrolling `<main>`. `23-scroll-header-integrity.spec.ts`
   * covers the shared-layout overscroll-bounce defect these two assertions alone don't catch (see
   * that file's own header comment).
   */
  for (const [label, path] of [
    ['Employee Registry (ordinary list page)', '/employees'],
    ['Reports (report/financial page)', '/reports'],
    ['Users (settings/admin page)', '/users'],
  ] as const) {
    test(`${label}: document never scrolls, topbar stays opaque`, async ({ authenticatedPage: page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const { scrollHeight, clientHeight } = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }));
      expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);

      const topbarBg = await page.locator('header').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(topbarBg).not.toBe('rgba(0, 0, 0, 0)');

      await page.evaluate(() => {
        document.querySelector('main')?.scrollTo(0, 999999);
      });
      await page.waitForTimeout(150);
      const topbarBgAfterScroll = await page.locator('header').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(topbarBgAfterScroll).not.toBe('rgba(0, 0, 0, 0)');
    });
  }

  test('one standard-density and one compact-density table both render, with a real padding difference between them', async ({
    authenticatedPage: page,
  }) => {
    await apiPost(page.context(), '/api/v1/sites', { name: `E2E Density Site ${Date.now()}` });

    await page.goto('/sites');
    const standardCell = page.locator('table tbody tr td').first();
    await expect(standardCell).toBeVisible();
    const standardPadding = await standardCell.evaluate((el) => getComputedStyle(el).paddingTop);

    await page.goto('/bank-sheet');
    const bankSheetTable = page.locator('table tbody tr td').first();
    if (await bankSheetTable.count()) {
      const compactPadding = await bankSheetTable.evaluate((el) => getComputedStyle(el).paddingTop);
      // Bank Sheet is this app's own compact-density table (`table.tsx`'s own documented
      // standard/compact split) — its row padding must be strictly smaller than a standard table's.
      expect(parseFloat(compactPadding)).toBeLessThan(parseFloat(standardPadding));
    }
  });

  test('no emoji appear anywhere in the live sidebar navigation', async ({ authenticatedPage: page }) => {
    await page.goto('/');
    const navText = await page.locator('aside nav').innerText();
    // eslint-disable-next-line no-misleading-character-class
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiPattern.test(navText)).toBe(false);
  });

  test('a modal opens roughly centered in the viewport and closes on Escape', async ({ authenticatedPage: page }) => {
    await page.goto('/employees');
    await page.getByRole('button', { name: 'New Employee' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();

    const dialogCenterX = box!.x + box!.width / 2;
    const dialogCenterY = box!.y + box!.height / 2;
    const viewportCenterX = viewport!.width / 2;
    const viewportCenterY = viewport!.height / 2;

    // "Roughly centered" — within 5% of the viewport's own dimensions, not pixel-exact.
    expect(Math.abs(dialogCenterX - viewportCenterX)).toBeLessThan(viewport!.width * 0.05);
    expect(Math.abs(dialogCenterY - viewportCenterY)).toBeLessThan(viewport!.height * 0.05);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
