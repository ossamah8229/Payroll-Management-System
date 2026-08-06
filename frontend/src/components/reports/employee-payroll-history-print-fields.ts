/**
 * Employee Payroll History Checkpoint 1B — this report's own Print Options field vocabulary.
 * Deliberately a fresh vocabulary, not a reuse of Payroll Summary's `SummaryCardFieldId`/
 * `TableColumnFieldId` (Checkpoint brief: "create a report-specific field configuration... do not
 * reuse Payroll Summary's field vocabulary directly") — this report's own summary totals and table
 * columns are a different shape (per-entry rows vs. per-site aggregates), so a shared id type would
 * only paper over that difference.
 *
 * Print scope is Version 1 (Checkpoint brief): the current paginated page only, never an unbounded
 * fetch — see `reports-employee-payroll-history-page.tsx`'s own print-only table, which draws from
 * the exact same already-loaded page the on-screen table shows. No CNIC, no banking, no release
 * actor, no drill-down section is ever offered as a print field here — this vocabulary only ever
 * covers the list's own safe row/summary fields.
 */

export type SummaryCardFieldId =
  | 'matchingCount'
  | 'totalEarnings'
  | 'totalDeductions'
  | 'netSalaryTotal'
  | 'releasedCount'
  | 'heldCount'
  | 'noPayDueCount'
  | 'recoveryDueCount'
  | 'pendingCount'
  | 'correctedEntryCount';

export type TableColumnFieldId =
  | 'cycle'
  | 'employeeCode'
  | 'employeeName'
  | 'siteName'
  | 'primaryUnit'
  | 'designation'
  | 'totalEarnings'
  | 'totalDeductions'
  | 'netSalary'
  | 'rowStatus'
  | 'correctionCount'
  | 'outstandingOriginBalance'
  | 'releasedAt';

/** Employee Name is the one always-selected, non-removable column — the row's own human-readable
 * identity, mirroring Payroll Summary's identical treatment of its own primary grouping column
 * (`siteName`). */
export const LOCKED_COLUMN_FIELD_ID: TableColumnFieldId = 'employeeName';

interface FieldMeta<Id extends string> {
  id: Id;
  label: string;
}

/** Order matches Step 6's own summary-card list. */
export const SUMMARY_CARD_FIELDS: readonly FieldMeta<SummaryCardFieldId>[] = [
  { id: 'matchingCount', label: 'Matching Entries' },
  { id: 'totalEarnings', label: 'Total Earnings' },
  { id: 'totalDeductions', label: 'Total Deductions' },
  { id: 'netSalaryTotal', label: 'Net Salary' },
  { id: 'releasedCount', label: 'Released' },
  { id: 'heldCount', label: 'Held' },
  { id: 'noPayDueCount', label: 'No Pay Due' },
  { id: 'recoveryDueCount', label: 'Recovery Due' },
  { id: 'pendingCount', label: 'Pending' },
  { id: 'correctedEntryCount', label: 'Corrected Entries' },
];

/** Order matches the on-screen table's own column order (minus the interactive "Actions" column,
 * which is never printable). */
export const TABLE_COLUMN_FIELDS: readonly (FieldMeta<TableColumnFieldId> & { locked?: boolean })[] = [
  { id: 'cycle', label: 'Payroll Month' },
  { id: 'employeeCode', label: 'Employee Code' },
  { id: 'employeeName', label: 'Employee Name', locked: true },
  { id: 'siteName', label: 'Project Site' },
  { id: 'primaryUnit', label: 'Primary Unit' },
  { id: 'designation', label: 'Designation' },
  { id: 'totalEarnings', label: 'Total Earnings' },
  { id: 'totalDeductions', label: 'Total Deductions' },
  { id: 'netSalary', label: 'Net Salary' },
  { id: 'rowStatus', label: 'Row Status' },
  { id: 'correctionCount', label: 'Corrections' },
  { id: 'outstandingOriginBalance', label: 'Outstanding Origin Balance' },
  { id: 'releasedAt', label: 'Released Date' },
];

export interface EmployeePayrollHistoryPrintSelection {
  cards: SummaryCardFieldId[];
  /** Always includes `employeeName` — callers never need to special-case adding it back in. */
  columns: TableColumnFieldId[];
}

/**
 * Default print selection includes every safe report column/card (Checkpoint brief: "Default
 * print selection should include all report columns that are safe and readable" — the application
 * must never silently hide report data, matching Payroll Summary's own "Final Print UX
 * Refinement"). A narrower printout is something a user explicitly opts into by unchecking fields,
 * never the unexplained starting point.
 */
export const FULL_SELECTION: EmployeePayrollHistoryPrintSelection = {
  cards: SUMMARY_CARD_FIELDS.map((f) => f.id),
  columns: TABLE_COLUMN_FIELDS.map((f) => f.id),
};

export const DEFAULT_PRINT_SELECTION: EmployeePayrollHistoryPrintSelection = FULL_SELECTION;

function sameIdSet<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

export function isFullSelection(selection: EmployeePayrollHistoryPrintSelection): boolean {
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

/** Thresholds scaled down from Payroll Summary's own 19-column table to this report's own smaller,
 * 13-column maximum — informational guidance only, never blocking (the one exception remains
 * `hasNoMeaningfulColumns` below). */
export const READABILITY_LEVELS: readonly ReadabilityLevel[] = [
  {
    status: 'very-wide',
    label: 'Very Wide',
    minColumns: 11,
    explanation: 'This layout is likely to reduce readability. Consider removing a few columns.',
    tone: 'red',
  },
  {
    status: 'wide',
    label: 'Wide',
    minColumns: 8,
    explanation: 'Some columns may become compressed.',
    tone: 'amber',
  },
  {
    status: 'good',
    label: 'Good',
    minColumns: 5,
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
 * column, with no figure at all (mirrors Payroll Summary's own `hasNoMeaningfulColumns`). */
export function hasNoMeaningfulColumns(selection: EmployeePayrollHistoryPrintSelection): boolean {
  return selection.columns.every((id) => id === LOCKED_COLUMN_FIELD_ID);
}

const STORAGE_KEY = 'employee-payroll-history-print-fields:v1';

function isKnownCardId(id: unknown): id is SummaryCardFieldId {
  return typeof id === 'string' && SUMMARY_CARD_FIELDS.some((f) => f.id === id);
}

function isKnownColumnId(id: unknown): id is TableColumnFieldId {
  return typeof id === 'string' && TABLE_COLUMN_FIELDS.some((f) => f.id === id);
}

/** Browser-local only, this report's own versioned key — never persisted to PostgreSQL (Step 11).
 * Read defensively: an unrecognized id is silently dropped rather than ever crashing the dialog. */
export function loadStoredPrintSelection(): EmployeePayrollHistoryPrintSelection | null {
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

export function saveStoredPrintSelection(selection: EmployeePayrollHistoryPrintSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / private browsing — never block printing over a preference save failure.
  }
}
