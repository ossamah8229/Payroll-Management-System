import { calcNet, formatMoney, formatNumber } from '@payroll/shared';
import { cn } from '@/lib/cn';
import type { Bank } from '@/hooks/use-banks';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { buildCalcInput, computeServerSnapshot } from './calc-input';
import { measureColumnWidth } from './measure-column-width';
import { LIVE_TOTAL_KEYS, type LiveTotals } from './live-totals-store';

export type ColumnAlign = 'left' | 'center' | 'right';

export interface PayrollColumnDef {
  id: string;
  label: string;
  align?: ColumnAlign;
  /** Groups columns under one shared header label (e.g. "Bank Details", "EOBI") — purely visual. */
  group?: string;
  /** A true fixed-width UI control (a toggle switch, the serial/save-status column, the Units pill
   * button) — not text-content-driven, so dynamic measurement doesn't apply; this is the control's
   * own intrinsic/decided size, the "unless a true fixed width is required by a control" exception
   * the permanent Layout Integrity Rule (2026-07-13) explicitly allows. Every other column is
   * measured dynamically from the full loaded dataset via `computeColumnWidths` below — never a
   * manually guessed pixel number for business-identifier or monetary content. */
  fixedWidth?: number;
  /** Minimum width floor for a dynamically-measured column — never narrower even when the loaded
   * dataset is empty or every current value happens to be short, so the header stays readable and
   * the grid doesn't visibly jump when the first long value appears later. */
  minWidth?: number;
}

export interface ResolvedPayrollColumnDef extends PayrollColumnDef {
  width: number;
}

/**
 * Every Payroll Entry column defined by the frozen architecture (docs/architecture/
 * database/payroll-entry.md §12/§12a) that this checkpoint's grid exposes. A single flat array
 * (rather than CSS table auto-layout) is what keeps the sticky header, virtualized body, and
 * sticky totals row's columns pixel-aligned with each other — all three render from the same
 * *resolved* array (`computeColumnWidths`, below), so there is exactly one place column widths are
 * decided, and it is content-driven, not a hardcoded guess (permanent Layout Integrity Rule,
 * corrected 2026-07-13 — a fixed-pixel guess is exactly the defect this correction removes).
 *
 * Declared `as const satisfies` (rather than a plain `PayrollColumnDef[]`) so `PayrollColumnId`
 * below is a literal union, not `string` — this is what lets `payroll-entry-row.tsx`'s per-column
 * cell map be checked for completeness at compile time (Presentation & Workflow Stabilization
 * Checkpoint, 2026-07-25): adding a column here without adding its cell renderer, or misspelling a
 * column id there, is a type error, not a runtime/visual drift only a test could catch.
 */
