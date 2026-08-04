import type { Browser, Page } from 'puppeteer';

/**
 * Phase 7G — unit coverage for `renderHtmlToPdf()`'s retry-exhausted diagnostic (`render-pdf.ts`).
 *
 * Mocks `./browser` rather than exercising a real Puppeteer instance — deliberately, and unlike
 * every other PDF suite in this codebase (`payslips.test.ts`, `statements.test.ts`). This test
 * needs *both* the initial attempt and the one retry to fail deterministically; forcing that
 * against a real browser would be exactly the kind of flaky, timing-dependent setup
 * `pdf-template.test.ts`'s own comment already documents as a bad idea (a version of that file
 * that called `renderHtmlToPdf()` directly was tried and removed for that reason). This is the one
 * place in the suite that mocks Puppeteer; it proves only the diagnostic/retry bookkeeping added
 * in this checkpoint, not rendering correctness itself — already covered elsewhere against a real
 * browser.
 */
jest.mock('../src/lib/pdf/browser', () => ({
  getBrowser: jest.fn(),
  discardBrowser: jest.fn(),
}));

import { getBrowser, discardBrowser } from '../src/lib/pdf/browser';
import { renderHtmlToPdf } from '../src/lib/pdf/render-pdf';

const mockGetBrowser = getBrowser as jest.MockedFunction<typeof getBrowser>;
const mockDiscardBrowser = discardBrowser as jest.MockedFunction<typeof discardBrowser>;

function fakePage(pdfBytes: Uint8Array): Page {
  return {
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(pdfBytes),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Page;
}

function fakeBrowser(page: Page): Browser {
  return { newPage: jest.fn().mockResolvedValue(page) } as unknown as Browser;
}

describe('renderHtmlToPdf — retry-exhausted diagnostic (Phase 7G)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rethrows the original error after exactly one retry, and emits a sanitized diagnostic', async () => {
    const failure = new Error('Puppeteer launch failed: spawn ENOMEM');
    mockGetBrowser.mockRejectedValue(failure);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      renderHtmlToPdf('<html><body>CONFIDENTIAL Net Salary: 999999</body></html>'),
    ).rejects.toBe(failure);

    // Exactly one retry — never more, never silently swallowed.
    expect(mockGetBrowser).toHaveBeenCalledTimes(2);
    expect(mockDiscardBrowser).toHaveBeenCalledTimes(1);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const diagnostic = JSON.parse(consoleErrorSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(diagnostic.errorName).toBe('Error');
    expect(diagnostic.errorMessage).toBe('Puppeteer launch failed: spawn ENOMEM');
    expect(typeof diagnostic.stack).toBe('string');
    expect(diagnostic.attempt).toBe(2);
    expect(diagnostic.totalAttempts).toBe(2);
    expect(diagnostic.browserDiscardedAndRelaunched).toBe(true);

    // Never the rendered document content or any payroll figure — only the error's own identity.
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain('CONFIDENTIAL');
    expect(serialized).not.toContain('999999');

    consoleErrorSpy.mockRestore();
  });

  it('does not emit a diagnostic when the first attempt fails but the retry succeeds', async () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    mockGetBrowser
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(fakeBrowser(fakePage(pdfBytes)));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await renderHtmlToPdf('<html><body>ok</body></html>');

    expect(Buffer.compare(result, Buffer.from(pdfBytes))).toBe(0);
    expect(mockGetBrowser).toHaveBeenCalledTimes(2);
    expect(mockDiscardBrowser).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
