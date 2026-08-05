/**
 * Phase 7G/7H — unit coverage for the retry-exhausted diagnostic (`render-pdf.ts`).
 *
 * Exercises `renderWithOneRetry` directly, with fake `attempt`/`discard` functions injected —
 * rather than mocking `browser.ts` and calling `renderHtmlToPdf()` itself. Two reasons: (1) as of
 * Phase 7H, `renderHtmlToPdf()` delegates to the shared PDF test worker whenever `NODE_ENV=test`
 * (every Jest run), so mocking `browser.ts` would no longer even be on the code path this test
 * needs to exercise; (2) this needs *both* the initial attempt and the one retry to fail
 * deterministically, which forcing against a real browser would be exactly the kind of flaky,
 * timing-dependent setup `pdf-template.test.ts`'s own comment already documents as a bad idea.
 * Real end-to-end Puppeteer rendering (via the worker) is covered elsewhere — `payslips.test.ts`,
 * `statements.test.ts`, `payroll-hold-workflow.test.ts` — this file proves only the
 * diagnostic/retry bookkeeping itself, with no Puppeteer involved at all.
 */
import { renderWithOneRetry } from '../src/lib/pdf/render-pdf';

describe('renderWithOneRetry — retry-exhausted diagnostic', () => {
  it('rethrows the original error after exactly one retry, and emits a sanitized diagnostic', async () => {
    const failure = new Error('Puppeteer launch failed: spawn ENOMEM');
    (failure as unknown as Record<string, unknown>).stage = 'browser-launch';
    const attempt = jest.fn().mockRejectedValue(failure);
    const discard = jest.fn().mockResolvedValue(undefined);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      renderWithOneRetry('<html><body>CONFIDENTIAL Net Salary: 999999</body></html>', {}, attempt, discard),
    ).rejects.toBe(failure);

    // Exactly one retry — never more, never silently swallowed.
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledTimes(1);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const diagnostic = JSON.parse(consoleErrorSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(diagnostic.errorName).toBe('Error');
    expect(diagnostic.errorMessage).toBe('Puppeteer launch failed: spawn ENOMEM');
    expect(typeof diagnostic.stack).toBe('string');
    expect(diagnostic.stage).toBe('browser-launch');
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
    const pdfBytes = Buffer.from('%PDF-fake');
    const attempt = jest.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(pdfBytes);
    const discard = jest.fn().mockResolvedValue(undefined);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await renderWithOneRetry('<html><body>ok</body></html>', {}, attempt, discard);

    expect(result).toBe(pdfBytes);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('normalizes a cross-realm, non-Error-instance failure without fabricating fields', async () => {
    // Mirrors the real "Test environment has been torn down" shape this diagnostic was built to
    // catch: Error-shaped (has name/message/stack) but fails `instanceof Error` across a realm
    // boundary — built here with `vm` so it's a genuine cross-realm object, not a hand-rolled fake.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node built-in, test-only
    const vm = require('node:vm') as typeof import('node:vm');
    const crossRealmError = vm.runInNewContext('new Error("cross-realm failure")');
    expect(crossRealmError instanceof Error).toBe(false); // proves this really is cross-realm

    const attempt = jest.fn().mockRejectedValue(crossRealmError);
    const discard = jest.fn().mockResolvedValue(undefined);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(renderWithOneRetry('<html></html>', {}, attempt, discard)).rejects.toBe(crossRealmError);

    const diagnostic = JSON.parse(consoleErrorSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(diagnostic.errorName).toBe('Error');
    expect(diagnostic.errorMessage).toBe('cross-realm failure');
    expect(typeof diagnostic.stack).toBe('string');

    consoleErrorSpy.mockRestore();
  });
});
