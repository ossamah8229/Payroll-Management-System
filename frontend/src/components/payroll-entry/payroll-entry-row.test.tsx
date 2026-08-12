// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { LiveTotalsStore } from './live-totals-store';
import { gridTemplateColumns, computeColumnWidths, stickyLeftOffsets } from './columns';

/**
 * Independent-review remediation (M4, Post-Checkpoint-1A UAT Stabilization) — root cause: `cn()`
 * (built on `tailwind-merge`) resolves a `bg-*` class conflict by keeping only the *last* class in
 * the list, so the row's own base `bg-surface-2` (the opaque-row fix, M1's own row-transparency
 * finding) was silently dropped whenever `status === 'conflict'` also contributed
 * `bg-danger-light/40` — a 40%-opacity class, reintroducing exactly the translucent-background gap
 * the base fix exists to close, for this one specific, reachable row state (a concurrent-edit
 * version conflict). Fixed by dropping the `/40` opacity suffix (`bg-danger-light`, the same
 * already-vetted, fully-opaque semantic color `badge.tsx`'s own `hold`/`red` variants use) —
 * verified here by directly checking `tailwind-merge`'s own resolved output on the row's real,
 * rendered `className`, not merely asserted in prose.
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
      name: 'Conflict Test Employee',
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

describe('PayrollEntryRow — conflict-status background stays fully opaque (Post-Checkpoint-1A UAT Stabilization, M4)', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock('@/hooks/use-payroll-entry-editor');
  });

  async function renderRowWithStatus(status: 'idle' | 'saving' | 'saved' | 'dirty' | 'error' | 'conflict') {
    const entry = makeEntry();
    vi.doMock('@/hooks/use-payroll-entry-editor', () => ({
      usePayrollEntryEditor: () => ({
        editable: true,
        effectiveEntry: entry,
        effectiveLine: entry.workLines[0],
        effectiveLines: entry.workLines,
        cycleDaysInputValue: String(entry.workLines[0]!.cycleDays),
        calc: entry.calc,
        status,
        errorMessage: status === 'error' ? 'Simulated error' : undefined,
        hasUnsavedChanges: false,
        setEntryField: vi.fn(),
        setWorkLineField: vi.fn(),
        setLineField: vi.fn(),
        addLine: vi.fn(),
        deleteLine: vi.fn(),
        retryNow: vi.fn(),
        reload: vi.fn(),
      }),
    }));

    const { PayrollEntryRow } = await import('./payroll-entry-row');
    const resolved = computeColumnWidths([entry], [testBank]);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={entry}
          rowIndex={0}
          cycleId="cycle-1"
          cycleStatus="DRAFT"
          banks={[testBank]}
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

  it('a conflict-status row resolves (after tailwind-merge) to a fully opaque background class — never a translucent/opacity-suffixed one', async () => {
    await renderRowWithStatus('conflict');

    const row = screen.getByRole('row', { name: /Conflict Test Employee/ });
    // The real, rendered, tailwind-merge-resolved class list — not a hypothetical.
    expect(row.className).toMatch(/\bbg-danger-light\b/);
    // The specific regression this test guards: a `bg-*` class with a `/NN` opacity suffix must
    // never be the row's own background — that is exactly how the previous `bg-danger-light/40`
    // silently reintroduced a translucent row after `tailwind-merge` dropped `bg-surface-2`.
    expect(row.className).not.toMatch(/\bbg-[a-z-]+\/\d+\b/);
  });

  it('an idle (non-conflict) row keeps the ordinary opaque bg-surface-2 background', async () => {
    await renderRowWithStatus('idle');

    const row = screen.getByRole('row', { name: /Conflict Test Employee/ });
    expect(row.className).toMatch(/\bbg-surface-2\b/);
    expect(row.className).not.toMatch(/\bbg-danger-light\b/);
  });

  /**
   * Frozen Employee Identity Pane (UAT 2026-08-12) — extends the M4 fix above to the sticky-left
   * `employeeCode`/`employeeName` cells: they carry `stickyIdentityCellClassName(colId,
   * rowBackgroundClassName)`, the same "own real background, never inherited" discipline the
   * sticky-right `actions` cell already follows. Without it, a conflict row's frozen identity cells
   * would fall back to `bg-surface-2` (or transparent) while the rest of the row shows
   * `bg-danger-light`, letting non-sticky content scrolled underneath bleed through the one cell the
   * data-entry-safety fix exists to keep trustworthy.
   */
  it('a conflict-status row carries its own opaque bg-danger-light background onto its sticky-left identity cells too, not the ordinary bg-surface-2', async () => {
    await renderRowWithStatus('conflict');

    const codeCell = document.querySelector('[data-col-id="employeeCode"]') as HTMLElement;
    const nameCell = document.querySelector('[data-col-id="employeeName"]') as HTMLElement;
    for (const cell of [codeCell, nameCell]) {
      expect(cell.className).toMatch(/\bsticky\b/);
      expect(cell.className).toMatch(/\bbg-danger-light\b/);
      expect(cell.className).not.toMatch(/\bbg-surface-2\b/);
      expect(cell.className).not.toMatch(/\bbg-[a-z-]+\/\d+\b/);
    }
  });
});
