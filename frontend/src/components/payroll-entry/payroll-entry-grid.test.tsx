// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollCycle } from '@/hooks/use-payroll-cycles';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { PayrollEntryGrid } from './payroll-entry-grid';
import { computeColumnWidths, stickyLeftOffsets } from './columns';

// jsdom reports every element as 0×0 and has no real ResizeObserver, so `@tanstack/react-virtual`
// (which sizes its visible window from the scroll container's measured height) would otherwise
// compute an empty virtual range and render zero body rows — a jsdom limitation, not a real
// application behavior. Stubbing a non-zero `clientHeight`/`getBoundingClientRect` and a no-op
// `ResizeObserver` is the standard workaround so these tests can assert on actually-rendered rows.
beforeAll(() => {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = MockResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 1200, height: 800, top: 0, left: 0, bottom: 800, right: 1200, x: 0, y: 0, toJSON() {} }) as DOMRect;

  // Real Radix `DropdownMenu` interaction in jsdom (row-action recycling test below) needs the same
  // polyfills already established for `payroll-entry-row-actions.test.tsx` — a plain `fireEvent.click`
  // on the trigger never opens a Radix dropdown in jsdom.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.PointerEvent) {
    window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
  }
});

function makeEntry(overrides: Partial<PayrollEntry> & { id: string }): PayrollEntry {
  const id = overrides.id;
  return {
    cycleId: 'cycle-1',
    employeeId: `employee-${id}`,
    employee: {
      id: `employee-${id}`,
      employeeCode: null,
      cnic: null,
      name: 'Employee',
      fatherName: null,
      religion: null,
      dateOfBirth: null,
      mobileNumber: null,
      designation: 'Guard',
      siteId: 'site-1',
      site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
      unitId: 'unit-live',
      // Deliberately a *different* code than any work line's own `unit.code` below — proves the
      // grid's Branch Code column reads each entry's own work-line `unit`, never the employee's
      // current live default unit (which would silently rewrite a released entry's history).
      unit: { id: 'unit-live', siteId: 'site-1', name: 'Current Live Branch', code: 'LIVE-CODE', isActive: true, createdAt: '', updatedAt: '' },
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
        id: `line-${id}`,
        payrollEntryId: id,
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

const testCycle: PayrollCycle = {
  id: 'cycle-1',
  year: 2026,
  month: 7,
  status: 'DRAFT',
  sourceCycleId: null,
  createdAt: '',
  createdBy: 'user-1',
  releasedAt: null,
  releasedBy: null,
  archivedAt: null,
  archivedBy: null,
  isCurrentDraft: true,
};

const testBank: Bank = { id: 'bank-1', code: 'HABIBMETRO', name: 'Habib Metropolitan Bank', isActive: true, isReferenced: true };

function employeeNamesInOrder(): string[] {
  return screen.getAllByRole('row').map((row) => within(row).queryByText(/Employee /)?.textContent ?? '').filter(Boolean);
}

function renderGrid(
  entries: PayrollEntry[],
  opts: {
    canEditEmployee?: boolean;
    canMarkEmployeeLeft?: boolean;
    onEditEmployee?: (employee: PayrollEntry['employee']) => void;
    onMarkLeftEmployee?: (employee: PayrollEntry['employee']) => void;
  } = {},
) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollEntryGrid
        cycle={testCycle}
        entries={entries}
        banks={[testBank]}
        canEditEmployee={opts.canEditEmployee ?? false}
        canMarkEmployeeLeft={opts.canMarkEmployeeLeft ?? false}
        onEditEmployee={opts.onEditEmployee ?? (() => {})}
        onMarkLeftEmployee={opts.onMarkLeftEmployee ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

describe('PayrollEntryGrid — sortable columns (Payroll Entry usability checkpoint, 2026-07-24)', () => {
  afterEach(() => cleanup());

  it('shows a visible, correctly-populated Deputed Branch column sourced from each entry’s own work line, for Draft rows', () => {
    const entry = makeEntry({ id: '1', employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee One' } });
    renderGrid([entry]);

    const header = screen.getByRole('columnheader', { name: /deputed branch/i });
    expect(header).toBeTruthy();

    const unitCodeCells = document.querySelectorAll('[data-col-id="unitCode"]');
    // One header cell + one body cell for the single rendered row.
    const bodyCell = Array.from(unitCodeCells).find((el) => el.textContent === 'BR-01');
    expect(bodyCell).toBeTruthy();
    // Never the employee's own current default unit code ("LIVE-CODE") — that would be the wrong,
    // historically-incorrect source for a released/archived entry.
    expect(Array.from(unitCodeCells).some((el) => el.textContent === 'LIVE-CODE')).toBe(false);
  });

  it('preserves a released entry’s own historical work-line Deputed Branch code, distinct from the employee’s current unit', () => {
    const released = makeEntry({
      id: '1',
      released: true,
      releasedAt: '2026-07-01T00:00:00.000Z',
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Released Employee' },
    });
    renderGrid([released]);

    const unitCodeCells = Array.from(document.querySelectorAll('[data-col-id="unitCode"]'));
    expect(unitCodeCells.some((el) => el.textContent === 'BR-01')).toBe(true);
  });

  it('clicking the Employee header sorts full rows A→Z, then Z→A on a second click — never individual cells', () => {
    const alice = makeEntry({ id: '1', employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee Alice' } });
    const charlie = makeEntry({ id: '2', employee: { ...makeEntry({ id: '2' }).employee, name: 'Employee Charlie' } });
    const bob = makeEntry({ id: '3', employee: { ...makeEntry({ id: '3' }).employee, name: 'Employee Bob' } });
    renderGrid([charlie, alice, bob]);

    const header = within(screen.getByRole('columnheader', { name: 'Employee' })).getByRole('button');
    fireEvent.click(header);
    expect(employeeNamesInOrder()).toEqual(['Employee Alice', 'Employee Bob', 'Employee Charlie']);

    fireEvent.click(header);
    expect(employeeNamesInOrder()).toEqual(['Employee Charlie', 'Employee Bob', 'Employee Alice']);
  });

  it('sorting never changes the totals row — it still represents the full filtered dataset regardless of display order', () => {
    const one = makeEntry({ id: '1', grossPay: '10000', employee: { ...makeEntry({ id: '1' }).employee, name: 'Zed' } });
    const two = makeEntry({ id: '2', grossPay: '20000', employee: { ...makeEntry({ id: '2' }).employee, name: 'Anna' } });
    renderGrid([one, two]);

    const grossPayCellsBefore = document.querySelectorAll('[data-col-id="grossPay"]');
    const totalsGrossBefore = grossPayCellsBefore[grossPayCellsBefore.length - 1]?.textContent;

    const header = within(screen.getByRole('columnheader', { name: 'Employee' })).getByRole('button');
    fireEvent.click(header);

    const grossPayCellsAfter = document.querySelectorAll('[data-col-id="grossPay"]');
    const totalsGrossAfter = grossPayCellsAfter[grossPayCellsAfter.length - 1]?.textContent;
    expect(totalsGrossAfter).toBe(totalsGrossBefore);
    // Sanity check the total is actually the sum, not a coincidental match (e.g. both empty).
    expect(totalsGrossAfter).toBe('PKR 30,000.00');
  });
});

describe('PayrollEntryGrid — sticky header containment (Post-Checkpoint-1A UAT Stabilization)', () => {
  afterEach(() => cleanup());

  /**
   * Root cause of the reported "sticky header reveals a blank/underlying strip while scrolling":
   * each virtualized row was fully transparent (`background-color: rgba(0,0,0,0)`), relying
   * entirely on the ancestor Card's own incidental white background rather than painting its own
   * opaque surface — a real robustness gap for a row sharing screen space with the grid's sticky
   * header/totals rows during scroll compositing. Every row must now be its own explicit, opaque
   * paint surface (`bg-surface-2`), regardless of what's behind it.
   */
  it('every body row has an explicit opaque background — never relying on an ancestor to happen to be white', () => {
    const entry = makeEntry({ id: '1', employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee One' } });
    renderGrid([entry]);

    const row = screen.getByRole('row', { name: /Employee One/ });
    expect(row.className).toMatch(/\bbg-surface-2\b/);
  });

  it('the sticky group-header and column-header rows both carry an opaque background and elevated z-index above body rows', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    // The group-label row ("BANK DETAILS" etc.) and the column-header row ("#", "STATUS", ...) —
    // both directly sticky, both directly opaque (the totals row is sticky too, but its own
    // opaque `bg-surface` lives on its child `PayrollEntryTotalsRow`, not this outer wrapper, so
    // it's deliberately excluded from this direct-class assertion).
    const columnHeaderRow = screen.getByRole('columnheader', { name: 'Employee' }).closest('[role="row"]')!;
    expect(columnHeaderRow.className).toMatch(/\bsticky\b/);
    expect(columnHeaderRow.className).toMatch(/\bbg-surface\b/);
    expect(columnHeaderRow.className).toMatch(/\bz-20\b/);

    const groupHeaderRow = columnHeaderRow.previousElementSibling!;
    expect(groupHeaderRow.className).toMatch(/\bsticky\b/);
    expect(groupHeaderRow.className).toMatch(/\bbg-surface\b/);
    expect(groupHeaderRow.className).toMatch(/\bz-20\b/);
  });
});

describe('PayrollEntryGrid — EOBI footer total (Post-Checkpoint-1A UAT Stabilization)', () => {
  afterEach(() => cleanup());

  function eobiFooterTotal(): string | null {
    const cells = document.querySelectorAll('[data-col-id="eobiAmount"]');
    return cells[cells.length - 1]?.textContent ?? null;
  }

  it('excludes a disabled row entirely — the footer must never sum raw eobiAmount regardless of eobiApplicable', () => {
    const disabled = makeEntry({
      id: '1',
      eobiAmount: '400',
      eobiApplicable: false,
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee Disabled' },
    });
    renderGrid([disabled]);

    expect(eobiFooterTotal()).toBe('PKR 0.00');
  });

  it('includes every enabled row at its own configured amount', () => {
    const enabled = makeEntry({
      id: '1',
      eobiAmount: '400',
      eobiApplicable: true,
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee Enabled' },
    });
    renderGrid([enabled]);

    expect(eobiFooterTotal()).toBe('PKR 400.00');
  });

  it('mixed applicable/non-applicable rows — only the enabled rows contribute to the total', () => {
    const enabledA = makeEntry({
      id: '1',
      eobiAmount: '400',
      eobiApplicable: true,
      employee: { ...makeEntry({ id: '1' }).employee, name: 'Employee A' },
    });
    const disabled = makeEntry({
      id: '2',
      eobiAmount: '400',
      eobiApplicable: false,
      employee: { ...makeEntry({ id: '2' }).employee, name: 'Employee B' },
    });
    const enabledC = makeEntry({
      id: '3',
      eobiAmount: '550',
      eobiApplicable: true,
      employee: { ...makeEntry({ id: '3' }).employee, name: 'Employee C' },
    });
    renderGrid([enabledA, disabled, enabledC]);

    // 400 + 550, the disabled row's own 400 excluded entirely — never 1,350.
    expect(eobiFooterTotal()).toBe('PKR 950.00');
  });
});

describe('PayrollEntryGrid — Status column header alignment (Presentation & Workflow Stabilization Checkpoint, 2026-07-25)', () => {
  afterEach(() => cleanup());

  /**
   * Root cause of the reported "STATUS misaligned" defect: the header row applied no per-column
   * text alignment at all, so a center-aligned column's header label always rendered left-aligned
   * regardless of what its body cells did — the header and body were never sharing one alignment
   * decision. The header must now derive its own alignment from `PAYROLL_COLUMNS`' own `align`
   * field (the same field the column's body cells are centered per), via `data-col-id`, not via a
   * one-off Status-only class.
   */
  it('the Status column header is centered, matching the canonical center-align of the Status column definition', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    const header = document.querySelector('[data-col-id="status"][role="columnheader"]') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.className).toMatch(/\btext-center\b/);
  });

  it('a non-center-aligned header (Employee) does not get the center-alignment class', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    const header = document.querySelector('[data-col-id="employeeName"][role="columnheader"]') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.className).not.toMatch(/\btext-center\b/);
  });
});

describe('PayrollEntryGrid — Frozen Employee Identity Pane (UAT 2026-08-12)', () => {
  afterEach(() => cleanup());

  it('the group-header span and column-header cell for employeeCode/employeeName are both sticky-left at the same computed offsets', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    const resolved = computeColumnWidths([entry], [testBank]);
    const offsets = stickyLeftOffsets(resolved);

    const codeHeader = document.querySelector('[data-col-id="employeeCode"][role="columnheader"]') as HTMLElement;
    const nameHeader = document.querySelector('[data-col-id="employeeName"][role="columnheader"]') as HTMLElement;
    expect(codeHeader.className).toMatch(/\bsticky\b/);
    expect(codeHeader.style.left).toBe(`${offsets.employeeCode}px`);
    expect(nameHeader.className).toMatch(/\bsticky\b/);
    expect(nameHeader.style.left).toBe(`${offsets.employeeName}px`);

    // The blank group-label row ("Bank Details"/"EOBI" spans) above the column headers carries the
    // same two columns as their own individual (ungrouped) spans — must be pixel-aligned with the
    // column header directly beneath, or the frozen pane would visibly split under horizontal
    // scroll (the header/group-row misalignment this checkpoint's UAT acceptance criteria G calls
    // out explicitly).
    const groupRow = codeHeader.closest('[role="row"]')!.previousElementSibling as HTMLElement;
    const groupSpans = Array.from(groupRow.children) as HTMLElement[];
    const codeSpanIndex = Array.from(
      codeHeader.parentElement!.querySelectorAll('[role="columnheader"]'),
    ).indexOf(codeHeader);
    const nameSpanIndex = codeSpanIndex + 1;
    expect(groupSpans[codeSpanIndex]!.style.left).toBe(`${offsets.employeeCode}px`);
    expect(groupSpans[nameSpanIndex]!.style.left).toBe(`${offsets.employeeName}px`);
  });

  it('the sticky-left identity pane ends well before the grid’s own right edge, and no column header is sticky-right (row-level-control correction, UAT 2026-08-12: the `⋯` action is no longer a column at all)', () => {
    const entry = makeEntry({ id: '1' });
    renderGrid([entry]);

    // `actions` was never a `PAYROLL_COLUMNS` entry to begin with — no such header cell exists.
    expect(document.querySelector('[data-col-id="actions"]')).toBeNull();
    // No column header carries the sticky-right treatment; that pattern is retired entirely.
    for (const header of Array.from(document.querySelectorAll<HTMLElement>('[role="columnheader"]'))) {
      expect(header.className).not.toMatch(/\bright-0\b/);
      expect(header.className).not.toMatch(/\bsticky\b.*\bright-/);
    }

    const nameHeader = document.querySelector('[data-col-id="employeeName"][role="columnheader"]') as HTMLElement;
    const resolved = computeColumnWidths([entry], [testBank]);
    const offsets = stickyLeftOffsets(resolved);
    expect(nameHeader.style.left).toBe(`${offsets.employeeName}px`);
    const nameWidth = resolved.find((c) => c.id === 'employeeName')!.width;
    const identityPaneRightEdge = offsets.employeeName! + nameWidth;
    // The grid sums past 2,300px across ~26 columns (`columns.ts`'s own documented figure) — the
    // frozen pane's own right edge is nowhere near that total, so there is ample scrollable content
    // to its right at every column-width configuration this dataset can produce.
    const totalWidth = resolved.reduce((sum, c) => sum + c.width, 0);
    expect(identityPaneRightEdge).toBeLessThan(totalWidth - 500);
  });

  /**
   * Virtualization/recycling safety (UAT acceptance criteria E/F) — `PayrollEntryGrid` keys each
   * virtualized row by the entry's own stable `id` (`payroll-entry-grid.tsx`'s
   * `<PayrollEntryRow key={entry.id} .../>`), not by virtual slot index, so React never reuses one
   * row's DOM subtree — including its own sticky identity cells — for a different employee's data;
   * a slot simply mounts/unmounts per entry identity. This test proves that holds after a real
   * scroll-down/scroll-up cycle: the row that scrolls back into view must show its own original
   * employee's frozen identity, not whatever entry last occupied that screen position.
   */
  it('after scrolling down and back up, the frozen identity cell for the first row still shows that row’s own employee — no stale identity from a recycled slot', () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      makeEntry({ id: String(i), employee: { ...makeEntry({ id: String(i) }).employee, name: `Employee Scroll ${i}` } }),
    );
    renderGrid(entries);

    const grid = screen.getByRole('table', { name: 'Payroll Entry grid' });
    expect(within(grid).getAllByText('Employee Scroll 0').length).toBeGreaterThan(0);

    fireEvent.scroll(grid, { target: { scrollTop: 4000 } });
    fireEvent.scroll(grid, { target: { scrollTop: 0 } });

    // Same query as the pre-scroll assertion above — after the scroll-down/scroll-up round trip,
    // the first row's own frozen identity cell must still resolve to its own employee, and that
    // element must be the sticky-left `employeeName` cell specifically (not the header, which also
    // renders the literal string "Employee" but never "Employee Scroll 0").
    const matches = within(grid).getAllByText('Employee Scroll 0');
    expect(matches.length).toBeGreaterThan(0);
    const identityCell = matches[0]!.closest('[data-col-id="employeeName"]') as HTMLElement | null;
    expect(identityCell).toBeTruthy();
    expect(identityCell!.className).toMatch(/\bsticky\b/);
  });

  /**
   * Row-level-control correction (UAT 2026-08-12) — the trailing `⋯` menu is rendered per row
   * (`payroll-entry-row.tsx`), not as a `PAYROLL_COLUMNS` cell, but it is still subject to the same
   * keyed-by-`entry.id` mount/unmount discipline as the identity cells above: a virtualized slot
   * scrolled far enough out of view fully unmounts its `PayrollEntryRow` (and with it, Radix
   * `DropdownMenu`'s own internal open/closed state), then mounts a fresh instance — closed by
   * default — for whichever employee now occupies that slot. This proves an open menu never survives
   * a recycle and reappears open for, or attached to, a different employee.
   */
  it('a scrolled-away-and-back row never leaves a stale open ⋯ menu, or one attached to the wrong employee, after virtualized recycling', () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      makeEntry({ id: String(i), employee: { ...makeEntry({ id: String(i) }).employee, name: `Employee Action Scroll ${i}` } }),
    );
    renderGrid(entries, { canEditEmployee: true, canMarkEmployeeLeft: true });

    const grid = screen.getByRole('table', { name: 'Payroll Entry grid' });
    const firstName = 'Employee Action Scroll 0';
    expect(within(grid).getAllByText(firstName).length).toBeGreaterThan(0);

    // Open the first row's own menu — a real Radix `DropdownMenu`, not a mock.
    fireEvent.pointerDown(screen.getByRole('button', { name: `Employee actions for ${firstName}` }), { button: 0 });
    expect(screen.getByRole('menu')).toBeTruthy();

    // Scroll far enough that the first row's slot genuinely unmounts (well beyond virtualizer
    // overscan for 60 rows), then scroll back.
    fireEvent.scroll(grid, { target: { scrollTop: 4000 } });
    fireEvent.scroll(grid, { target: { scrollTop: 0 } });

    // The menu must not still be open — a stale-open Radix menu would otherwise survive the
    // unmount/remount and misleadingly appear attached to whichever employee recycled into that slot.
    expect(screen.queryByRole('menu')).toBeNull();

    // The recycled slot's own trigger still resolves to its own, correct employee.
    const trigger = screen.getByRole('button', { name: `Employee actions for ${firstName}` });
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(screen.getByRole('menuitem', { name: 'Edit Employee' })).toBeTruthy();
  });
});
