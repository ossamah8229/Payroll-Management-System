import type { PDFOptions } from 'puppeteer';
import { closeBrowser, discardBrowser, getBrowser } from './browser';
import { logger } from '../logger';
import { env } from '../../config/env';
import { normalizeError } from './normalize-error';
import { closeTestWorkerBrowser, discardTestWorkerBrowser, renderViaTestWorker } from './worker/pdf-worker-client';

export interface RenderPdfOptions {
  /** Defaults to `'A4'` — standard for Pakistani business documents; passed straight through to
   * Puppeteer, so a future document type can override it without this function changing. */
  format?: PDFOptions['format'];
  margin?: PDFOptions['margin'];
  /** Off by default (a single-page Payslip needs none); a future multi-page document (e.g. a
   * Statement of Account) can turn this on and supply `headerTemplate`/`footerTemplate` without
   * any change here — this wrapper stays generic, never assumes a specific document's shape. */
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
}

/** Which step of a single render attempt failed — attached to a caught error's own `stage`
 * property (Phase 7H) so the retry-exhausted diagnostic can report exactly where rendering broke,
 * without needing a parallel try/catch pyramid at every call site. */
export type RenderStage = 'browser-launch' | 'new-page' | 'set-content' | 'pdf-generation' | 'page-close';

async function withStage<T>(stage: RenderStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error && typeof error === 'object' && !('stage' in error)) {
      (error as Record<string, unknown>).stage = stage;
    }
    throw error;
  }
}

/**
 * The one generic HTML → PDF renderer in this codebase — document-agnostic on purpose, per this
 * checkpoint's own architecture review ("reusable PDF utilities that may later be shared by Bank
 * Sheets, Cash Receiving Sheets, Statements, and future reports"). Takes a fully-formed,
 * already-escaped HTML string and returns a PDF `Buffer`; has no knowledge of Payslips or any
 * other specific document — that belongs entirely to `templates/*.ts`.
 *
 * Renders via `page.setContent()`, never `page.goto()` — there is no live URL to navigate to
 * (Checkpoint 6.1's architecture review's own decision: a static HTML string, not the
 * authenticated frontend app, so there is no cookie/session handoff to a headless browser and no
 * per-render network/navigation cost, which matters at Checkpoint 6.3's batch scale).
 *
 * Stateless: returns a `Buffer` only, never passes a `path` to `page.pdf()` — nothing is ever
 * written to this process's filesystem by this function.
 *
 * **Pre-Deployment Reliability Checkpoint — one bounded recovery retry**: `getBrowser()`'s own
 * health check only detects a browser whose connection has fully dropped, not one that is still
 * connected but transiently unable to service a new page (measured directly on this project's own
 * resource-constrained dev/CI sandbox — a real, if intermittent, condition, not hypothetical). If
 * the render attempt throws for any reason, this discards the shared browser
 * (`discardBrowser()`) and retries exactly once against a freshly launched instance. A second
 * failure is never retried again — it propagates to the caller exactly as before, so a genuinely
 * broken configuration still surfaces as a real error rather than being silently masked.
 *
 * **Phase 7H — test-only worker delegation**: in `NODE_ENV=test`, the actual Puppeteer work below
 * (`renderOnce`) is never invoked in-process. Jest's `--experimental-vm-modules` mode disposes each
 * test *file's* own VM realm independently, and this module's dynamic `import('puppeteer')`
 * (`browser.ts`'s own documented ESM-interop workaround) is a genuine, sometimes slow, native
 * Node operation — under real concurrent load, proven by direct reproduction (see
 * `docs/architecture/testing.md`'s "Backend PDF test architecture" section) to sometimes resolve
 * *after* Jest has already torn down the realm that started it, which Jest's own module registry
 * then rejects with `"Test environment has been torn down"` — a Jest/VM-lifecycle race, not an
 * application defect (confirmed: the identical render always succeeds outside Jest). Delegating to
 * `pdf-worker-client.ts`, a persistent child process untouched by any Jest VM realm, eliminates the
 * race entirely while still exercising this exact `renderOnce`/`browser.ts` code — the worker
 * imports and calls them directly, so production behavior and output are unchanged either way.
 */
export async function renderHtmlToPdf(html: string, options: RenderPdfOptions = {}): Promise<Buffer> {
  const attempt = env.NODE_ENV === 'test' ? renderViaTestWorker : renderOnce;
  const discard = env.NODE_ENV === 'test' ? discardTestWorkerBrowser : discardBrowserSafe;
  return renderWithOneRetry(html, options, attempt, discard);
}

/**
 * The retry-exhausted-diagnostic wrapper itself, with the actual render/discard implementations
 * injected — exported (Phase 7H) purely so `pdf-render-diagnostics.test.ts` can prove its behavior
 * (exactly one retry, diagnostic only on the second failure, original error rethrown unchanged)
 * with plain fake functions, instead of needing to mock `browser.ts` and fight `renderHtmlToPdf`'s
 * own `NODE_ENV`-based worker delegation above to reach it. Never called with anything other than
 * the two implementation pairs `renderHtmlToPdf` selects.
 */
