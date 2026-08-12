// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { PAYROLL_COLUMNS, computeColumnWidths, gridTemplateColumns, stickyLeftOffsets } from './columns';
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
      <PayrollEntryTotalsRow
        store={store}
        gridTemplateColumns={gridTemplateColumns(resolved)}
        identityOffsets={stickyLeftOffsets(resolved)}
      />,
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
          identityOffsets={stickyLeftOffsets(resolved)}
          canEditEmployee={false}
          canMarkEmployeeLeft={false}
          onEditEmployee={() => {}}
          onMarkLeftEmployee={() => {}}
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
          identityOffsets={stickyLeftOffsets(resolved)}
          canEditEmployee={false}
          canMarkEmployeeLeft={false}
          onEditEmployee={() => {}}
          onMarkLeftEmployee={() => {}}
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
   *
   * One deliberate exception lives here now — **Frozen Employee Identity Pane (UAT 2026-08-12)**:
   * `employeeCode`/`employeeName` are intentionally sticky on the *horizontal* axis with a dynamic
   * `left` offset (no static `left-0` class — the offset is per-column and computed from measured
   * widths), the data-entry-safety fix for employee identity scrolling out of view while entering
   * payroll values — see `columns.ts`'s `FROZEN_LEFT_COLUMN_IDS`/`stickyIdentityCellClassName` doc
   * comments. Carved out by id below; every other column must still pass the strict check this test
   * exists for.
   *
   * **Employee Row Actions (UAT 2026-08-11) no longer has a sticky-right exception at all** — UAT
   * feedback on that original implementation (a dedicated sticky-right `actions` column) was that
   * the `⋯` menu is a row characteristic, not a payroll data column; it was corrected (UAT
   * 2026-08-12) to render as a trailing flex sibling *outside* this row's own `[data-col-id]`
   * data-cell grid entirely (see `payroll-entry-row.tsx`), so it never appears among the `cells`
   * this test iterates below and needs no carve-out here.
   */
  it('no individual data cell (including the Released status cell) is independently sticky/frozen or carries a one-off repositioning hack, other than the documented sticky-left identity columns', () => {
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
          identityOffsets={stickyLeftOffsets(resolved)}
          canEditEmployee={false}
          canMarkEmployeeLeft={false}
          onEditEmployee={() => {}}
          onMarkLeftEmployee={() => {}}
          style={{}}
        />
      </QueryClientProvider>,
    );

    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-col-id]'));
    expect(cells.length).toBeGreaterThan(0);

    // `actions` is never among these cells at all — it was removed from `PAYROLL_COLUMNS` entirely
    // (row-level-control correction, UAT 2026-08-12); confirmed explicitly, not just by absence.
    expect(cells.some((cell) => cell.getAttribute('data-col-id') === 'actions')).toBe(false);

    for (const cell of cells) {
      const colId = cell.getAttribute('data-col-id');
      const className = cell.className;
      if (colId === 'employeeCode' || colId === 'employeeName') {
        // The documented sticky-left exception — see this test's own doc comment above. The offset
        // is dynamic (measured column widths), so it lives in the inline `style`, never a static
        // `left-\d` Tailwind class — asserted explicitly by the next block, not skipped here.
        expect(className).toMatch(/\bsticky\b/);
        expect(className).not.toMatch(/\bleft-\d/);
        expect(cell.style.left).not.toBe('');
        continue;
      }
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

    // The row root itself carries no sticky/fixed positioning of its own — the whole row (its
    // data-cell grid and its own trailing `⋯` action alike) moves as a single horizontal unit.
    const rowRoot = container.querySelector('[role="row"]') as HTMLElement;
    expect(rowRoot.className).not.toMatch(/\bsticky\b/);
    expect(rowRoot.className).not.toMatch(/\bfixed\b/);

    // The trailing row-action slot (row-level-control correction, UAT 2026-08-12) is likewise never
    // sticky/fixed — it scrolls in normal flow with the rest of the row, not as a second frozen pane.
    const actionSlot = container.querySelector('[data-row-action]') as HTMLElement;
    expect(actionSlot).toBeTruthy();
    expect(actionSlot.className).not.toMatch(/\bsticky\b/);
    expect(actionSlot.className).not.toMatch(/\bfixed\b/);
    expect(actionSlot.className).not.toMatch(/\bright-\d/);
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
      <PayrollEntryTotalsRow
        store={store}
        gridTemplateColumns={gridTemplateColumns(resolved)}
        identityOffsets={stickyLeftOffsets(resolved)}
      />,
    );

    const employeeNameCell = container.querySelector('[data-col-id="employeeName"]');
    const employeeCodeCell = container.querySelector('[data-col-id="employeeCode"]');
    expect(employeeNameCell?.textContent).toBe('2 employees');
    expect(employeeCodeCell?.textContent).toBe('');

    // Σ stays under the row-number/# column (`serial`) — the two footer anchors specified by the
    // acceptance target ("Σ under #", "N employees under Employee") both hold in the same render.
    const serialCell = container.querySelector('[data-col-id="serial"]');
    expect(serialCell?.textContent).toBe('Σ');
  });

  /**
   * Presentation & Workflow Stabilization Checkpoint, 2026-07-25, Issue 1 (final fix) — the
   * previous architecture centered a `[Badge, actions button]` pair inside a manually-tracked
   * `[1fr_auto_1fr]` grid, which visibly pulled the badge off the column's true center by roughly
   * half the button's own width. The row-level actions button (Create Correction / View
   * Correction History) is now removed from this cell entirely — Create Correction is reachable
   * from the page-level "Request Correction" toolbar button (its own Employee field can search and
   * select any released entry), and View Correction History is reachable from the Corrections
   * page. With nothing else sharing the cell, the Status cell is a single centered box: this test
   * asserts there is no secondary action element in the cell at all, not just that the badge
   * happens to be centered.
   */
  it('the Released status cell contains only the badge — no secondary action element shares the cell', () => {
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
          identityOffsets={stickyLeftOffsets(resolved)}
          canEditEmployee={false}
          canMarkEmployeeLeft={false}
          onEditEmployee={() => {}}
          onMarkLeftEmployee={() => {}}
          style={{}}
        />
      </QueryClientProvider>,
    );

    const statusCell = container.querySelector('[data-col-id="status"]') as HTMLElement;
    // Centered via a plain flex box — the same `items-center justify-center` convention every
    // other `align: 'center'` column in this row uses (serial, units, eobiApplicable, hold) — no
    // multi-track grid, no per-status special case.
    expect(statusCell.className).toMatch(/\bflex\b/);
    expect(statusCell.className).toMatch(/\bitems-center\b/);
    expect(statusCell.className).toMatch(/\bjustify-center\b/);
    expect(statusCell.className).not.toMatch(/grid-cols-/);

    expect(statusCell.textContent).toBe('Released');
    expect(statusCell.querySelector('button')).toBeNull();
    expect(statusCell.querySelector('[role="menu"]')).toBeNull();
    // No margin/translate/absolute one-off nudge on the badge itself.
    const badge = statusCell.querySelector('span') as HTMLElement;
    expect(badge.className).not.toMatch(/\bm[trblxy]?-\d/);
    expect(badge.className).not.toMatch(/\btranslate-/);
  });

  it('the unreleased "—" placeholder uses the same centered cell, with no action button either', () => {
    const unreleasedEntry = makeEntry({ released: false });
    const resolved = computeColumnWidths([unreleasedEntry], [testBank]);
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={unreleasedEntry}
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

    const statusCell = container.querySelector('[data-col-id="status"]') as HTMLElement;
    expect(statusCell.className).toMatch(/\bflex\b/);
    expect(statusCell.className).toMatch(/\bitems-center\b/);
    expect(statusCell.className).toMatch(/\bjustify-center\b/);
    expect(statusCell.textContent).toBe('—');
    expect(statusCell.querySelector('button')).toBeNull();
  });

  /**
   * Pre-release "Needs Attention" visibility (2026-07-27 refinement) — items A/C. A still
   * unresolved entry the backend flags via `releaseBlockReasons` must show a single "Needs
   * Attention" badge, centered exactly like every other Status outcome (never a second badge, and
   * never the old three-dot Status menu) — with the specific reason(s) available via a native
   * tooltip, the same lightweight `title`-attribute convention `SaveStatusIndicator` already uses
   * elsewhere in this row, rather than a new interactive popover pattern.
   */
  it('shows a single centered "Needs Attention" badge with reasons in its tooltip, and no action element, for a blocked entry', () => {
    const blockedEntry = makeEntry({
      released: false,
      payoutOutcome: null,
      releaseBlockReasons: ['Duplicate Account Number', 'Duplicate CNIC'],
    });
    const resolved = computeColumnWidths([blockedEntry], [testBank]);
    const queryClient = new QueryClient();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PayrollEntryRow
          entry={blockedEntry}
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

    const statusCell = container.querySelector('[data-col-id="status"]') as HTMLElement;
    expect(statusCell.className).toMatch(/\bflex\b/);
    expect(statusCell.className).toMatch(/\bitems-center\b/);
    expect(statusCell.className).toMatch(/\bjustify-center\b/);
    expect(statusCell.className).not.toMatch(/grid-cols-/);
    expect(statusCell.textContent).toBe('Needs Attention');
    expect(statusCell.querySelectorAll('span').length).toBe(1); // exactly one badge, no second warning badge
    expect(statusCell.querySelector('button')).toBeNull();
    expect(statusCell.querySelector('[role="menu"]')).toBeNull();

    const badge = statusCell.querySelector('span') as HTMLElement;
    expect(badge.getAttribute('title')).toBe('Reasons:\n• Duplicate Account Number\n• Duplicate CNIC');
    // Never another employee's own identifying details in the tooltip — only generic reason text.
    expect(badge.getAttribute('title')).not.toMatch(/employee-|SHARED|ACC-/i);
  });
});

