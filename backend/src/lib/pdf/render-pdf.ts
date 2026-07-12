import type { PDFOptions } from 'puppeteer';
import { getBrowser } from './browser';

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
 */
export async function renderHtmlToPdf(html: string, options: RenderPdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'load' });
    const uint8 = await page.pdf({
      format: options.format ?? 'A4',
      // Print backgrounds must render — the "paper" card border and any tinted rows in the
      // shared print stylesheet are backgrounds, and would silently vanish without this.
      printBackground: true,
      margin: options.margin ?? { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: options.displayHeaderFooter ?? false,
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
    });
    return Buffer.from(uint8);
  } finally {
    // The page, not the browser, is closed after every render — the browser instance itself is
    // the reusable singleton (`browser.ts`); a leaked page would otherwise accumulate memory
    // across requests for the life of the process.
    await page.close();
  }
}
