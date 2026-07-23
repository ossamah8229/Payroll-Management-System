import type { Browser } from 'puppeteer';
import { logger } from '../logger';

/**
 * Singleton Puppeteer browser instance, reused across every PDF render in this process rather
 * than launched fresh per request — a cold launch costs roughly 1-2 seconds, which would make
 * even a single Payslip download noticeably slow, and is the single biggest lever for Checkpoint
 * 6.3's later batch generation (this checkpoint's own architecture review). This is the one
 * reusable piece every future PDF template (Bank Sheet, Cash Sheet, Statement) will also depend
 * on — kept document-agnostic on purpose.
 *
 * Lazily launched on first use (no PDF route hit yet ⇒ no browser process running, no cost paid
 * by a request that never touches PDF generation). A browser that has crashed or disconnected is
 * detected on next use and relaunched automatically, rather than left permanently broken for the
 * rest of the process's life.
 *
 * **Deviation from the approved architecture review, discovered during implementation — recorded
 * here, not silently worked around:** Puppeteer 22+ ships ESM-only (`"type": "module"`, no CJS
 * build), while this backend compiles to CommonJS (`backend/tsconfig.json`). A plain `import
 * puppeteer from 'puppeteer'` fails at the Jest/ts-jest transform layer (`SyntaxError: Unexpected
 * token 'export'`), and TypeScript's own dynamic `import()` syntax doesn't help either — verified
 * directly: under a CommonJS module target, `tsc` downlevels `await import('puppeteer')` to
 * `await Promise.resolve().then(() => require('puppeteer'))`, which fails identically
 * (`ERR_REQUIRE_ESM`). The fix, verified working end-to-end (typecheck, Jest, and a real
 * Puppeteer launch): load the specifier through `new Function(...)`, which hides the `import(...)`
 * call from TypeScript's static analysis entirely, so it survives as a genuine native dynamic
 * import at runtime rather than being downleveled. This is a documented, standard interop pattern
 * for consuming an ESM-only package from a CommonJS TypeScript project — not a hack specific to
 * this codebase.
 */
const importPuppeteer = new Function('return import("puppeteer")') as () => Promise<typeof import('puppeteer')>;

let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const { default: puppeteer } = await importPuppeteer();
  return puppeteer.launch({
    headless: true,
    // --no-sandbox is required in most containerized hosting environments (confirmed necessary
    // in this project's own sandboxed dev session by direct smoke test) where Chrome's own
    // OS-level sandbox needs kernel namespace permissions that aren't available — the same
    // reason this flag is near-universal in CI/container Puppeteer deployments, including the
    // Render target this project deploys to.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

/** Returns the shared browser instance, launching it on first call and relaunching it if the
 * previous instance has died. Every PDF-rendering call site goes through this — no template or
 * route ever calls `puppeteer.launch()` directly.
 *
 * **Concurrency-safe relaunch**: `current` captures the exact promise this call started with, so
 * only the caller that actually observed a failed/disconnected browser triggers a relaunch — a
 * compare-and-swap against the module-level `browserPromise`, not an unconditional overwrite. Two
 * requests racing against the same dead browser would otherwise each independently call
 * `launchBrowser()`, leaving one browser process orphaned (never referenced by `browserPromise`
 * again, so `closeBrowser()` could never close it) — this guard makes the second, redundant
 * relaunch instead simply await whatever the first caller already started (or whatever a still
 * later caller has since set, if several races stack up). */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }

  const current = browserPromise;
  let browser: Browser;
  try {
    browser = await current;
  } catch (error) {
    logger.error({ error }, 'Puppeteer browser failed to launch — retrying once');
    if (browserPromise === current) {
      browserPromise = launchBrowser();
    }
    return browserPromise;
  }

  if (!browser.connected) {
    logger.warn('Puppeteer browser was disconnected — relaunching');
    if (browserPromise === current) {
      browserPromise = launchBrowser();
    }
    return browserPromise;
  }

  return browser;
}

/** Closes the shared browser, if one was ever launched. Called from `server.ts`'s existing
 * graceful-shutdown handler (alongside `prisma.$disconnect()`) and from PDF-related test suites'
 * own `afterAll`, so neither a real process exit nor a Jest run leaves an orphaned Chrome
 * process. Safe to call even if no browser was ever launched. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const promise = browserPromise;
  browserPromise = null;
  try {
    const browser = await promise;
    await browser.close();
  } catch {
    // Already dead or never successfully launched — nothing left to close.
  }
}

/**
 * Pre-Deployment Reliability Checkpoint — discards the shared browser (best-effort close,
 * fire-and-forget) so the next `getBrowser()` call launches a fresh instance. Distinct from
 * `closeBrowser()`: this never awaits the close and never throws, since a browser too degraded
 * to service a page request may also be too degraded to close cleanly, and the caller (a render
 * already mid-recovery, see `render-pdf.ts`) must not itself be blocked or fail because of it.
 *
 * Exists to close a real gap in `getBrowser()`'s own health check: `!browser.connected` only
 * detects a browser whose DevTools Protocol connection has fully dropped (a crashed/killed
 * process) — it cannot detect a browser that is still connected but unable to service a *new*
 * page (e.g. transient OS-level memory pressure preventing a new renderer process from
 * spawning), which is exactly the failure shape a resource-constrained host can produce. Without
 * this, `getBrowser()` would keep handing back the same degraded instance indefinitely, since
 * nothing about it looks unhealthy by the one check that exists.
 */
export function discardBrowser(): void {
  const stale = browserPromise;
  browserPromise = null;
  if (!stale) return;
  stale
    .then((browser) => browser.close())
    .catch(() => {
      // Already dead, or never successfully launched — nothing left to close.
    });
}
