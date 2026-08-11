/**
 * Advance Recovery Report Checkpoint 1B — this report's own Print Options field vocabulary. A fresh
 * vocabulary, not a reuse of any sibling report's own `SummaryCardFieldId`/`TableColumnFieldId` — this
 * report's own totals/table are a different shape (Advance-grain, LOAN/EID_ADVANCE split, an optional
 * Cycle recovery figure).
 *
 * Print scope is "current page only" — never an unbounded fetch of the full filtered result; the list
 * page's own print-only table draws from the exact same already-loaded page the on-screen table shows.
 * No CNIC, no banking, no audit-actor identity is ever offered as a print field here — this vocabulary
 * only ever covers the list's own safe row/summary fields.
 *
 * `recoveredThisCycleTotal`/`recoveredThisCycle` print as "Not selected" whenever no Cycle is
 * selected (never a fabricated 0.00) — the same current-vs-historical distinction the on-screen page
 * enforces (Step 7).
 */

export type SummaryCardFieldId =
  | 'matchingAdvanceCount'
  | 'employeesWithAdvanceCount'
  | 'loanOriginalAmount'
  | 'loanRecoveredToDate'
  | 'loanOutstandingBalance'
  | 'eidOriginalAmount'
  | 'eidRecoveredToDate'
  | 'eidOutstandingBalance'
  | 'activeCount'
  | 'reservedCount'
  | 'paidOffCount'
  | 'cancelledCount'
  | 'recoveredThisCycleTotal';

export type TableColumnFieldId =
  | 'employeeCode'
  | 'employeeName'
  | 'siteName'
  | 'advanceType'
  | 'originalAmount'
  | 'recoveredToDate'
  | 'currentOutstandingBalance'
  | 'status'
  | 'repaymentType'
  | 'dateGiven'
  | 'recoveredThisCycle';

/** Employee Name is the one always-selected, non-removable column — mirrors every sibling report's
 * identical treatment of its own primary column. */
export const LOCKED_COLUMN_FIELD_ID: TableColumnFieldId = 'employeeName';

interface FieldMeta<Id extends string> {
  id: Id;
  label: string;
}

/** Order matches the on-screen totals layout: Summary, then LOAN, then EID Advance, then Status,
 * then the optional Cycle recovery figure last. */
export const SUMMARY_CARD_FIELDS: readonly FieldMeta<SummaryCardFieldId>[] = [
  { id: 'matchingAdvanceCount', label: 'Matching Advances' },
  { id: 'employeesWithAdvanceCount', label: 'Employees With Advances' },
  { id: 'loanOriginalAmount', label: 'Advance — Original Amount' },
  { id: 'loanRecoveredToDate', label: 'Advance — Recovered To Date' },
  { id: 'loanOutstandingBalance', label: 'Advance — Current Outstanding Balance' },
  { id: 'eidOriginalAmount', label: 'Eid Advance — Original Amount' },
  { id: 'eidRecoveredToDate', label: 'Eid Advance — Recovered To Date' },
  { id: 'eidOutstandingBalance', label: 'Eid Advance — Current Outstanding Balance' },
  { id: 'activeCount', label: 'Active' },
  { id: 'reservedCount', label: 'Reserved' },
  { id: 'paidOffCount', label: 'Paid Off' },
  { id: 'cancelledCount', label: 'Cancelled' },
  { id: 'recoveredThisCycleTotal', label: 'Recovered This Cycle (Total)' },
];

/** Order matches the on-screen table's own column order (Step 6). */
export const TABLE_COLUMN_FIELDS: readonly (FieldMeta<TableColumnFieldId> & { locked?: boolean })[] = [
  { id: 'employeeCode', label: 'Employee Code' },
  { id: 'employeeName', label: 'Employee Name', locked: true },
  { id: 'siteName', label: 'Current Site' },
  { id: 'advanceType', label: 'Advance Type' },
  { id: 'originalAmount', label: 'Original Amount' },
  { id: 'recoveredToDate', label: 'Recovered To Date' },
  { id: 'currentOutstandingBalance', label: 'Current Outstanding Balance' },
  { id: 'status', label: 'Status' },
  { id: 'repaymentType', label: 'Repayment Type' },
  { id: 'dateGiven', label: 'Date Given' },
  { id: 'recoveredThisCycle', label: 'Recovered This Cycle' },
];

