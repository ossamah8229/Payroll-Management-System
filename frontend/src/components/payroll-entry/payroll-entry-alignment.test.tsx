// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { PAYROLL_COLUMNS, computeColumnWidths, gridTemplateColumns } from './columns';
import { PayrollEntryRow } from './payroll-entry-row';
import { PayrollEntryTotalsRow } from './payroll-entry-totals-row';
import { LiveTotalsStore } from './live-totals-store';

/**
 * Operational Stabilization Checkpoint (2026-07-24) — Defect A regression coverage.
 *
 * `columns.test.ts` already proves `PAYROLL_COLUMNS`/`computeColumnWidths` are internally
 * consistent, but every one of those tests operates purely on the column-definition array — none
 * of them ever render a single component, so none of them could have caught (and didn't catch) the
 * actual shipped defect: `payroll-entry-totals-row.tsx`'s hand-written JSX silently omitted the
 * IBAN column's own placeholder cell, shifting every total from Gross Pay onward one column to the
 * left. These tests render the real components and assert what a browser actually paints: the
 * ordered sequence of `data-col-id` values in the header, a body row, and the totals row must all
 * equal `PAYROLL_COLUMNS`'s own order, exactly, with no gaps and no extras. Reverting
 * `payroll-entry-totals-row.tsx` to its pre-fix, hand-listed cell sequence fails the totals-row test
 * below immediately (verified while writing this file).
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

/** Every direct grid-item child, in DOM order, that carries the shared `data-col-id` convention —
 * the same attribute the header, body, and totals rows all now use. */
function dataColIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-col-id]')).map(
    (el) => el.getAttribute('data-col-id')!,
  );
}