export async function renderWithOneRetry(
  html: string,
  options: RenderPdfOptions,
  attempt: (html: string, options: RenderPdfOptions) => Promise<Buffer>,
  discard: () => Promise<void>,
): Promise<Buffer> {
  try {
    return await attempt(html, options);
  } catch (firstError) {
    logger.warn(
      { error: firstError },
      'PDF render failed — discarding the shared browser and retrying once against a freshly launched instance',
    );
    await discard();
    try {
      return await attempt(html, options);
    } catch (secondError) {
      reportExhaustedPdfRenderFailure(secondError);
      throw secondError;
    }
  }
}

function discardBrowserSafe(): Promise<void> {
  discardBrowser();
  return Promise.resolve();
}

/**
 * Phase 7H — real-Puppeteer test suites (`payslips.test.ts`, `statements.test.ts`,
 * `payroll-hold-workflow.test.ts`) proactively recycle the browser at points they know are
 * memory-heavy (e.g. right after a 300-employee batch render), the same way `closeBrowser()`
 * (`lib/pdf/browser.ts`) always let them. In `NODE_ENV=test`, rendering happens in the shared
 * worker process (see `renderHtmlToPdf` above), not in that test file's own in-process singleton —
 * calling `browser.ts`'s `closeBrowser()` directly from a test file would now silently close
 * nothing (its own `browserPromise` was never populated). Test files should call this instead of
 * `browser.ts`'s `closeBrowser()` directly; it recycles whichever one is actually rendering.
 */
export async function closePdfRenderer(): Promise<void> {
  if (env.NODE_ENV === 'test') {
    await closeTestWorkerBrowser();
    return;
  }
  await closeBrowser();
}

/**
 * Phase 7G/7H — `backend/src/lib/logger.ts` sets `level: 'silent'` whenever `NODE_ENV === 'test'`,
 * so a render failure that survives the one retry above was previously invisible in CI (confirmed
 * directly: grepping a full CI log for an actual occurrence of this failure found no trace of the
 * underlying exception anywhere). This is the one, narrow exception to that silence — fires only
 * once *both* attempts have failed, only in `NODE_ENV=test`, and only with fields safe to expose
 * (the error's own identity/stack/stage and fixed retry bookkeeping). Deliberately never passed
 * `html` or `options` (`headerTemplate`/`footerTemplate` can carry real payroll data) — only the
 * caught `error`. Uses `console.error` directly rather than the shared `logger` so no other call
 * site's test-time silence is affected; `no-console` already allows `error`
 * (`eslint.config.mjs`). Wrapped so a serialization failure here can never mask or replace the
 * real error. `normalizeError` (Phase 7H) extracts name/message/stack by duck-typing rather than
 * `instanceof Error`, so a cross-realm error (e.g. the Jest VM-teardown error this was built to
 * catch) is reported accurately instead of collapsing to a generic `"object"` fallback.
 */
function reportExhaustedPdfRenderFailure(error: unknown): void {
  if (env.NODE_ENV !== 'test') return;
  try {
    const normalized = normalizeError(error);
    const stage = error && typeof error === 'object' && 'stage' in error ? (error as { stage: unknown }).stage : undefined;
    console.error(
      JSON.stringify({
        msg: 'PDF render failed after exhausting its one retry',
        errorName: normalized.name,
        errorMessage: normalized.message,
        stack: normalized.stack,
        stage,
        attempt: 2,
        totalAttempts: 2,
        browserDiscardedAndRelaunched: true,
      }),
    );
  } catch {
    // Diagnostics must never mask or replace the real error — if serialization fails for any
    // reason, the original error still propagates from renderHtmlToPdf exactly as before.
  }
}

/**
 * The real, always-in-process renderer — exported (Phase 7H) so both `renderHtmlToPdf` above
 * (directly, outside Jest) and `pdf-worker.entry.ts` (the Phase 7H test worker, which always runs
 * outside any Jest VM realm) can call the exact same code, rather than the worker duplicating or
 * re-implementing any part of it. Never branches on `NODE_ENV` itself — the worker delegation
 * decision lives entirely in `renderHtmlToPdf` above.
 */
export async function renderOnce(html: string, options: RenderPdfOptions): Promise<Buffer> {
  const browser = await withStage('browser-launch', () => getBrowser());
  const page = await withStage('new-page', () => browser.newPage());

  try {
    await withStage('set-content', () => page.setContent(html, { waitUntil: 'load' }));
    const uint8 = await withStage('pdf-generation', () =>
      page.pdf({
        format: options.format ?? 'A4',
        // Print backgrounds must render — the "paper" card border and any tinted rows in the
        // shared print stylesheet are backgrounds, and would silently vanish without this.
        printBackground: true,
        margin: options.margin ?? { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
        displayHeaderFooter: options.displayHeaderFooter ?? false,
        headerTemplate: options.headerTemplate,
        footerTemplate: options.footerTemplate,
      }),
    );
    return Buffer.from(uint8);
  } finally {
    // The page, not the browser, is closed after every render — the browser instance itself is
    // the reusable singleton (`browser.ts`); a leaked page would otherwise accumulate memory
    // across requests for the life of the process.
    await withStage('page-close', () => page.close());
  }
}