/**
 * Frozen Employee Identity Pane (UAT 2026-08-12) — payroll values directly affect salary
 * calculations, so employee identity (`employeeCode`/`employeeName`) must stay visible while the
 * grid's ~26 columns scroll horizontally, never scrolling out of view alongside them. These tests
 * assert the mechanics `columns.ts`'s `stickyLeftOffsets`/`stickyIdentityCellClassName` are built
 * on: correct, cumulative-only-across-the-frozen-pair pixel offsets, and that the header, body, and
 * totals row all render those columns pixel-aligned on the exact same shared offsets — never three
 * independently-computed copies that could silently drift apart under horizontal scroll.
 */
describe('Payroll Entry grid — Frozen Employee Identity Pane (UAT 2026-08-12)', () => {
  it('employeeCode sticks at offset 0 and employeeName sticks immediately after it — never offset by serial/status, which are not part of the frozen pane', () => {
    const entry = makeEntry();
    const resolved = computeColumnWidths([entry], [testBank]);
    const offsets = stickyLeftOffsets(resolved);

    const employeeCodeWidth = resolved.find((c) => c.id === 'employeeCode')!.width;
    expect(offsets.employeeCode).toBe(0);
    expect(offsets.employeeName).toBe(employeeCodeWidth);

    // Sanity check the exclusion: `serial`/`status` precede `employeeCode` in `PAYROLL_COLUMNS` and
    // together are non-trivially wide, so a bug that accidentally included them in the cumulative
    // sum would produce a non-zero `employeeCode` offset — this assertion would catch that class of
    // regression, not just happen to pass by coincidence.
    const serialWidth = resolved.find((c) => c.id === 'serial')!.width;
    const statusWidth = resolved.find((c) => c.id === 'status')!.width;
    expect(serialWidth + statusWidth).toBeGreaterThan(0);
    expect(offsets.employeeCode).not.toBe(serialWidth + statusWidth);
  });

  it('every non-frozen column has no entry in the offsets map at all', () => {
    const entry = makeEntry();
    const resolved = computeColumnWidths([entry], [testBank]);
    const offsets = stickyLeftOffsets(resolved);

    for (const column of resolved) {
      if (column.id === 'employeeCode' || column.id === 'employeeName') continue;
      expect(offsets[column.id as keyof typeof offsets]).toBeUndefined();
    }
  });

  it('the body row renders employeeCode/employeeName as sticky-left at those exact offsets, with the trailing divider only on employeeName', () => {
    const entry = makeEntry();
    const resolved = computeColumnWidths([entry], [testBank]);
    const offsets = stickyLeftOffsets(resolved);
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
          identityOffsets={offsets}
          canEditEmployee={false}
          canMarkEmployeeLeft={false}
          onEditEmployee={() => {}}
          onMarkLeftEmployee={() => {}}
          style={{}}
        />
      </QueryClientProvider>,
    );

    const codeCell = container.querySelector('[data-col-id="employeeCode"]') as HTMLElement;
    const nameCell = container.querySelector('[data-col-id="employeeName"]') as HTMLElement;

    expect(codeCell.className).toMatch(/\bsticky\b/);
    expect(codeCell.className).not.toMatch(/\bleft-\d/); // dynamic offset, not a static Tailwind class
    expect(codeCell.style.left).toBe(`${offsets.employeeCode}px`);
    expect(codeCell.className).not.toMatch(/\bborder-r\b/); // no divider between the pane's own two columns

    expect(nameCell.className).toMatch(/\bsticky\b/);
    expect(nameCell.style.left).toBe(`${offsets.employeeName}px`);
    expect(nameCell.className).toMatch(/\bborder-r\b/); // the pane's own right-edge divider

    // Body and its own offsets must resolve to the same numbers `computeColumnWidths` produced —
    // the mechanical proof that this row is pixel-aligned with the header/totals row, which are fed
    // the identical `offsets` object from the same grid-level calculation in real usage.
    const employeeCodeWidth = resolved.find((c) => c.id === 'employeeCode')!.width;
    expect(codeCell.style.left).toBe('0px');
    expect(nameCell.style.left).toBe(`${employeeCodeWidth}px`);
  });

  it('the totals row renders employeeCode/employeeName as sticky-left at the same offsets the body row uses', () => {
    const entry = makeEntry();
    const resolved = computeColumnWidths([entry], [testBank]);
    const offsets = stickyLeftOffsets(resolved);
    const store = new LiveTotalsStore();
    store.setBase([{ id: entry.id, snapshot: { grossPay: 30000, days: 30, otHours: 0, otRate: null, cycleDays: 30, leaveDays: 0, leaveRate: null, allowance: 0, eobiAmount: 400, advanceDeduction: 0, eidAdvanceDeduction: 0, fine: 0, netSalary: 29600 } }]);

    const { container } = render(
      <PayrollEntryTotalsRow store={store} gridTemplateColumns={gridTemplateColumns(resolved)} identityOffsets={offsets} />,
    );

    const codeCell = container.querySelector('[data-col-id="employeeCode"]') as HTMLElement;
    const nameCell = container.querySelector('[data-col-id="employeeName"]') as HTMLElement;
    expect(codeCell.className).toMatch(/\bsticky\b/);
    expect(codeCell.style.left).toBe(`${offsets.employeeCode}px`);
    expect(nameCell.className).toMatch(/\bsticky\b/);
    expect(nameCell.style.left).toBe(`${offsets.employeeName}px`);
    expect(nameCell.className).toMatch(/\bborder-r\b/);
  });
});
