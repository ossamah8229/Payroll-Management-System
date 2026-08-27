// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { computeColumnWidths, gridTemplateColumns, stickyLeftOffsets } from './columns';
import { PayrollEntryRow, ROW_HEIGHT } from './payroll-entry-row';
import { measureColumnWidth } from './measure-column-width';
import { LiveTotalsStore } from './live-totals-store';

/**
 * Master Data Boundary (Phase 7D, 2026-07-30) — frontend coverage.
 *
 * Employee identity/banking fields (designation, bank, branch code, account number, IBAN) are now
 * display-only in the Payroll Entry grid — Employee Registry is the sole editable source. This
 * file proves that structurally (no `<input>`/`<select>` in those cells), confirms every
 * legitimate payroll-cycle financial field and the EOBI toggle remain exactly as editable as
 * before, and covers the totals-row overlap fix and the Advance Balance presentation fix.
 */

function makeEntry(overrides: Partial<PayrollEntry> = {}): PayrollEntry {
  return {
    id: 'entry-1',
    cycleId: 'cycle-1',
    employeeId: 'employee-1',
    employee: {
      id: 'employee-1',
      employeeCode: 'V001',
      cnic: null,
      name: 'Test Employee',
      fatherName: null,
      religion: null,
      dateOfBirth: null,
      mobileNumber: null,
      designation: 'Guard',
      siteId: 'site-1',
      site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
      unitId: 'unit-1',
      unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: null, isActive: true, createdAt: '', updatedAt: '' },
      dateOfJoining: null,
      dateOfLeaving: null,
      payType: 'DAILY_WAGE',
      grossPay: '30000',
      bankId: null,
      bank: null,
      branchCode: null,
      accountNumber: null,
      iban: null,
      defaultEobiAmount: '400',
      defaultEobiApplicable: true,
      createdAt: '',
      updatedAt: '',
    },
    siteId: 'site-1',
    site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
    designation: 'Guard',
    bankId: null,
    branchCode: null,
    accountNumber: null,
    iban: null,
    grossPay: '30000',
    allowance: '0',
    leaveDays: '0',
    leaveRate: null,
    eobiAmount: '400',
    eobiApplicable: true,
    advanceDeduction: '0',
    advanceId: null,
    advance: null,
    eidAdvanceDeduction: '0',
    eidAdvanceId: null,
    eidAdvance: null,
    fine: '0',
    hold: false,
    released: false,
    payoutOutcome: null,
    releaseBlockReasons: [],
    releasedAt: null,
    releasedBy: null,
    lateReason: null,
    remarks: null,
    sortOrder: 0,
    version: 1,
    createdAt: '',
    updatedAt: '',
    workLines: [
      {
        id: 'line-1',
        payrollEntryId: 'entry-1',
        siteId: 'site-1',
        unitId: 'unit-1',
        unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: 'BR-01', isActive: true, createdAt: '', updatedAt: '' },
        days: '30',
        otHours: '0',
        otRate: null,
        cycleDays: 30,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      },
    ],
    calc: {
      workLines: [{ sortOrder: 0, dailyRate: '1000', effectiveOtRate: '0', earnedAmount: '30000', otEarned: '0' }],
      totalWorkingDays: '30',
      effectiveLeaveRate: '0',
      earnedAmount: '30000',
      otEarned: '0',
      leaveEarned: '0',
      correctionBalancePayable: '0',
      totalEarning: '30000',
      eobiDeduction: '400',
      correctionBalanceRecovery: '0',
      totalDeduction: '400',
      netSalary: '29600',
    },
    ...overrides,
  };
}

const testBank: Bank = { id: 'bank-1', code: 'HABIBMETRO', name: 'Habib Metropolitan Bank', isActive: true, isReferenced: true };

function renderRow(entry: PayrollEntry, banks: Bank[] = [testBank]) {
  const resolved = computeColumnWidths([entry], banks);
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollEntryRow
        entry={entry}
        rowIndex={0}
        cycleId="cycle-1"
        cycleStatus="DRAFT"
        banks={banks}
        liveTotalsStore={new LiveTotalsStore()}
        gridTemplateColumns={gridTemplateColumns(resolved)}
        identityOffsets={stickyLeftOffsets(resolved)}
        canEditEmployee={false}
        canMarkEmployeeLeft={false}
        onEditEmployee={() => {}}
        onMarkLeftEmployee={() => {}}
        style={{}}
      />
    </QueryClientProvider>,
  );
}

