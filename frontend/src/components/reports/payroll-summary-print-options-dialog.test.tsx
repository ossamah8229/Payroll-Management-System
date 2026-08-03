// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PayrollSummaryPrintOptionsDialog } from './payroll-summary-print-options-dialog';
import { TABLE_COLUMN_FIELDS } from './payroll-summary-print-fields';

// Radix's Dialog primitive probes a few DOM APIs jsdom doesn't implement (print-button.test.tsx's
// own established workaround).
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

function renderDialog(onConfirm = vi.fn()) {
  const onOpenChange = vi.fn();
  render(<PayrollSummaryPrintOptionsDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
  return { onOpenChange, onConfirm };
}

/** Several labels (Employees, Gross Pay, Net Salary, Released Amount, Pending Release Amount,
 * EOBI, Fines) exist in both the Summary cards and Site-table columns sections — every lookup below
 * is scoped to the right `<fieldset>` (implicit ARIA role "group", named by its own `<legend>`) so a
 * bare `getByRole('checkbox', { name })` never throws on an ambiguous match. */
function cardsGroup() {
  return within(screen.getByRole('group', { name: 'Summary cards' }));
}
function columnsGroup() {
  return within(screen.getByRole('group', { name: 'Site-table columns' }));
}
/** Exact-anchored (not a bare prefix) — several labels are themselves prefixes of another label
 * in the same list ("Released" vs "Released Amount", "Pending" vs "Pending Release Amount"), so a
 * loose `^Label` regex ambiguously matches both. The one exception is "Project Site", whose
 * accessible name also picks up its own "(always included)" note text. */
function exactFieldName(label: string): RegExp {
  return new RegExp(`^${label}($| \\()`, 'i');
}
function cardCheckbox(label: string) {
  return cardsGroup().getByRole('checkbox', { name: exactFieldName(label) });
}
function columnCheckbox(label: string) {
  return columnsGroup().getByRole('checkbox', { name: exactFieldName(label) });
}
function isChecked(el: Element) {
  return el.getAttribute('data-state') === 'checked';
}

const TOTAL_COLUMNS = TABLE_COLUMN_FIELDS.length; // 19 — Project Site + 18 figures.
const TOTAL_CARDS = 8;

describe('PayrollSummaryPrintOptionsDialog — default selection (Final Print UX Refinement)', () => {
  it('opens with every summary card and every table column selected (Full Report)', () => {
    renderDialog();

    expect(isChecked(cardCheckbox('Employees'))).toBe(true);
    expect(isChecked(cardCheckbox('Advances including Eid'))).toBe(true);
    expect(isChecked(columnCheckbox('Held'))).toBe(true);
    expect(isChecked(columnCheckbox('Balance Payable Included'))).toBe(true);
    expect(screen.getByText(`${TOTAL_COLUMNS} columns selected`, { exact: false })).toBeTruthy();
    expect(screen.getByText(/Full Report \(all fields\)/)).toBeTruthy();
  });

  it('is never a silent narrowing — the full report is always what a user sees unless they change it', () => {
    renderDialog();
    // No preset is highlighted as active (Full Report isn't one of the three named presets) — the
    // dialog's own "Full Report" label, not a misleading blank state, communicates this clearly.
    for (const name of ['Compact Summary', 'Deductions', 'Release Status']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).not.toContain('bg-accent');
    }
  });
});

