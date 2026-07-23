import { test, expect } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';

/**
 * UAT Defect 2 (Post-Phase-5 Stabilization Checkpoint 4D correction) — the Roles & Permissions
 * editor had excessive empty scrolling near the bottom, with the dialog's own frame appearing to
 * separate from its content. Root cause: the permission matrix
 * (`frontend/src/components/roles/permission-matrix.tsx`) nested its own independently
 * `max-h-[420px]`/`overflow-y-auto` scroll region *inside* `ModalContent`'s own
 * `max-h-[85vh]`/`overflow-y-auto` region (`frontend/src/components/ui/modal.tsx`) — two competing
 * scroll contexts in one dialog. Fixed at the shared `ModalContent`/`ModalFooter` level (a proper
 * flex column: non-scrolling header, exactly one scrolling body with `min-h-0`, a `sticky
 * bottom-0` footer), not a one-off patch to the Roles page — every dialog in the app benefits, and
 * this spec's own measurements (not just screenshots) prove the invariant holds.
 *
 * Uses a role with the *entire* permission catalog assigned, through its Edit modal — the
 * shortest realistic content this app has is already too tall to fit `max-h-[85vh]` on any of the
 * three required viewports, so every one of them genuinely exercises the scroll region.
 */
const SCREENSHOT_DIR = 'test-results/permission-dialog-layout-screenshots';

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

