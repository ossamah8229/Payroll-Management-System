import sharp from 'sharp';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { apiPost } from '../helpers/api';
import { ensureAnyPayrollCycleExists } from '../helpers/fixtures';

/**
 * UAT 2026-08-10 — reopened scroll/header blank-space defect. `06-ui-regression.spec.ts`'s own
 * "sticky-header containment" test (Post-Checkpoint-1A UAT Stabilization, 2026-08-05) asserted that
 * every virtualized Payroll Entry row paints an opaque background — a real fix for a real gap, but
 * UAT on 2026-08-10 reproduced the *actual* reported defect on Employee Registry, a page with no
 * virtualization and no sticky element of its own at all, proving that fix never addressed the real
 * mechanism. The actual root cause: `html`/`body` defaulted to `overscroll-behavior-y: auto`, so a
 * trackpad/gesture scroll that overshoots the top of the page triggers the browser's own native
 * elastic bounce on the *document* — shifting AppShell's entire chrome (Topbar included) down
 * within the viewport and exposing `body`'s own `bg-bg` in a strip above it, where the opaque
 * Topbar should always stay. Fixed once, at the shared `AppShell`/`index.css` level
 * (`overscroll-y-none` on `html`/`body`, `overscroll-y-contain` on `<main>`) — see
 * docs/design-system.md §2.1 for the full history.
 */

const REPRESENTATIVE_PAGES = [
  ['Employee Registry', '/employees'],
  ['Payroll Entry', '/payroll-entry'],
  ['Project Sites', '/sites'],
  ['Reports catalogue', '/reports'],
  ['Salary Release', '/release'],
] as const;