describe('PayrollSummaryPrintOptionsDialog — presets', () => {
  it('Compact Summary preset selects exactly the expected fields', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Compact Summary' }));

    expect(isChecked(columnCheckbox('Employees'))).toBe(true);
    expect(isChecked(columnCheckbox('Gross Pay'))).toBe(true);
    expect(isChecked(columnCheckbox('Net Salary'))).toBe(true);
    expect(isChecked(columnCheckbox('Released Amount'))).toBe(true);
    expect(isChecked(columnCheckbox('Pending Release Amount'))).toBe(true);
    // Held is a table-only column with no Compact Summary equivalent — must not be selected.
    expect(isChecked(columnCheckbox('Held'))).toBe(false);
    expect(screen.getByText('6 columns selected', { exact: false })).toBeTruthy();

    expect(isChecked(cardCheckbox('Employees'))).toBe(true);
    expect(isChecked(cardCheckbox('EOBI'))).toBe(false);
    // Selecting a preset immediately updates the readability indicator too.
    expect(screen.getByText('Excellent')).toBeTruthy();
  });

  it('Deductions preset selects exactly the expected fields', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Deductions' }));

    expect(isChecked(columnCheckbox('EOBI'))).toBe(true);
    expect(isChecked(columnCheckbox('Advance Deduction'))).toBe(true);
    expect(isChecked(columnCheckbox('Eid Advance Deduction'))).toBe(true);
    expect(isChecked(columnCheckbox('Fines'))).toBe(true);
    expect(isChecked(columnCheckbox('Recovery Deducted'))).toBe(true);
    expect(isChecked(columnCheckbox('Net Salary'))).toBe(true);
    // Released Amount has no place in a Deductions-focused printout.
    expect(isChecked(columnCheckbox('Released Amount'))).toBe(false);
    expect(screen.getByText('8 columns selected', { exact: false })).toBeTruthy();

    expect(isChecked(cardCheckbox('Advances including Eid'))).toBe(true);
  });

  it('Release Status preset selects exactly the expected fields', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Release Status' }));

    expect(isChecked(columnCheckbox('Held'))).toBe(true);
    expect(isChecked(columnCheckbox('Released'))).toBe(true);
    expect(isChecked(columnCheckbox('Pending'))).toBe(true);
    expect(isChecked(columnCheckbox('No Payout'))).toBe(true);
    expect(isChecked(columnCheckbox('Recovery Due'))).toBe(true);
    expect(isChecked(columnCheckbox('Released Amount'))).toBe(true);
    expect(isChecked(columnCheckbox('Pending Release Amount'))).toBe(true);
    // EOBI has no place in a release-status-focused printout.
    expect(isChecked(columnCheckbox('EOBI'))).toBe(false);
    expect(screen.getByText('9 columns selected', { exact: false })).toBeTruthy();
  });

  it('a hand-picked (Custom) selection is labeled distinctly from Full Report, and confirms unmodified', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Compact Summary' }));
    // Diverge from the preset by one field.
    fireEvent.click(columnCheckbox('EOBI'));

    expect(screen.getByText(/Custom \(current selection\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const selection = onConfirm.mock.calls[0]![0];
    expect(selection.columns).toContain('eobi');
  });
});

describe('PayrollSummaryPrintOptionsDialog — Project Site column', () => {
  it('is selected and disabled, and cannot be toggled off', () => {
    renderDialog();
    const siteCheckbox = columnCheckbox('Project Site') as HTMLButtonElement;
    expect(isChecked(siteCheckbox)).toBe(true);
    expect(siteCheckbox.disabled).toBe(true);

    fireEvent.click(siteCheckbox);
    expect(isChecked(siteCheckbox)).toBe(true);
  });

  it('Clear Optional Fields leaves Project Site selected and clears every other field', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Optional Fields' }));

    expect(isChecked(columnCheckbox('Project Site'))).toBe(true);
    expect(isChecked(columnCheckbox('Employees'))).toBe(false);
    expect(screen.getByText('1 column selected', { exact: false })).toBeTruthy();
    // Only Project Site remains — the "no meaningful figures" guard must now block printing.
    expect(screen.getByText(/select at least one column besides project site/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PayrollSummaryPrintOptionsDialog — Select All / Reset to Default', () => {
  it('Select All selects every card and every column (same as the default, but reachable after a narrower selection)', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Optional Fields' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));

    expect(isChecked(cardCheckbox('Advances including Eid'))).toBe(true);
    expect(screen.getByText(`${TOTAL_COLUMNS} columns selected`, { exact: false })).toBeTruthy();
  });

  it('Reset to Default restores the Full Report selection (every card, every column) after a narrower change', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Compact Summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));

    expect(screen.getByText(`${TOTAL_COLUMNS} columns selected`, { exact: false })).toBeTruthy();
    expect(screen.getByText(/Full Report \(all fields\)/)).toBeTruthy();
    expect(isChecked(cardCheckbox('EOBI'))).toBe(true);
  });
});