export const PAYROLL_COLUMNS = [
  // Fixed: a status icon + row number, not loaded text content.
  { id: 'serial', label: '#', align: 'center', fixedWidth: 60 },
  // Fixed: a Released badge (or the "—" unreleased placeholder), not loaded text content — placed
  // right after the serial column so a released row's locked status is visible without scrolling
  // right in an otherwise very wide grid. Narrowed from 150 to 90 (Presentation & Workflow
  // Stabilization Checkpoint, 2026-07-25) after the row-level Correction/History actions button
  // that used to share this cell was removed — the column only has to fit the "Released" badge
  // itself now, not badge + button + its hover target and icon.
  { id: 'status', label: 'Status', align: 'center', fixedWidth: 90 },
  { id: 'employeeCode', label: 'Code', minWidth: 70 },
  { id: 'employeeName', label: 'Employee', minWidth: 110 },
  { id: 'designation', label: 'Designation', minWidth: 100 },
  { id: 'site', label: 'Site', minWidth: 90 },
  // The deputed branch/site code (`ProjectUnit.code`) for this entry's primary work line —
  // labeled "Deputed Branch" (not "Branch Code") specifically to avoid colliding with the
  // `branchCode` column below, which is the employee's unrelated *bank* branch code (product
  // decision, Payroll Entry usability checkpoint, 2026-07-24). Never grouped under "Bank
  // Details"; placed beside the other employee/site identity columns instead.
  { id: 'unitCode', label: 'Deputed Branch', minWidth: 90 },
  // Bank Code only in this dense grid, per the approved Bank display rule (2026-07-13) — the full
  // Bank Name stays in Employee Registry's own dropdown, where users need it to pick the right one.
  { id: 'bankId', label: 'Bank', group: 'Bank Details', minWidth: 60 },
  { id: 'branchCode', label: 'Branch Code', group: 'Bank Details', minWidth: 80 },
  { id: 'accountNumber', label: 'Account No.', group: 'Bank Details', minWidth: 100 },
  { id: 'iban', label: 'IBAN', group: 'Bank Details', minWidth: 100 },
  { id: 'grossPay', label: 'Gross Pay', align: 'right', minWidth: 80 },
  // Fixed: a button showing "N {unitLabel}", not raw loaded text — its own intrinsic control size.
  { id: 'units', label: 'Units', align: 'center', fixedWidth: 100 },
  { id: 'days', label: 'Working Days', align: 'right', minWidth: 70 },
  { id: 'otHours', label: 'OT Hours', align: 'right', minWidth: 70 },
  { id: 'otRate', label: 'OT Rate', align: 'right', minWidth: 70 },
  { id: 'cycleDays', label: 'Cycle Days', align: 'right', minWidth: 70 },
  { id: 'leaveDays', label: 'Leave Days', align: 'right', minWidth: 70 },
  { id: 'leaveRate', label: 'Leave Rate', align: 'right', minWidth: 75 },
  { id: 'allowance', label: 'Allowance', align: 'right', minWidth: 80 },
  { id: 'eobiAmount', label: 'Amount', group: 'EOBI', align: 'right', minWidth: 70 },
  // Fixed: a toggle switch, not loaded text content.
  { id: 'eobiApplicable', label: 'Applicable', group: 'EOBI', align: 'center', fixedWidth: 80 },
  { id: 'advanceDeduction', label: 'Advance Ded.', align: 'right', minWidth: 90 },
  { id: 'eidAdvanceDeduction', label: 'Eid Advance Ded.', align: 'right', minWidth: 95 },
  { id: 'fine', label: 'Fine', align: 'right', minWidth: 70 },
  // Fixed: a toggle switch, not loaded text content.
  { id: 'hold', label: 'Hold', align: 'center', fixedWidth: 70 },
  { id: 'remarks', label: 'Remarks', minWidth: 120 },
  { id: 'netSalary', label: 'Net Salary', align: 'right', minWidth: 90 },
] as const satisfies PayrollColumnDef[];

/** The literal union of every column id — `Record<PayrollColumnId, ...>` (used by
 * `payroll-entry-row.tsx`'s per-column cell map) is what turns "every column has exactly one cell,
 * in canonical order" from a convention into a compile-time guarantee. */
export type PayrollColumnId = (typeof PAYROLL_COLUMNS)[number]['id'];

/** The row-level trailing `⋯` action control's own fixed width (Payroll Entry Row Actions UAT
 * correction, 2026-08-12) — **not** a `PAYROLL_COLUMNS` entry. UAT feedback on the original
 * implementation (a dedicated sticky-right `actions` column, see git history) was that the `⋯`
 * menu is a characteristic/action of the row itself, not a payroll data column: it must never
 * appear in column count/order, sorting, visibility, or totals-calculation logic, and must never be
 * sticky. `PayrollEntryRow` is the only layer that renders content into this space (as a trailing
 * flex sibling after its own data-cell grid, scrolling naturally with the row) — this constant
 * exists purely so `PayrollEntryGrid` can reserve the same trailing width across the header/
 * group-header/totals rows too, so their own right edge doesn't stop short of where a body row's
 * trailing control actually sits. Reuses the previous sticky column's own 44px — an icon-button
 * trigger, not loaded text content, so a fixed pixel size (not dynamic measurement) is correct here
 * exactly as it was before. */
export const ROW_ACTION_WIDTH = 44;

/** Frozen Employee Identity Pane (UAT 2026-08-12) — the minimum column set that unambiguously
 * identifies which employee a payroll row's editable values belong to, kept permanently visible on
 * the LEFT while this grid's ~26 columns scroll horizontally underneath (data-entry safety: a
 * payroll value must never be entered against a row whose employee identity has scrolled out of
 * view). `employeeName` alone was judged insufficient — two employees can share a name — so
 * `employeeCode` (Employee Registry's own unique business identifier, already this row's leftmost
 * identity column) is frozen alongside it. Deliberately excludes `serial`/`status` (before it) and
 * `designation`/`site`/... (after it): freezing more than the minimum needed to identify the
 * employee was explicitly out of scope for this checkpoint. Single source of truth reused by every
 * layer that renders these two columns — the group-header row, the column-header row, every
 * virtualized body row, and the totals row. */
export const FROZEN_LEFT_COLUMN_IDS: readonly PayrollColumnId[] = ['employeeCode', 'employeeName'];