export interface AdvanceRecoveryReportPrintSelection {
  cards: SummaryCardFieldId[];
  /** Always includes `employeeName` — callers never need to special-case adding it back in. */
  columns: TableColumnFieldId[];
}

/**
 * Default print selection includes every safe report column/card — the application must never
 * silently hide report data (matching every sibling report's identical "Full Report" default). A
 * narrower printout is something a user explicitly opts into by unchecking fields, never the
 * unexplained starting point.
 */
export const FULL_SELECTION: AdvanceRecoveryReportPrintSelection = {
  cards: SUMMARY_CARD_FIELDS.map((f) => f.id),
  columns: TABLE_COLUMN_FIELDS.map((f) => f.id),
};

export const DEFAULT_PRINT_SELECTION: AdvanceRecoveryReportPrintSelection = FULL_SELECTION;

function sameIdSet<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

export function isFullSelection(selection: AdvanceRecoveryReportPrintSelection): boolean {
  return sameIdSet(selection.cards, FULL_SELECTION.cards) && sameIdSet(selection.columns, FULL_SELECTION.columns);
}

export type ReadabilityStatus = 'excellent' | 'good' | 'wide' | 'very-wide';

export interface ReadabilityLevel {
  status: ReadabilityStatus;
  label: string;
  /** Inclusive column-count floor this level applies from (counts the locked Employee Name column
   * too, matching what the dialog's own column count already shows the user). */
  minColumns: number;
  explanation: string;
  tone: 'green' | 'blue' | 'amber' | 'red';
}

/** This report's own table tops out at 11 columns — scaled proportionally from Deduction Report's own
 * 14-column-scaled thresholds. Informational guidance only, never blocking — the one exception
 * remains `hasNoMeaningfulColumns` below. */
export const READABILITY_LEVELS: readonly ReadabilityLevel[] = [
  {
    status: 'very-wide',
    label: 'Very Wide',
    minColumns: 10,
    explanation: 'This layout is likely to reduce readability. Consider removing a few columns.',
    tone: 'red',
  },
  {
    status: 'wide',
    label: 'Wide',
    minColumns: 7,
    explanation: 'Some columns may become compressed.',
    tone: 'amber',
  },
  {
    status: 'good',
    label: 'Good',
    minColumns: 4,
    explanation: 'Suitable for most A4 landscape prints.',
    tone: 'blue',
  },
  {
    status: 'excellent',
    label: 'Excellent',
    minColumns: 0,
    explanation: 'This layout should print clearly.',
    tone: 'green',
  },
];

export function getReadabilityLevel(columnCount: number): ReadabilityLevel {
  return READABILITY_LEVELS.find((level) => columnCount >= level.minColumns)!;
}

/** The one thing this dialog actually blocks — printing nothing but the locked Employee Name
 * column, with no figure at all (mirrors every sibling report's identical `hasNoMeaningfulColumns`). */
export function hasNoMeaningfulColumns(selection: AdvanceRecoveryReportPrintSelection): boolean {
  return selection.columns.every((id) => id === LOCKED_COLUMN_FIELD_ID);
}

const STORAGE_KEY = 'advance-recovery-report-print-fields:v1';

function isKnownCardId(id: unknown): id is SummaryCardFieldId {
  return typeof id === 'string' && SUMMARY_CARD_FIELDS.some((f) => f.id === id);
}

function isKnownColumnId(id: unknown): id is TableColumnFieldId {
  return typeof id === 'string' && TABLE_COLUMN_FIELDS.some((f) => f.id === id);
}

/** Browser-local only, this report's own versioned key — never persisted to PostgreSQL. Read
 * defensively: an unrecognized id is silently dropped rather than ever crashing the dialog. */
export function loadStoredPrintSelection(): AdvanceRecoveryReportPrintSelection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as { cards?: unknown; columns?: unknown };
    if (!Array.isArray(candidate.cards) || !Array.isArray(candidate.columns)) return null;

    const cards = candidate.cards.filter(isKnownCardId);
    const columns = candidate.columns.filter(isKnownColumnId);
    if (!columns.includes(LOCKED_COLUMN_FIELD_ID)) columns.unshift(LOCKED_COLUMN_FIELD_ID);
    return { cards, columns };
  } catch {
    return null;
  }
}

export function saveStoredPrintSelection(selection: AdvanceRecoveryReportPrintSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / private browsing — never block printing over a preference save failure.
  }
}
