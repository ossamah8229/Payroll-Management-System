// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrintButton } from './print-button';

// Radix's Dialog primitive probes a few DOM APIs jsdom doesn't implement — the standard,
// project-external workaround (jsdom itself has never implemented pointer capture or
// scrollIntoView) so the dialog can actually open in these tests.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.getElementById('app-dynamic-print-page-style')?.remove();
  document.documentElement.classList.remove('print-fit', 'print-active');
});

describe('PrintButton', () => {
  it('opens the print settings dialog instead of calling window.print() immediately', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<PrintButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    expect(printSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Print settings')).toBeTruthy();
    expect(screen.getByText('Portrait')).toBeTruthy();
    expect(screen.getByText('Landscape')).toBeTruthy();
    expect(screen.getByText('Fit to page')).toBeTruthy();
    expect(screen.getByText('Normal size')).toBeTruthy();
  });

  it('confirming Landscape + Fit to page applies a landscape @page rule and the fit-to-page class, then calls window.print()', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<PrintButton recommendedOrientation="portrait" />);

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByLabelText('Landscape'));
    // "Fit to page" is already the dialog's own default selection — confirm directly. Two buttons
    // now share the name "Print" (the page's own trigger, still in the DOM behind the dialog, and
    // the dialog's own confirm action) — the confirm action is the one rendered last.
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('print-fit')).toBe(true);
    const styleEl = document.getElementById('app-dynamic-print-page-style');
    expect(styleEl?.textContent).toContain('A4 landscape');
  });

  it('Auto orientation resolves to the page-supplied recommendation at print time', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<PrintButton recommendedOrientation="landscape" />);

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    // "Auto" is the dialog's default selection — confirm without changing it.
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(printSpy).toHaveBeenCalledTimes(1);
    const styleEl = document.getElementById('app-dynamic-print-page-style');
    expect(styleEl?.textContent).toContain('A4 landscape');
  });

  it('choosing Normal size does not apply the fit-to-page class', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<PrintButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByLabelText(/Normal size/));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('print-fit')).toBe(false);
  });

  // --- Production Print Defect regression (2026-07-25) ---------------------------------------
  //
  // The defect: window.print() ran while the settings dialog was still fully mounted, so the
  // printed document was the dialog itself, not the report underneath — production evidence,
  // ALL 8 PrintButton pages. Root cause: the dialog's old confirm handler called `onConfirm`
  // (which synchronously invokes `window.print()`) *before* `onOpenChange(false)`, so the browser
  // captured the DOM before the close was even requested, let alone committed. Every existing
  // test above only ever inspected the DOM *after* the confirm click's fireEvent call had fully
  // returned — by which point React had already flushed the close, even under the buggy
  // implementation, so those assertions could never have caught this. This test instead captures
  // DOM state *synchronously, inside the window.print() stub itself* — the same moment a real
  // browser's print engine actually captures, with no grace period for a later render to fix it up.
  it('REGRESSION: the settings dialog is fully unmounted from the DOM before window.print() is invoked, and the report underneath remains present', () => {
    let dialogPresentAtPrintTime: boolean | undefined;
    let reportPresentAtPrintTime: boolean | undefined;

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      dialogPresentAtPrintTime = screen.queryByText('Print settings') !== null;
      reportPresentAtPrintTime = screen.queryByTestId('fake-report') !== null;
    });

    render(
      <div>
        <div data-testid="fake-report">Report content</div>
        <PrintButton />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(dialogPresentAtPrintTime).toBe(false);
    expect(reportPresentAtPrintTime).toBe(true);
  });
});