/** The one sticky-left treatment (UAT 2026-08-12; layering correction, UAT 2026-08-12b) — takes the
 * cell's own real background (never a hardcoded guess) so header/body/totals rows each carry
 * through their own already-established background, and a conflict body row's `bg-danger-light`
 * carries through to its own sticky identity cells the same way it carries through to the row's
 * outer background (`payroll-entry-row.tsx`'s M4 fix). The trailing-edge divider (`border-r`) is
 * applied only to `FROZEN_LEFT_COLUMN_IDS`'s own last entry (`employeeName`) — the visual separator
 * belongs at the frozen pane's right edge, not between its own two adjacent columns.
 *
 * **`z-10` lives here, not at each call site** (root-cause correction, UAT 2026-08-12b — production
 * report: scrolling content, e.g. a sort arrow, painting over the frozen identity pane). `position:
 * sticky` alone does not guarantee paint order against sibling grid/flex items: this codebase's own
 * header/group-header/body/totals rows are all `display: grid` or `display: flex` containers, and
 * per the CSS Grid/Flexbox stacking rules, sibling items with equally-`auto` z-index are painted in
 * *document order* — every scrolling `PAYROLL_COLUMNS` entry sorts after `employeeCode`/
 * `employeeName` there, so without an explicit z-index the scrolling sibling always wins the tie
 * wherever its own rendered box happens to physically coincide with the frozen pane's fixed on-screen
 * position, confirmed via real-Chromium `elementFromPoint` hit-testing (e.g. the `unitCode` column's
 * own sort-chevron icon, scrolled to land under the frozen pane). A body row's cells previously
 * escaped this only because `payroll-entry-row.tsx` separately hardcoded its own `z-10` — the
 * group-header, column-header, and totals-row identity cells had no such override and were
 * genuinely exposed. Centralizing it here is what makes every layer's identity cell win the tie
 * unconditionally (10 > the scrolling siblings' implicit 0/`auto`), regardless of column order —
 * the smallest fix that removes the whole class of "some other column's content ends up here", not
 * just the one reported instance. */
export function stickyIdentityCellClassName(columnId: PayrollColumnId, backgroundClassName: string): string {
  const isTrailingEdge = FROZEN_LEFT_COLUMN_IDS[FROZEN_LEFT_COLUMN_IDS.length - 1] === columnId;
  return cn('sticky z-10', isTrailingEdge && 'border-r border-border', backgroundClassName);
}

/** Each frozen-left column's own pixel offset from the scroll container's left edge once stuck —
 * cumulative *only* across `FROZEN_LEFT_COLUMN_IDS` (their own combined widths), never across the
 * full column set: `serial`/`status` come before `employeeCode` in `PAYROLL_COLUMNS` but are not
 * part of the frozen pane, so they scroll away with the rest of the grid rather than contributing to
 * this offset. Derived from the same `resolvedColumns` array every other layer already shares —
 * never an independently-measured guess. */
export function stickyLeftOffsets(columns: ResolvedPayrollColumnDef[]): Partial<Record<PayrollColumnId, number>> {
  const offsets: Partial<Record<PayrollColumnId, number>> = {};
  let cumulative = 0;
  for (const column of columns) {
    const id = column.id as PayrollColumnId;
    if (!FROZEN_LEFT_COLUMN_IDS.includes(id)) continue;
    offsets[id] = cumulative;
    cumulative += column.width;
  }
  return offsets;
}

/** One column's rendered text for a given entry — must match exactly what `payroll-entry-row.tsx`
 * actually displays for that cell, or the measured width would silently drift from reality. Reads
 * each entry's own *stored* server values (never a live, not-yet-saved draft) — the grid resizing
 * mid-keystroke as someone types would be its own usability problem; `computeColumnWidths` is
 * re-run only when the loaded `entries` array itself changes (a fetch or a save), not per edit. */