describe('Payroll Entry grid — header/body/totals column alignment', () => {
  const expectedColumnIds = PAYROLL_COLUMNS.map((c) => c.id);

  it('the totals row renders exactly one cell per PAYROLL_COLUMNS entry, in the same order', () => {
    const entry = makeEntry({ iban: 'PK36SCBL0000001123456702' });
    const resolved = computeColumnWidths([entry], [testBank]);
    const store = new LiveTotalsStore();
    store.setBase([{ id: entry.id, snapshot: { grossPay: 30000, days: 30, otHours: 0, otRate: null, cycleDays: 30, leaveDays: 0, leaveRate: null, allowance: 0, eobiAmount: 400, advanceDeduction: 0, eidAdvanceDeduction: 0, fine: 0, netSalary: 29600 } }]);

    const { container } = render(
      <PayrollEntryTotalsRow store={store} gridTemplateColumns={gridTemplateColumns(resolved)} />,
    );

    expect(dataColIds(container)).toEqual(expectedColumnIds);
  });

  it('a body row renders exactly one cell per PAYROLL_COLUMNS entry, in the same order', () => {
    const entry = makeEntry();
    const resolved = computeColumnWidths([entry], [testBank]);
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={entry}
          rowIndex={0}
          cycleId="cycle-1"
          cycleStatus="DRAFT"
          banks={[testBank]}
          liveTotalsStore={new LiveTotalsStore()}
          gridTemplateColumns={gridTemplateColumns(resolved)}
          canCorrect={false}
          onCreateCorrection={() => {}}
          onViewCorrectionHistory={() => {}}
          style={{}}
        />
      </QueryClientProvider>,
    );

    expect(dataColIds(container)).toEqual(expectedColumnIds);
  });

  it('a released row (with the Released badge/actions cell) still renders every column exactly once, in order', () => {
    const entry = makeEntry({ released: true, releasedAt: '2026-07-01T00:00:00.000Z' });
    const resolved = computeColumnWidths([entry], [testBank]);
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={entry}
          rowIndex={0}
          cycleId="cycle-1"
          cycleStatus="DRAFT"
          banks={[testBank]}
          liveTotalsStore={new LiveTotalsStore()}
          gridTemplateColumns={gridTemplateColumns(resolved)}
          canCorrect
          onCreateCorrection={() => {}}
          onViewCorrectionHistory={() => {}}
          style={{}}
        />
      </QueryClientProvider>,
    );

    expect(dataColIds(container)).toEqual(expectedColumnIds);
  });

  /**
   * Section B, Operational Stabilization Checkpoint (2026-07-24) — "Payroll Entry data columns
   * should move together naturally... Data columns should not remain independently sticky/frozen
   * while other columns scroll." Investigation found `PayrollEntryGrid`'s only `position: sticky`
   * usage is the group-header row, the column-header row, and the totals row — each pinned on the
   * *vertical* axis only (`top`/`bottom`), inside the single scroll container that also carries the
   * body, so all three still pan horizontally together with the body (see that component's own doc
   * comment). No ordinary data cell (`[data-col-id]`, including `status`, where the Released badge
   * lives) carries `sticky`/`fixed`/`left-`/`right-` positioning, and no per-cell margin/transform
   * hack repositions any cell independently of the shared `gridTemplateColumns` every row/header/
   * totals cell already renders from. This test makes that mechanical, not just visually apparent —
   * it fails immediately if a future change reintroduces a per-column sticky/frozen offset or an
   * isolated Released-badge margin/transform hack, exactly what this checkpoint was told not to do
   * again.
   */
  it('no individual data cell (including the Released status cell) is independently sticky/frozen or carries a one-off repositioning hack', () => {
    const releasedEntry = makeEntry({ released: true, releasedAt: '2026-07-01T00:00:00.000Z' });
    const resolved = computeColumnWidths([releasedEntry], [testBank]);
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={releasedEntry}
          rowIndex={0}
          cycleId="cycle-1"
          cycleStatus="DRAFT"
          banks={[testBank]}
          liveTotalsStore={new LiveTotalsStore()}
          gridTemplateColumns={gridTemplateColumns(resolved)}
          canCorrect
          onCreateCorrection={() => {}}
          onViewCorrectionHistory={() => {}}
          style={{}}
        />
      </QueryClientProvider>,
    );

    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-col-id]'));
    expect(cells.length).toBeGreaterThan(0);

    for (const cell of cells) {
      const colId = cell.getAttribute('data-col-id');
      const className = cell.className;
      expect(className).not.toMatch(/\bsticky\b/);
      expect(className).not.toMatch(/\bfixed\b/);
      expect(className).not.toMatch(/\bleft-\d/);
      expect(className).not.toMatch(/\bright-\d/);
      // No one-off transform/margin hack (the exact anti-pattern this checkpoint forbids repeating
      // for the Released badge specifically, but checked for every column generally).
      expect(className).not.toMatch(/\btranslate-/);
      expect(cell.getAttribute('style') ?? '').not.toMatch(/position\s*:\s*(sticky|fixed|absolute)/);
      if (colId === 'status') {
        expect(className).not.toMatch(/\bm[trblxy]?-\d/); // no isolated margin nudging the badge
      }
    }

    // The row root itself carries the one shared `gridTemplateColumns` (inline style) and no
    // sticky/fixed positioning of its own — the whole row moves as a single horizontal unit.
    const rowRoot = container.querySelector('[role="row"]') as HTMLElement;
    expect(rowRoot.className).not.toMatch(/\bsticky\b/);
    expect(rowRoot.className).not.toMatch(/\bfixed\b/);
  });

  /**
   * Presentation & Workflow Stabilization Checkpoint, 2026-07-25, Issue 2 — regression guard for
   * "6 employees" rendering under the "Code" column (`employeeCode`) instead of the "Employee"
   * column (`employeeName`) it actually describes. Asserts by `data-col-id`, not DOM position, so
   * the test still catches the defect even if `PAYROLL_COLUMNS`'s own column order ever changes.
   */
  it('the totals row renders the employee count inside the Employee column, not the Code column', () => {
    const entries = [makeEntry({ id: 'entry-1' }), makeEntry({ id: 'entry-2' })];
    const resolved = computeColumnWidths(entries, [testBank]);
    const store = new LiveTotalsStore();
    store.setBase(
      entries.map((entry) => ({
        id: entry.id,
        snapshot: { grossPay: 30000, days: 30, otHours: 0, otRate: null, cycleDays: 30, leaveDays: 0, leaveRate: null, allowance: 0, eobiAmount: 400, advanceDeduction: 0, eidAdvanceDeduction: 0, fine: 0, netSalary: 29600 },
      })),
    );

    const { container } = render(
      <PayrollEntryTotalsRow store={store} gridTemplateColumns={gridTemplateColumns(resolved)} />,
    );

    const employeeNameCell = container.querySelector('[data-col-id="employeeName"]');
    const employeeCodeCell = container.querySelector('[data-col-id="employeeCode"]');
    expect(employeeNameCell?.textContent).toBe('2 employees');
    expect(employeeCodeCell?.textContent).toBe('');
  });

  /**
   * Presentation & Workflow Stabilization Checkpoint, 2026-07-25, Issue 1 — regression guard for
   * the Released badge being centered as part of a `[Badge, actions button]` flex group (which
   * visibly pulls the badge off the column's true center) instead of independently, in its own
   * grid track. Asserts the structural mechanism (badge and actions button occupy separate,
   * explicitly-placed grid columns of the status cell) rather than measuring pixel positions,
   * which jsdom doesn't lay out anyway.
   */
  it('the Released status cell centers the badge independently of the actions button via an explicit grid track', () => {
    const releasedEntry = makeEntry({ released: true, releasedAt: '2026-07-01T00:00:00.000Z' });
    const resolved = computeColumnWidths([releasedEntry], [testBank]);
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={releasedEntry}
          rowIndex={0}
          cycleId="cycle-1"
          cycleStatus="DRAFT"
          banks={[testBank]}
          liveTotalsStore={new LiveTotalsStore()}
          gridTemplateColumns={gridTemplateColumns(resolved)}
          canCorrect
          onCreateCorrection={() => {}}
          onViewCorrectionHistory={() => {}}
          style={{}}
        />
      </QueryClientProvider>,
    );

    const statusCell = container.querySelector('[data-col-id="status"]') as HTMLElement;
    expect(statusCell.className).toContain('grid-cols-[1fr_auto_1fr]');

    const badge = statusCell.querySelector('span') as HTMLElement;
    expect(badge.textContent).toBe('Released');
    expect(badge.className).toMatch(/\bcol-start-2\b/);
    // Not centered as part of a flex group with the actions button — the button lives in its own
    // trailing grid track (col-start-3), never sharing the badge's own centered track.
    expect(badge.className).not.toMatch(/\bcol-start-3\b/);

    const actionsButton = statusCell.querySelector('button[aria-label^="Released payroll actions"]') as HTMLElement;
    expect(actionsButton.className).toMatch(/\bcol-start-3\b/);
    expect(actionsButton.className).toMatch(/\bjustify-self-end\b/);
  });
});