test.describe('AppShell scroll/header integrity', () => {
  for (const [label, path] of REPRESENTATIVE_PAGES) {
    test(`${label}: html/body never elastic-bounce; <main> (if present) contains its own overscroll`, async ({
      authenticatedPage: page,
    }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const overscroll = await page.evaluate(() => {
        const main = document.querySelector('main');
        return {
          html: getComputedStyle(document.documentElement).overscrollBehaviorY,
          body: getComputedStyle(document.body).overscrollBehaviorY,
          main: main ? getComputedStyle(main).overscrollBehaviorY : null,
        };
      });

      // The document itself must never be able to rubber-band — this is what actually prevents
      // AppShell's chrome from ever shifting within the viewport, regardless of page content.
      expect(overscroll.html).toBe('none');
      expect(overscroll.body).toBe('none');
      if (overscroll.main !== null) {
        expect(overscroll.main).toBe('contain');
      }
    });
  }

  /** Establishes the scroll owner, records geometry before/after a substantial scroll, and proves
   * the header's position and opacity are unaffected — mandatory coverage per UAT. */
  async function assertScrollOwnerAndHeaderStability(page: Page, path: string, expectMainScrollable: boolean) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const before = await page.evaluate(() => {
      const main = document.querySelector('main');
      const header = document.querySelector('header');
      return {
        windowScrollY: window.scrollY,
        docScrollHeight: document.documentElement.scrollHeight,
        docClientHeight: document.documentElement.clientHeight,
        mainScrollable: main ? main.scrollHeight > main.clientHeight : null,
        headerTop: header ? header.getBoundingClientRect().top : null,
        headerBg: header ? getComputedStyle(header).backgroundColor : null,
      };
    });

    // The document itself is never the scroll owner (no double-scrollbar regression) — only
    // `<main>` (AppShell) ever scrolls.
    expect(before.windowScrollY).toBe(0);
    expect(before.docScrollHeight).toBeLessThanOrEqual(before.docClientHeight + 1);
    expect(before.headerTop).toBe(0);
    expect(before.headerBg).not.toBe('rgba(0, 0, 0, 0)');
    if (expectMainScrollable) {
      expect(before.mainScrollable).toBe(true);
    }

    await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 999_999));
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const header = document.querySelector('header');
      return {
        windowScrollY: window.scrollY,
        docScrollHeight: document.documentElement.scrollHeight,
        docClientHeight: document.documentElement.clientHeight,
        headerTop: header ? header.getBoundingClientRect().top : null,
        headerBg: header ? getComputedStyle(header).backgroundColor : null,
      };
    });

    // Header/top-surface position and opacity are unchanged after a substantial scroll, and the
    // document still never became the scroll owner.
    expect(after.windowScrollY).toBe(0);
    expect(after.docScrollHeight).toBeLessThanOrEqual(after.docClientHeight + 1);
    expect(after.headerTop).toBe(before.headerTop);
    expect(after.headerBg).toBe(before.headerBg);
  }

  test('Employee Registry: <main> is the scroll owner; header position/opacity unchanged after scrolling', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `scroll-integrity-${Date.now()}`;
    const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E ${label}` });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E ${label} Unit`,
    });
    await Promise.all(
      Array.from({ length: 45 }, (_, i) =>
        apiPost(context, '/api/v1/employees', {
          name: `E2E Scroll Employee ${label} ${i}`,
          designation: 'Guard',
          siteId: site.site.id,
          unitId: unit.unit.id,
          grossPay: '30000',
        }),
      ),
    );

    await assertScrollOwnerAndHeaderStability(page, '/employees', true);
  });

  test('Payroll Entry: <main> is the scroll owner; header position/opacity unchanged after scrolling', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const label = `scroll-integrity-pe-${Date.now()}`;
    const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E ${label}` });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E ${label} Unit`,
    });
    await Promise.all(
      Array.from({ length: 45 }, (_, i) =>
        apiPost(context, '/api/v1/employees', {
          name: `E2E Scroll PE Employee ${label} ${i}`,
          designation: 'Guard',
          siteId: site.site.id,
          unitId: unit.unit.id,
          grossPay: '30000',
        }),
      ),
    );
    await apiPost(context, '/api/v1/payroll-cycles', { year: 2900, month: 7 }).catch(() => undefined);

    await assertScrollOwnerAndHeaderStability(page, '/payroll-entry', true);
  });

  test('a long report page: <main> is the scroll owner, header position/opacity unchanged after scrolling', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();
    const { cycleId } = await ensureAnyPayrollCycleExists(context);
    const label = `scroll-integrity-report-${Date.now()}`;
    const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', { name: `E2E ${label}` });
    const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
      name: `E2E ${label} Unit`,
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        apiPost(context, '/api/v1/employees', {
          name: `E2E Report Employee ${label} ${i}`,
          designation: 'Guard',
          siteId: site.site.id,
          unitId: unit.unit.id,
          grossPay: '30000',
        }),
      ),
    );

    await assertScrollOwnerAndHeaderStability(page, `/payroll-cycles/${cycleId}/reports/project-site-payroll`, false);
  });

  /**
   * Direct, pixel-level proof — the same technique this UAT fix's own investigation used to first
   * reproduce the defect (CDP `Input.synthesizeScrollGesture` with `yOverscroll`, sampling the
   * rendered pixel color at the very top of the content area during the gesture). Before the fix,
   * this sampled `bg-bg` (the app's base background, rgb(240, 237, 232)) instead of the header's own
   * opaque white — a real, visually-confirmed gap opening in the top region while scrolling. Kept
   * as a real-Chromium regression guard alongside the deterministic `overscroll-behavior` assertions
   * above, which prove the *mechanism* is disabled; this proves the *symptom* cannot occur.
   */
  for (const [label, path] of [
    ['Employee Registry', '/employees'],
    ['Payroll Entry', '/payroll-entry'],
  ] as const) {
    test(`${label}: an overscroll gesture never paints a gap above the header`, async ({ authenticatedPage: page }) => {
      const context: BrowserContext = page.context();
      await apiPost(context, '/api/v1/payroll-cycles', { year: 2900, month: 8 }).catch(() => undefined);
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const expectedRgb = await page.locator('header').first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const expected = expectedRgb.match(/\d+/g)!.slice(0, 3).join(',');

      const main = page.locator('main');
      const box = await main.boundingBox();
      expect(box).not.toBeNull();

      const client = await context.newCDPSession(page);
      const gesture = client.send('Input.synthesizeScrollGesture', {
        x: box!.x + box!.width / 2,
        y: box!.y + 50,
        yDistance: 300,
        xDistance: 0,
        yOverscroll: 200,
        preventFling: true,
        speed: 300,
        gestureSourceType: 'touch',
      });

      const sampleX = Math.round(box!.x + 30);
      const samples: string[] = [];
      for (const delay of [60, 60, 60, 80]) {
        await page.waitForTimeout(delay);
        const buf = await page.screenshot({ clip: { x: sampleX, y: 0, width: 1, height: 1 } });
        const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
        samples.push(`${data[0]},${data[1]},${data[2]}`);
      }
      await gesture.catch(() => {});

      for (const sample of samples) {
        expect(sample).toBe(expected);
      }
    });
  }
});