function extractColumnValue(columnId: string, entry: PayrollEntry, bankCodeById: Map<string, string>): string {
  const primaryLine = entry.workLines[0];
  switch (columnId) {
    case 'employeeCode':
      return entry.employee.employeeCode ?? '';
    case 'employeeName':
      return entry.employee.name;
    case 'designation':
      return entry.designation;
    case 'site':
      return entry.site.name;
    case 'unitCode':
      return entry.workLines[0]?.unit.code ?? '';
    case 'bankId':
      return entry.bankId ? (bankCodeById.get(entry.bankId) ?? '') : 'Cash';
    case 'branchCode':
      return entry.branchCode ?? '';
    case 'accountNumber':
      return entry.accountNumber ?? '';
    case 'iban':
      return entry.iban ?? '';
    case 'grossPay':
      return entry.grossPay;
    case 'days':
      return primaryLine?.days ?? '';
    case 'otHours':
      return primaryLine?.otHours ?? '';
    case 'otRate':
      return primaryLine?.otRate ?? 'auto';
    case 'cycleDays':
      return primaryLine ? String(primaryLine.cycleDays) : '';
    case 'leaveDays':
      return entry.leaveDays;
    case 'leaveRate':
      return entry.leaveRate ?? 'auto';
    case 'allowance':
      return entry.allowance;
    case 'eobiAmount':
      return entry.eobiAmount;
    case 'advanceDeduction':
      return entry.advanceDeduction;
    case 'eidAdvanceDeduction':
      return entry.eidAdvanceDeduction;
    case 'fine':
      return entry.fine;
    case 'remarks':
      return entry.remarks ?? '';
    case 'netSalary':
      // The one read-only, formatted (not raw-decimal) cell — matches ReadOnlyCell's own
      // `formatMoney(calc.netSalary)` exactly (payroll-entry-row.tsx), including the "PKR " prefix.
      return formatMoney(calcNet(buildCalcInput(entry)).netSalary);
    default:
      return '';
  }
}

/** Column ids that stack a secondary "Bal: PKR X" balance label beneath their primary input
 * (`BalanceLabel` in `inline-cells.tsx`) — the balance line's own text must factor into the
 * column's measured width too, or it overflows the cell exactly the way a too-narrow
 * `advanceDeduction` column did before this checkpoint. Single source of truth for which columns
 * carry a balance label, reused by both `extractBalanceLabelValue` below and the row renderer. */
export const BALANCE_LABEL_COLUMN_IDS = new Set<PayrollColumnId>(['advanceDeduction', 'eidAdvanceDeduction']);

function extractBalanceLabelValue(columnId: string, entry: PayrollEntry): string {
  const advance = columnId === 'advanceDeduction' ? entry.advance : columnId === 'eidAdvanceDeduction' ? entry.eidAdvance : null;
  return advance ? `Bal: ${formatMoney(advance.outstandingBalance)}` : '';
}

/** Column ids the sticky totals row (`PayrollEntryTotalsRow`) sums and displays — the single
 * source of truth reused by both that component (which formats/renders it) and
 * `computeColumnWidths` below (which must know a total's *rendered text* to size the column
 * correctly). Re-exported from `live-totals-store.ts`'s own canonical list rather than redefined. */
export const NUMERIC_TOTAL_COLUMN_IDS = new Set<PayrollColumnId>(LIVE_TOTAL_KEYS as PayrollColumnId[]);

/** Which totals-row columns render with the "PKR " money format vs. a plain number (docs/design-system.md
 * §4 — only genuine payment amounts get the prefix). Single source of truth, reused by
 * `PayrollEntryTotalsRow` for both its displayed text and its styling, and by `computeColumnWidths`
 * below so the *measured* width matches the *rendered* format exactly. */
export const MONEY_TOTAL_COLUMN_IDS = new Set<PayrollColumnId>([
  'grossPay',
  'allowance',
  'eobiAmount',
  'advanceDeduction',
  'eidAdvanceDeduction',
  'fine',
  'netSalary',
]);

/**
 * Sums every numeric total column across the *full* loaded `entries` array, purely from
 * server-cache truth (`computeServerSnapshot` — never a live, not-yet-saved draft), mirroring
 * exactly what `LiveTotalsStore.getTotals()` produces once seeded via `setBase`. Used only to
 * measure how wide the footer's summed totals will render (below) — the totals row itself still
 * gets its live, editing-aware figures from the store, not from this function.
 */
function computeStaticFooterTotals(entries: PayrollEntry[]): LiveTotals {
  const totals = {} as LiveTotals;
  for (const key of LIVE_TOTAL_KEYS) totals[key] = 0;
  for (const entry of entries) {
    const snapshot = computeServerSnapshot(entry);
    for (const key of LIVE_TOTAL_KEYS) {
      const value = snapshot[key];
      if (value !== null) totals[key] += value;
    }
  }
  return totals;
}

/** The totals row's own rendered text for one column, given the full dataset's summed totals — must
 * match `PayrollEntryTotalsRow`'s `cellContent` exactly, or the measured width would silently drift
 * from what's actually displayed (the same discipline `extractColumnValue`/`extractBalanceLabelValue`
 * already follow for body-row content). Returns `null` for a column with no footer content at all. */
