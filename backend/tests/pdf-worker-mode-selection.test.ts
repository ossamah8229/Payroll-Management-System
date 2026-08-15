/**
 * Phase 3A CI-hardening fix — proves the PDF worker delegation decision (`config/env.ts`'s
 * `usePdfTestWorker`, consumed by `lib/pdf/render-pdf.ts`'s `renderHtmlToPdf`) requires an
 * explicit `PDF_TEST_WORKER=1` in addition to `NODE_ENV=test`, not `NODE_ENV=test` alone.
 *
 * Root cause this guards against: the E2E harness runs the real *compiled* backend with
 * `NODE_ENV=test` (needed only for `auth.routes.ts`'s relaxed login rate limit), but that build's
 * `dist/` tree never contains the Jest-only worker's source-only entry point
 * (`lib/pdf/worker/pdf-worker.entry.ts`). Gating worker selection on bare `NODE_ENV=test` made
 * that real server try to spawn a file that doesn't exist on every PDF request — confirmed by
 * direct reproduction to burn ~90 seconds (three sequential 30s worker-ready timeouts) before
 * failing, well past Playwright's 60s download-event wait in `15-statements.spec.ts`.
 *
 * `config/env.ts` is a singleton parsed from `process.env` once at module load, so each case here
 * reloads it fresh (via `jest.isolateModules` + `require`, not a hoisted `jest.mock`) against its
 * own `process.env`, mirroring `pdf-worker-infrastructure.test.ts`'s own established pattern for
 * this exact constraint. `DATABASE_URL`/`SESSION_SECRET`/`CSRF_SECRET`/`CORS_ORIGIN`/`STORAGE_ROOT`
 * are left untouched from `tests/env.setup.ts`'s own real process-wide values so the schema still
 * validates — only `NODE_ENV`/`PDF_TEST_WORKER` vary per case.
 */
const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function loadUsePdfTestWorker(overrides: { NODE_ENV?: string; PDF_TEST_WORKER?: string }): boolean {
  let result = false;
  process.env = { ...ORIGINAL_ENV, ...overrides };
  if (overrides.PDF_TEST_WORKER === undefined) delete process.env.PDF_TEST_WORKER;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see file header
    const envModule = require('../src/config/env') as typeof import('../src/config/env');
    result = envModule.usePdfTestWorker;
  });

  return result;
}

describe('usePdfTestWorker — explicit flag, not bare NODE_ENV=test', () => {
  it('A. NODE_ENV=test + PDF_TEST_WORKER=1 (backend Jest) selects the test worker', () => {
    expect(loadUsePdfTestWorker({ NODE_ENV: 'test', PDF_TEST_WORKER: '1' })).toBe(true);
  });

  it('B. NODE_ENV=test + PDF_TEST_WORKER unset (the E2E harness shape) uses the real renderer', () => {
    expect(loadUsePdfTestWorker({ NODE_ENV: 'test' })).toBe(false);
  });

  it('C. NODE_ENV=production + PDF_TEST_WORKER unset uses the real renderer', () => {
    expect(loadUsePdfTestWorker({ NODE_ENV: 'production' })).toBe(false);
  });

  it('D. PDF_TEST_WORKER=1 outside a test runtime (e.g. a misconfigured production deploy) is ignored', () => {
    expect(loadUsePdfTestWorker({ NODE_ENV: 'production', PDF_TEST_WORKER: '1' })).toBe(false);
    expect(loadUsePdfTestWorker({ NODE_ENV: 'development', PDF_TEST_WORKER: '1' })).toBe(false);
  });
});

/**
 * The same four states, one level up — proves `renderHtmlToPdf` itself actually consults
 * `usePdfTestWorker` (not a stale/hardcoded check) by mocking both the worker client and the real
 * in-process renderer's own dependencies (`browser.ts`) and observing which one a render call
 * reaches. `browser.ts` is mocked with a fake browser/page pair rather than left real, so this
 * proves routing without ever launching actual Puppeteer/Chrome.
 */
describe('renderHtmlToPdf — routes to the worker or the real renderer accordingly', () => {
  async function renderAndObserve(overrides: {
    NODE_ENV?: string;
    PDF_TEST_WORKER?: string;
  }): Promise<{ usedWorker: boolean; usedRealRenderer: boolean; pdfBytes: Buffer }> {
    process.env = { ...ORIGINAL_ENV, ...overrides };
    if (overrides.PDF_TEST_WORKER === undefined) delete process.env.PDF_TEST_WORKER;

    let pdfBytes: Buffer = Buffer.alloc(0);
    const workerRender = jest.fn(async () => Buffer.from('%PDF-worker'));
    const realPdf = jest.fn(async () => new Uint8Array(Buffer.from('%PDF-real')));

    await new Promise<void>((resolve, reject) => {
      jest.isolateModules(() => {
        jest.doMock('../src/lib/pdf/worker/pdf-worker-client', () => ({
          renderViaTestWorker: workerRender,
          discardTestWorkerBrowser: jest.fn(async () => undefined),
          closeTestWorkerBrowser: jest.fn(async () => undefined),
        }));

        const fakePage = {
          setContent: jest.fn(async () => undefined),
          pdf: realPdf,
          close: jest.fn(async () => undefined),
        };
        const fakeBrowser = { connected: true, newPage: jest.fn(async () => fakePage) };
        jest.doMock('../src/lib/pdf/browser', () => ({
          getBrowser: jest.fn(async () => fakeBrowser),
          closeBrowser: jest.fn(async () => undefined),
          discardBrowser: jest.fn(),
        }));

        // eslint-disable-next-line @typescript-eslint/no-require-imports -- see file header
        const renderPdf = require('../src/lib/pdf/render-pdf') as typeof import('../src/lib/pdf/render-pdf');
        renderPdf
          .renderHtmlToPdf('<html><body>selection test</body></html>')
          .then((buffer) => {
            pdfBytes = buffer;
            resolve();
          })
          .catch(reject);
      });
    });

    return { usedWorker: workerRender.mock.calls.length > 0, usedRealRenderer: realPdf.mock.calls.length > 0, pdfBytes };
  }

  it('A. NODE_ENV=test + PDF_TEST_WORKER=1 calls the test worker, never the real renderer', async () => {
    const { usedWorker, usedRealRenderer, pdfBytes } = await renderAndObserve({
      NODE_ENV: 'test',
      PDF_TEST_WORKER: '1',
    });
    expect(usedWorker).toBe(true);
    expect(usedRealRenderer).toBe(false);
    expect(pdfBytes.toString()).toBe('%PDF-worker');
  });

  it('B. NODE_ENV=test + PDF_TEST_WORKER unset calls the real renderer, never the worker (E2E shape)', async () => {
    const { usedWorker, usedRealRenderer, pdfBytes } = await renderAndObserve({ NODE_ENV: 'test' });
    expect(usedWorker).toBe(false);
    expect(usedRealRenderer).toBe(true);
    expect(pdfBytes.toString()).toBe('%PDF-real');
  });

  it('C. NODE_ENV=production calls the real renderer, never the worker', async () => {
    const { usedWorker, usedRealRenderer } = await renderAndObserve({ NODE_ENV: 'production' });
    expect(usedWorker).toBe(false);
    expect(usedRealRenderer).toBe(true);
  });

  it('D. PDF_TEST_WORKER=1 in a production-like runtime is ignored — the real renderer is still used', async () => {
    const { usedWorker, usedRealRenderer } = await renderAndObserve({
      NODE_ENV: 'production',
      PDF_TEST_WORKER: '1',
    });
    expect(usedWorker).toBe(false);
    expect(usedRealRenderer).toBe(true);
  });
});