describe('PayrollSummaryPrintOptionsDialog — Print Readability indicator', () => {
  it('Excellent for 8 or fewer columns', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Compact Summary' })); // 6 columns
    expect(screen.getByText('Excellent')).toBeTruthy();
    expect(screen.getByText(/should print clearly/)).toBeTruthy();
  });

  it('Good for 9-11 columns', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Release Status' })); // 9 columns
    expect(screen.getByText('Good')).toBeTruthy();
    expect(screen.getByText(/suitable for most a4 landscape prints/i)).toBeTruthy();
  });

  it('Wide for 12-15 columns', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Optional Fields' }));
    // Pick 12 real columns: Project Site (locked) + 11 more.
    const labels = ['Employees', 'Held', 'Released', 'Pending', 'No Payout', 'Recovery Due', 'Gross Pay', 'Overtime', 'Allowances', 'EOBI', 'Advance Deduction'];
    for (const label of labels) fireEvent.click(columnCheckbox(label));

    expect(screen.getByText('12 columns selected', { exact: false })).toBeTruthy();
    expect(screen.getByText('Wide')).toBeTruthy();
    expect(screen.getByText(/some columns may become compressed/i)).toBeTruthy();
    // Not yet the prominent Very Wide warning banner.
    expect(screen.queryByText(/difficult to read when printed on a4 paper/i)).toBeNull();
  });

  it('Very Wide for 16 or more columns, and the full report (19) is Very Wide', () => {
    renderDialog();
    expect(screen.getByText(`${TOTAL_COLUMNS} columns selected`, { exact: false })).toBeTruthy();
    expect(screen.getByText('Very Wide')).toBeTruthy();
    expect(screen.getByText(/likely to reduce readability/i)).toBeTruthy();
  });
});

describe('PayrollSummaryPrintOptionsDialog — Very Wide warning', () => {
  it('shows no warning banner for Compact Summary (Excellent)', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Compact Summary' }));
    expect(screen.queryByText(/difficult to read when printed on a4 paper/i)).toBeNull();
  });

  it('shows no warning banner for Release Status (Good)', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Release Status' }));
    expect(screen.queryByText(/difficult to read when printed on a4 paper/i)).toBeNull();
  });

  it('shows the prominent warning once the selection is Very Wide (16+ columns), without changing the selection, and still allows printing', () => {
    renderDialog();
    // Default state is already the full 19-column report — Very Wide.
    expect(screen.getByText(/you have selected many columns.*difficult to read when printed on a4 paper.*built-in presets/is)).toBeTruthy();
    expect(screen.getByText(`${TOTAL_COLUMNS} columns selected`, { exact: false })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('PayrollSummaryPrintOptionsDialog — local preference restoration', () => {
  it('opens pre-populated from a previously saved selection, not the Full Report default', () => {
    window.localStorage.setItem(
      'payroll-summary-print-fields:v1',
      JSON.stringify({
        cards: ['eobi'],
        columns: ['siteName', 'eobi', 'advanceDeductions'],
      }),
    );

    renderDialog();

    expect(isChecked(columnCheckbox('EOBI'))).toBe(true);
    expect(isChecked(columnCheckbox('Advance Deduction'))).toBe(true);
    expect(isChecked(columnCheckbox('Gross Pay'))).toBe(false);
    expect(screen.getByText('3 columns selected', { exact: false })).toBeTruthy();
  });

  it('falls back to the Full Report default when nothing is stored', () => {
    renderDialog();
    expect(screen.getByText(`${TOTAL_COLUMNS} columns selected`, { exact: false })).toBeTruthy();
    expect(screen.getByText(/Full Report \(all fields\)/)).toBeTruthy();
  });

  it('confirming Print saves the current selection for next time', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Release Status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(window.localStorage.getItem('payroll-summary-print-fields:v1')!);
    expect(stored.columns).toContain('heldCount');
  });

  it('Reset to Default overwrites a saved narrower preference with the Full Report selection on confirm', () => {
    window.localStorage.setItem(
      'payroll-summary-print-fields:v1',
      JSON.stringify({ cards: ['eobi'], columns: ['siteName', 'eobi'] }),
    );
    renderDialog();
    // Opens pre-populated from the saved narrower preference first.
    expect(screen.getByText('2 columns selected', { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Default' }));
    expect(screen.getByText(`${TOTAL_COLUMNS} columns selected`, { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    const stored = JSON.parse(window.localStorage.getItem('payroll-summary-print-fields:v1')!);
    expect(stored.columns).toHaveLength(TOTAL_COLUMNS);
    expect(stored.cards).toHaveLength(TOTAL_CARDS);
  });
});

describe('PayrollSummaryPrintOptionsDialog — accessibility', () => {
  it('exposes every action the checkpoint requires', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Select All' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Clear Optional Fields' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Reset to Default' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Print' })).toBeTruthy();
  });

  it('Cancel closes the dialog without confirming a selection', () => {
    const { onOpenChange, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