describe('Employee identity/banking cells are display-only', () => {
  it('designation renders as plain text — no <input> in that cell', () => {
    const entry = makeEntry({ designation: 'Shift Supervisor' });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="designation"]') as HTMLElement;
    expect(cell.textContent).toBe('Shift Supervisor');
    expect(cell.querySelector('input')).toBeNull();
    expect(cell.querySelector('select')).toBeNull();
  });

  it('bank renders the bank code as plain text — no <select> in that cell', () => {
    const entry = makeEntry({ bankId: testBank.id });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="bankId"]') as HTMLElement;
    expect(cell.textContent).toBe('HABIBMETRO');
    expect(cell.querySelector('select')).toBeNull();
    expect(cell.querySelector('input')).toBeNull();
  });

  it('a cash entry (no bankId) displays "Cash" as plain text', () => {
    const entry = makeEntry({ bankId: null });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="bankId"]') as HTMLElement;
    expect(cell.textContent).toBe('Cash');
    expect(cell.querySelector('select')).toBeNull();
  });

  it('branch code, account number, and IBAN all render as plain text — no <input> in any of those cells', () => {
    const entry = makeEntry({ branchCode: '0123', accountNumber: '5551234567', iban: 'PK36SCBL0000001123456702' });
    const { container } = renderRow(entry);
    for (const colId of ['branchCode', 'accountNumber', 'iban']) {
      const cell = container.querySelector(`[data-col-id="${colId}"]`) as HTMLElement;
      expect(cell.querySelector('input')).toBeNull();
    }
    expect(container.querySelector('[data-col-id="branchCode"]')?.textContent).toBe('0123');
    expect(container.querySelector('[data-col-id="accountNumber"]')?.textContent).toBe('5551234567');
    expect(container.querySelector('[data-col-id="iban"]')?.textContent).toBe('PK36SCBL0000001123456702');
  });

  it('an unset branch code/account number/IBAN renders an em dash, never a blank input', () => {
    const entry = makeEntry({ branchCode: null, accountNumber: null, iban: null });
    const { container } = renderRow(entry);
    for (const colId of ['branchCode', 'accountNumber', 'iban']) {
      const cell = container.querySelector(`[data-col-id="${colId}"]`) as HTMLElement;
      expect(cell.textContent).toBe('—');
      expect(cell.querySelector('input')).toBeNull();
    }
  });

  // Phase 7F (2026-08-04) — Gross Salary joins this same display-only tier; production UAT found
  // it was the one master-data field Phase 7D's own pass missed.
  it('grossPay renders as plain formatted text — no <input> in that cell', () => {
    const entry = makeEntry({ grossPay: '45000' });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="grossPay"]') as HTMLElement;
    expect(cell.querySelector('input')).toBeNull();
    expect(cell.textContent).toContain('45,000');
  });
});

describe('Payroll-cycle financial fields and the EOBI toggle remain fully editable', () => {
  it('every legitimate payroll-entry financial field still renders an editable input', () => {
    const entry = makeEntry();
    const { container } = renderRow(entry);
    for (const colId of ['days', 'otHours', 'otRate', 'cycleDays', 'leaveDays', 'leaveRate', 'allowance', 'eobiAmount', 'advanceDeduction', 'eidAdvanceDeduction', 'fine', 'remarks']) {
      const cell = container.querySelector(`[data-col-id="${colId}"]`) as HTMLElement;
      expect(cell.querySelector('input')).not.toBeNull();
    }
  });

  it('the EOBI applicability toggle is present and enabled for a Draft, unreleased entry', () => {
    const entry = makeEntry({ eobiApplicable: true });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="eobiApplicable"]') as HTMLElement;
    const toggle = cell.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.disabled).toBe(false);
  });

  it('the Hold toggle is likewise present and editable — this checkpoint only removes identity/banking fields, nothing else', () => {
    const entry = makeEntry({ hold: false });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="hold"]') as HTMLElement;
    const toggle = cell.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(false);
  });
});

