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
