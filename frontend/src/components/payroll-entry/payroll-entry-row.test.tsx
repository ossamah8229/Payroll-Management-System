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

/**
 * v1.0.0 release blocker — Payroll Entry Working-Days Aggregation and Export Correctness. The
 * parent row's Working Days cell cannot simultaneously *display* an employee's aggregate across
 * several work lines and be *directly editable* as a single primary-line input — typing over a
 * displayed "20" (a sum of two lines) would silently overwrite only the primary line, corrupting
 * the real total invisibly. A single-unit employee is unaffected (the aggregate and the primary
 * line's own value are identical), so this only changes rendering for a genuine split employee,
 * whose individual lines remain editable exclusively via the existing "Split by {unitLabel}" modal.
 */
describe('PayrollEntryRow — employee aggregate Working Days display (v1.0.0 Working-Days Aggregation)', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock('@/hooks/use-payroll-entry-editor');
  });

  function makeWorkLine(id: string, unitId: string, unitName: string, unitCode: string, days: string, sortOrder: number) {
    return {
      id,
      payrollEntryId: 'entry-1',
      siteId: 'site-1',
      unitId,
      unit: { id: unitId, siteId: 'site-1', name: unitName, code: unitCode, isActive: true, createdAt: '', updatedAt: '' },
      days,
      otHours: '0',
      otRate: null,
      cycleDays: 30,
      sortOrder,
      createdAt: '',
      updatedAt: '',
    };
  }

  async function renderRowWithWorkLines(workLines: PayrollEntry['workLines'], totalWorkingDays: string) {
    const base = makeEntry();
    const entry = makeEntry({ workLines, calc: { ...base.calc, totalWorkingDays } });
    vi.doMock('@/hooks/use-payroll-entry-editor', () => ({
      usePayrollEntryEditor: () => ({
        editable: true,
        effectiveEntry: entry,
        effectiveLine: entry.workLines[0],
        effectiveLines: entry.workLines,
        cycleDaysInputValue: String(entry.workLines[0]!.cycleDays),
        calc: entry.calc,
        status: 'idle' as const,
        errorMessage: undefined,
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

  it('a single-unit employee is unchanged: Working Days stays a directly-editable input showing that one line\'s own value', async () => {
    await renderRowWithWorkLines(makeEntry().workLines, '30');

    const input = screen.getByLabelText('Working days for Conflict Test Employee') as HTMLInputElement;
    expect(input.value).toBe('30');
    expect(input.disabled).toBe(false);
  });

  it('a two-unit split employee (10 + 10) shows the read-only aggregate 20, never the primary line\'s own 10, with no directly-editable Working Days input', async () => {
    await renderRowWithWorkLines(
      [makeWorkLine('line-a', 'unit-a', 'Unit A', 'UA', '10', 0), makeWorkLine('line-b', 'unit-b', 'Unit B', 'UB', '10', 1)],
      '20',
    );

    expect(screen.queryByLabelText('Working days for Conflict Test Employee')).toBeNull();
    const daysCell = document.querySelector('[data-col-id="days"]') as HTMLElement;
    expect(daysCell.textContent).toBe('20');
  });

  it('an unequal three-unit split (5 + 8 + 9.5) shows the read-only aggregate 22.5 — not a two-line special case', async () => {
    await renderRowWithWorkLines(
      [
        makeWorkLine('line-a', 'unit-a', 'Unit A', 'UA', '5', 0),
        makeWorkLine('line-b', 'unit-b', 'Unit B', 'UB', '8', 1),
        makeWorkLine('line-c', 'unit-c', 'Unit C', 'UC', '9.5', 2),
      ],
      '22.5',
    );

    const daysCell = document.querySelector('[data-col-id="days"]') as HTMLElement;
    expect(daysCell.textContent).toBe('22.5');
  });
});

/**
 * Employee Identity Visibility (v1.0.1 Checkpoint 1, 2026-08-25) — duplicate-name regression
 * coverage. Two employees can legitimately share a name (e.g. two "Muhammad Talha"s); before this
 * checkpoint, Payroll Entry's frozen identity pane (Code + Employee only) could not tell them apart
 * without opening Employee Registry. Renders two rows with the same `employee.name` but distinct
 * Employee Code/Father Name/CNIC, side by side, and proves each is independently identifiable.
 */
describe('PayrollEntryRow — duplicate-name distinguishability (Employee Identity Visibility, v1.0.1 Checkpoint 1)', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock('@/hooks/use-payroll-entry-editor');
  });

  function makeDuplicateNameEntry(overrides: {
    id: string;
    employeeCode: string;
    fatherName: string;
    cnic: string;
  }) {
    const base = makeEntry();
    return makeEntry({
      id: overrides.id,
      employeeId: overrides.id,
      employee: {
        ...base.employee,
        id: overrides.id,
        employeeCode: overrides.employeeCode,
        name: 'Muhammad Talha',
        fatherName: overrides.fatherName,
        cnic: overrides.cnic,
      },
    });
  }

  it('two same-named employees (Muhammad Talha) render distinct Code/Father Name/CNIC in the same grid, both simultaneously visible and independently identifiable', async () => {
    const entryA = makeDuplicateNameEntry({
      id: 'employee-talha-a',
      employeeCode: 'EMP-001',
      fatherName: 'Abdul Rehman',
      cnic: '3520212345671',
    });
    const entryB = makeDuplicateNameEntry({
      id: 'employee-talha-b',
      employeeCode: 'EMP-002',
      fatherName: 'Muhammad Farooq',
      cnic: '3520298765432',
    });

    // A single mock, keyed off whichever `entry` its own row passes in — both rows share this one
    // mocked hook module, unlike every other describe block in this file (which each render exactly
    // one row per test and can afford a mock closed over one fixed entry).
    vi.doMock('@/hooks/use-payroll-entry-editor', () => ({
      usePayrollEntryEditor: (entry: PayrollEntry) => ({
        editable: true,
        effectiveEntry: entry,
        effectiveLine: entry.workLines[0],
        effectiveLines: entry.workLines,
        cycleDaysInputValue: String(entry.workLines[0]!.cycleDays),
        calc: entry.calc,
        status: 'idle' as const,
        errorMessage: undefined,
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
    const resolved = computeColumnWidths([entryA, entryB], [testBank]);
    const gridTemplate = gridTemplateColumns(resolved);
    const offsets = stickyLeftOffsets(resolved);
    const queryClient = new QueryClient();
    const store = new LiveTotalsStore();

    render(
      <QueryClientProvider client={queryClient}>
        <div role="table" aria-label="Payroll Entry grid">
          <PayrollEntryRow
            entry={entryA}
            rowIndex={0}
            cycleId="cycle-1"
            cycleStatus="DRAFT"
            banks={[testBank]}
            liveTotalsStore={store}
            gridTemplateColumns={gridTemplate}
            identityOffsets={offsets}
            canEditEmployee={false}
            canMarkEmployeeLeft={false}
            onEditEmployee={() => {}}
            onMarkLeftEmployee={() => {}}
            style={{}}
          />
          <PayrollEntryRow
            entry={entryB}
            rowIndex={1}
            cycleId="cycle-1"
            cycleStatus="DRAFT"
            banks={[testBank]}
            liveTotalsStore={store}
            gridTemplateColumns={gridTemplate}
            identityOffsets={offsets}
            canEditEmployee={false}
            canMarkEmployeeLeft={false}
            onEditEmployee={() => {}}
            onMarkLeftEmployee={() => {}}
            style={{}}
          />
        </div>
      </QueryClientProvider>,
    );

    // Both rows genuinely render, both under the same displayed name — the exact ambiguity this
    // checkpoint exists to resolve.
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.textContent).toContain('Muhammad Talha');
    }

    const codeCells = document.querySelectorAll('[data-col-id="employeeCode"]');
    const fatherCells = document.querySelectorAll('[data-col-id="fatherName"]');
    const cnicCells = document.querySelectorAll('[data-col-id="cnic"]');
    expect(codeCells).toHaveLength(2);
    expect(fatherCells).toHaveLength(2);
    expect(cnicCells).toHaveLength(2);

    // Row A and Row B are each independently distinguishable purely from grid content — never
    // requiring navigation to an employee detail page.
    expect(codeCells[0]!.textContent).toBe('EMP-001');
    expect(codeCells[1]!.textContent).toBe('EMP-002');
    expect(fatherCells[0]!.textContent).toBe('Abdul Rehman');
    expect(fatherCells[1]!.textContent).toBe('Muhammad Farooq');
    expect(cnicCells[0]!.textContent).toBe('3520212345671');
    expect(cnicCells[1]!.textContent).toBe('3520298765432');
    expect(codeCells[0]!.textContent).not.toBe(codeCells[1]!.textContent);
    expect(fatherCells[0]!.textContent).not.toBe(fatherCells[1]!.textContent);
    expect(cnicCells[0]!.textContent).not.toBe(cnicCells[1]!.textContent);

    // Both rows' four identity cells are sticky-left, at the same shared offsets — the frozen pane
    // protects both rows identically, not just row 0.
    for (const cell of [...codeCells, ...fatherCells, ...cnicCells]) {
      expect(cell.className).toMatch(/\bsticky\b/);
    }
  });

  it('a same-named employee with no Father Name/CNIC on record renders the established "—" empty-value convention, never blank/undefined, and stays distinguishable by Employee Code', async () => {
    const entry = makeDuplicateNameEntry({
      id: 'employee-talha-c',
      employeeCode: 'EMP-003',
      fatherName: '',
      cnic: '',
    });
    entry.employee.fatherName = null;
    entry.employee.cnic = null;

    vi.doMock('@/hooks/use-payroll-entry-editor', () => ({
      usePayrollEntryEditor: (e: PayrollEntry) => ({
        editable: true,
        effectiveEntry: e,
        effectiveLine: e.workLines[0],
        effectiveLines: e.workLines,
        cycleDaysInputValue: String(e.workLines[0]!.cycleDays),
        calc: e.calc,
        status: 'idle' as const,
        errorMessage: undefined,
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

    const fatherCell = document.querySelector('[data-col-id="fatherName"]') as HTMLElement;
    const cnicCell = document.querySelector('[data-col-id="cnic"]') as HTMLElement;
    expect(fatherCell.textContent).toBe('—');
    expect(cnicCell.textContent).toBe('—');
    const codeCell = document.querySelector('[data-col-id="employeeCode"]') as HTMLElement;
    expect(codeCell.textContent).toBe('EMP-003');
  });
});