test.describe('Roles & Permissions dialog layout (UAT Defect 2)', () => {
  for (const viewport of VIEWPORTS) {
    test(`scrolls cleanly with no excessive trailing space at ${viewport.name}`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const label = Date.now();
      const catalogRes = await apiGet<{ permissions: { key: string }[] }>(
        page.context(),
        '/api/v1/roles/permissions',
      );
      const allPermissionKeys = catalogRes.body.permissions.map((p) => p.key);
      expect(allPermissionKeys.length).toBeGreaterThan(10); // sanity — this is meant to overflow

      const role = await apiPost<{ role: { id: string; name: string } }>(page.context(), '/api/v1/roles', {
        name: `E2E Dialog Layout Role ${viewport.name} ${label}`,
        permissionKeys: allPermissionKeys,
      });

      await page.goto('/roles');
      const roleRow = page.locator('tr', { hasText: role.role.name });
      await roleRow.getByRole('button', { name: /Actions for/ }).click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // Wait for the permission matrix's own detail fetch to hydrate (roles-page.tsx's lazy
      // hydration) before measuring — an empty/loading matrix wouldn't exercise the overflow.
      await expect(page.getByRole('checkbox').first()).toBeVisible();

      // --- Structural measurements (not just screenshots) ---

      // 1. The dialog's own bounding box must stay fully within the viewport at every point.
      const dialogBoxBefore = await dialog.boundingBox();
      expect(dialogBoxBefore).not.toBeNull();
      expect(dialogBoxBefore!.y).toBeGreaterThanOrEqual(0);
      expect(dialogBoxBefore!.y + dialogBoxBefore!.height).toBeLessThanOrEqual(viewport.height + 1);

      // 2. No nested scroll regions: this is the actual structural bug (not merely "does content
      // currently overflow," which depends on exact content height and can pass or fail by
      // accident depending on viewport/content size — confirmed by first writing this test against
      // the pre-fix code with an overflow-*amount* assertion, which passed even against the bug,
      // since the outer frame didn't happen to overflow at every content size tested). The
      // historical bug was structural: the permission matrix had its own `overflow-y: auto`
      // *inside* `ModalContent`'s own `overflow-y: auto` — checked here by CSS property alone,
      // regardless of whether either happens to currently overflow its content.
      const scrollableRegions = await dialog.evaluate((dialogEl) => {
        // `dialogEl` itself (matched by role="dialog", i.e. Radix's own DialogPrimitive.Content —
        // exactly the element the historical bug put `overflow-y: auto` on directly) must be
        // included, not just its descendants — querySelectorAll('*') alone would silently miss it.
        const all = [dialogEl, ...Array.from(dialogEl.querySelectorAll<HTMLElement>('*'))];
        const scrollable = all.filter((el) => {
          const style = getComputedStyle(el);
          return style.overflowY === 'auto' || style.overflowY === 'scroll';
        });
        const nestedCount = scrollable.filter((el) =>
          scrollable.some((other) => other !== el && other.contains(el)),
        ).length;
        return { count: scrollable.length, nestedCount };
      });
      expect(scrollableRegions.nestedCount).toBe(0);
      expect(scrollableRegions.count).toBe(1);

      // 3. That one scroll region actually overflows for this content (a full permission catalog)
      // — otherwise the "no excessive trailing space" claim below would be vacuous.
      const overflowAmount = await dialog.evaluate((dialogEl) => {
        const all = [dialogEl, ...Array.from(dialogEl.querySelectorAll<HTMLElement>('*'))];
        const el = all.find((node) => {
          const style = getComputedStyle(node);
          return (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
        });
        return el ? el.scrollHeight - el.clientHeight : 0;
      });
      expect(overflowAmount).toBeGreaterThan(0);
      // Generous, but rules out a runaway value — the double-scroll-region bug inflated the outer
      // frame's own scrollHeight well past any real content height.
      expect(overflowAmount).toBeLessThan(viewport.height * 2);

      await page.screenshot({ path: `${SCREENSHOT_DIR}/${viewport.name}-01-top.png` });

      // --- Scroll to the middle, then the bottom, verifying the frame tracks the content (no
      // "frame stays behind" desync) and the footer/final content become reachable and visible. ---
      const scrollLocator = dialog.locator('.overflow-y-auto').first();
      await scrollLocator.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2;
      });
      const dialogBoxMiddle = await dialog.boundingBox();
      expect(dialogBoxMiddle).not.toBeNull();
      // The dialog's own frame position must not move while its internal content scrolls — this is
      // exactly the reported "content moves upward while the outline remains behind" symptom.
      expect(Math.abs(dialogBoxMiddle!.y - dialogBoxBefore!.y)).toBeLessThan(1);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${viewport.name}-02-middle.png` });

      await scrollLocator.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const dialogBoxAfter = await dialog.boundingBox();
      expect(Math.abs(dialogBoxAfter!.y - dialogBoxBefore!.y)).toBeLessThan(1);

      // 4. The footer (Cancel/Save) is visible and usable once scrolled to the bottom — not cut
      // off, not requiring further scroll past visible content.
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();

      // 5. Scrolling past the end does not reveal underlying page content — the overlay still
      // fully covers the viewport (Playwright's `toBeVisible` alone can't detect z-index
      // occlusion, so this checks the overlay's own bounding box directly, not just presence).
      const overlay = page.locator('.fixed.inset-0.bg-black\\/40');
      await expect(overlay).toBeVisible();
      const overlayBox = await overlay.boundingBox();
      expect(overlayBox).not.toBeNull();
      expect(overlayBox!.x).toBeLessThanOrEqual(0);
      expect(overlayBox!.y).toBeLessThanOrEqual(0);
      expect(overlayBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
      expect(overlayBox!.height).toBeGreaterThanOrEqual(viewport.height - 1);

      await page.screenshot({ path: `${SCREENSHOT_DIR}/${viewport.name}-03-bottom.png` });

      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();

      // 6. Closing restores body scroll (Radix's own behavior, but confirm it isn't broken by the
      // structural change) — the underlying page is interactive again.
      await expect(page.getByRole('heading', { name: 'All Roles' })).toBeVisible();
    });
  }

  test('other major dialogs are unaffected by the shared ModalContent/ModalFooter change', async ({
    authenticatedPage: page,
  }) => {
    // Regression check per the checkpoint's own instruction: since ModalContent/ModalFooter are
    // shared by every dialog in the app, a structural change there needs at least one other,
    // unrelated dialog confirmed still correct — not just the one that had the reported bug.
    await page.goto('/users');
    await page.getByRole('button', { name: 'New User' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create user' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    await page.goto('/sites');
    await page.getByRole('button', { name: 'New Site' }).click();
    const siteDialog = page.getByRole('dialog');
    await expect(siteDialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create site' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(siteDialog).not.toBeVisible();
  });
});