describe('Totals-row overlap fix — column width accounts for the footer total, not just body values', () => {
  it('a Gross Pay column sized only from individual rows would be too narrow for the summed total, but computeColumnWidths widens it', () => {
    // 20 rows of 99999.99 each — no single row's own text is wide, but the *summed* total
    // ("PKR 1,999,999.80") is far wider than any individual formatted value.
    const entries = Array.from({ length: 20 }, (_, i) => makeEntry({ id: `entry-${i}`, grossPay: '99999.99' }));
    const resolved = computeColumnWidths(entries, [testBank]);
    const grossPayColumn = resolved.find((c) => c.id === 'grossPay')!;

    // What the column width *would* have been if only body-row values were measured (the pre-fix
    // behavior) — computed independently here via the same measurement primitive, to prove the
    // fix actually changes the outcome rather than merely asserting an arbitrary number.
    const bodyOnlyValues = entries.map((e) => e.grossPay);
    const bodyOnlyWidth = measureColumnWidth({ header: 'Gross Pay', values: bodyOnlyValues, minimumPx: 80 });

    expect(grossPayColumn.width).toBeGreaterThan(bodyOnlyWidth);
  });

  it('the Employee column widens to fit a large "N employees" footer count', () => {
    const entries = Array.from({ length: 1502 }, (_, i) => makeEntry({ id: `entry-${i}` }));
    const resolved = computeColumnWidths(entries, [testBank]);
    const employeeColumn = resolved.find((c) => c.id === 'employeeName')!;
    const bodyOnlyWidth = measureColumnWidth({
      header: 'Employee',
      values: entries.map((e) => e.employee.name),
      minimumPx: 110,
    });
    expect(employeeColumn.width).toBeGreaterThanOrEqual(
      measureColumnWidth({ header: 'Employee', values: ['1502 employees'], minimumPx: 110 }),
    );
    expect(employeeColumn.width).toBeGreaterThanOrEqual(bodyOnlyWidth);
  });

  it('a zero-value dataset still produces a sane, non-overlapping column width (zero-total edge case)', () => {
    const entries = [makeEntry({ grossPay: '0', advanceDeduction: '0', eidAdvanceDeduction: '0', fine: '0' })];
    const resolved = computeColumnWidths(entries, [testBank]);
    for (const id of ['grossPay', 'advanceDeduction', 'eidAdvanceDeduction', 'fine']) {
      const column = resolved.find((c) => c.id === id)!;
      expect(column.width).toBeGreaterThan(0);
    }
  });
});

describe('Advance Balance presentation — compact, vertically centered, without changing row height', () => {
  it('ROW_HEIGHT is unchanged at 40px', () => {
    expect(ROW_HEIGHT).toBe(40);
  });

  it('the advance deduction input uses the compact vertical padding when a balance label is present', () => {
    const entry = makeEntry({
      advanceDeduction: '500',
      advance: { id: 'adv-1', outstandingBalance: '4500', status: 'ACTIVE' },
    });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="advanceDeduction"]') as HTMLElement;
    const input = cell.querySelector('input') as HTMLInputElement;
    expect(input.className).toMatch(/\bpy-0\.5\b/);
    expect(input.className).not.toMatch(/\bpy-1\b/);
  });

  it('the balance label sits directly under the amount with no extra top margin, and never touches the row via truncation', () => {
    const entry = makeEntry({
      advanceDeduction: '500',
      advance: { id: 'adv-1', outstandingBalance: '4500', status: 'ACTIVE' },
    });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="advanceDeduction"]') as HTMLElement;
    const balanceLabel = cell.querySelector('p') as HTMLElement;
    expect(balanceLabel).not.toBeNull();
    expect(balanceLabel.textContent).toContain('Bal:');
    expect(balanceLabel.className).toMatch(/\bmt-0\b/);
    expect(balanceLabel.className).not.toMatch(/\bmt-0\.5\b/);
    expect(balanceLabel.className).toMatch(/\bleading-none\b/);
    expect(balanceLabel.className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('an advance cell with no linked Advance renders the ordinary (non-compact) input, unaffected', () => {
    const entry = makeEntry({ advanceDeduction: '0', advance: null });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="advanceDeduction"]') as HTMLElement;
    const input = cell.querySelector('input') as HTMLInputElement;
    expect(input.className).not.toMatch(/\bpy-0\.5\b/);
    expect(cell.querySelector('p')).toBeNull();
  });

  it('v1.0.4: a since-Cancelled linked Advance shows Bal: PKR 0.00, never the raw stored (waived) remainder — reachable when viewing a historical released cycle whose link cancelAdvance never clears', () => {
    const entry = makeEntry({
      advanceDeduction: '500',
      advance: { id: 'adv-1', outstandingBalance: '4500', status: 'CANCELLED' },
    });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="advanceDeduction"]') as HTMLElement;
    const balanceLabel = cell.querySelector('p') as HTMLElement;
    expect(balanceLabel.textContent).toContain('Bal:');
    expect(balanceLabel.textContent).toContain('0.00');
    expect(balanceLabel.textContent).not.toContain('4,500');
  });

  it('the eid advance cell follows the identical compact/centered pattern', () => {
    const entry = makeEntry({
      eidAdvanceDeduction: '200',
      eidAdvance: { id: 'eid-1', outstandingBalance: '800', status: 'ACTIVE' },
    });
    const { container } = renderRow(entry);
    const cell = container.querySelector('[data-col-id="eidAdvanceDeduction"]') as HTMLElement;
    const input = cell.querySelector('input') as HTMLInputElement;
    expect(input.className).toMatch(/\bpy-0\.5\b/);
    const balanceLabel = cell.querySelector('p') as HTMLElement;
    expect(balanceLabel.className).toMatch(/\bmt-0\b/);
    expect(balanceLabel.className).not.toMatch(/\bmt-0\.5\b/);
  });
});
