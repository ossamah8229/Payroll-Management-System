import type { NormalizedError } from '../normalize-error';
import type { RenderPdfOptions } from '../render-pdf';

/** Phase 7H — the newline-delimited JSON protocol between a Jest test process and the persistent
 * PDF test worker (`pdf-worker.entry.ts`). One request per socket connection — this codebase's
 * Jest suites run `--runInBand` (test *files* never run concurrently with each other), and the one
 * place multiple renders run concurrently within a single file (`payslips.routes.ts`'s
 * `BATCH_RENDER_CONCURRENCY`) already does so as independent `Promise`s, each naturally getting its
 * own connection — so there is no need for a persistent multiplexed connection or request ids. */
export type WorkerRequest =
  | { type: 'render'; html: string; options: RenderPdfOptions }
  /** Maps to the worker's own `discardBrowser()` — fire-and-forget, for recovery after a failed
   * render (mirrors `render-pdf.ts`'s existing one-retry behavior). */
  | { type: 'discard' }
  /** Maps to the worker's own `closeBrowser()` — a clean, awaited close of a healthy browser, for
   * test suites that proactively recycle it (e.g. after a memory-heavy batch render). */
  | { type: 'close' }
  | { type: 'shutdown' };

export type WorkerResponse =
  | { type: 'result'; ok: true; buffer: string }
  | { type: 'result'; ok: false; error: NormalizedError }
  | { type: 'ack' };
