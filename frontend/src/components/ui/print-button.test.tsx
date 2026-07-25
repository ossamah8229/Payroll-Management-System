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
});