function extractFooterValue(columnId: PayrollColumnId, footerTotals: LiveTotals, rowCount: number): string | null {
  if (columnId === 'employeeName') {
    return `${rowCount} ${rowCount === 1 ? 'employee' : 'employees'}`;
  }
  if (NUMERIC_TOTAL_COLUMN_IDS.has(columnId)) {
    const value = footerTotals[columnId as keyof LiveTotals];
    return MONEY_TOTAL_COLUMN_IDS.has(columnId) ? formatMoney(value) : formatNumber(value);
  }
  return null;
}

/**
 * Resolves every column's real width from the full loaded `entries` array — not just whichever
 * rows the virtualizer currently has mounted (Layout Integrity Rule, corrected 2026-07-13: "the
 * sizing calculation must inspect the full loaded Payroll Entry dataset"). Returns one array,
 * reused as-is by the grouped header, the column header, every virtualized body row, and the
 * totals row (`gridTemplateColumns`/`totalGridWidth` below) — a single shared calculation, never
 * four independent ones that could drift out of alignment.
 *
 * **Also measures the sticky totals row's own summed content** (2026-07-30 fix — production UAT
 * reported overlapping totals): a summed total (e.g. "1,502 employees", or a Gross Pay sum across
 * hundreds of rows) is very often wider than any single row's own value, since column widths used
 * to be measured from individual row values only. The totals row deliberately never truncates a
 * financial figure (`overflow-visible whitespace-nowrap`, `payroll-entry-totals-row.tsx`), so a
 * too-narrow column meant the total visibly overlapped the next column instead. Feeding the footer's
 * own rendered text into this same measurement pass — the same trick `BALANCE_LABEL_COLUMN_IDS`
 * already uses for the Advance/Eid Advance balance sub-text — makes every column structurally wide
 * enough for its own total, without a font-size reduction or any special-cased footer layout.
 */
export function computeColumnWidths(entries: PayrollEntry[], banks: Bank[]): ResolvedPayrollColumnDef[] {
  const bankCodeById = new Map(banks.map((b) => [b.id, b.code]));
  const footerTotals = computeStaticFooterTotals(entries);
  // Annotated as the wider `PayrollColumnDef` (rather than letting TS infer `PAYROLL_COLUMNS`'s own
  // narrow per-element literal union) — `fixedWidth`/`minWidth` are optional on that interface, so
  // every column can be handled by one shared branch below regardless of which literal member of
  // the `as const` union it actually is.
  return PAYROLL_COLUMNS.map((column: PayrollColumnDef) => {
    if (column.fixedWidth !== undefined) {
      return { ...column, width: column.fixedWidth };
    }
    const values = entries.map((entry) => extractColumnValue(column.id, entry, bankCodeById));
    // The balance label renders at a smaller font (10px) than the primary value it sits under
    // (12px, `measureColumnWidth`'s own "body" weights) — measuring it with the larger body
    // weights is a deliberate, safe overestimate rather than a second, unverified font-size
    // constant table, and guarantees the column is never narrower than the label needs.
    if (BALANCE_LABEL_COLUMN_IDS.has(column.id as PayrollColumnId)) {
      values.push(...entries.map((entry) => extractBalanceLabelValue(column.id, entry)));
    }
    const footerValue = extractFooterValue(column.id as PayrollColumnId, footerTotals, entries.length);
    if (footerValue !== null) values.push(footerValue);
    const width = measureColumnWidth({ header: column.label, values, minimumPx: column.minWidth });
    return { ...column, width };
  });
}

export function gridTemplateColumns(columns: ResolvedPayrollColumnDef[]): string {
  return columns.map((column) => `${column.width}px`).join(' ');
}

export function totalGridWidth(columns: ResolvedPayrollColumnDef[]): number {
  return columns.reduce((sum, column) => sum + column.width, 0);
}

/** Column ids that are plain text/number editable inputs and therefore participate in Arrow-key
 * grid navigation (`data-col` index). Toggle/select cells are included too — navigation just needs
 * to reach and focus them, not necessarily type into them the same way.
 *
 * `designation`/`bankId`/`branchCode`/`accountNumber`/`iban` removed (Master Data Boundary, Phase
 * 7D, 2026-07-30); `grossPay` removed the same way (Phase 7F, 2026-08-04) — now plain
 * `ReadOnlyCell`s (Employee Registry's data, display-only here), with no focusable input to
 * navigate to. */
export const NAVIGABLE_COLUMN_IDS = PAYROLL_COLUMNS.filter((c) =>
  ['days', 'otHours', 'otRate', 'cycleDays', 'leaveDays', 'leaveRate', 'allowance', 'eobiAmount', 'eobiApplicable', 'advanceDeduction', 'eidAdvanceDeduction', 'fine', 'hold', 'remarks'].includes(
    c.id,
  ),
).map((c) => c.id);
