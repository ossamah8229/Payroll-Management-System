/**
 * Project Site Payroll Report Checkpoint 1B — this report's own Print Options field vocabulary.
 * A fresh vocabulary, not a reuse of Payroll Summary's or Employee Payroll History's own
 * `SummaryCardFieldId`/`TableColumnFieldId` (Step 10: "Use a fresh report-specific print field
 * vocabulary and localStorage key. Do not reuse Payroll Summary or Employee Payroll History field
 * IDs directly") — this report's own totals/table are a different shape from both (row-level
 * `PayrollEntry` figures for one cycle, not per-site aggregates or cross-cycle history).
 *
 * Print scope is "current page only" (Step 10) — never an unbounded fetch of the full filtered
 * result; `reports-project-site-payroll-page.tsx`'s own print-only table draws from the exact same
 * already-loaded page the on-screen table shows. No CNIC, no banking, no release actor, no audit
 * data is ever offered as a print field here — this vocabulary only ever covers the list's own safe
 * row/summary fields.
 */

export type SummaryCardFieldId =
  | 'matchingCount'
  | 'grossPay'
  | 'allowance'
  | 'eobiDeduction'
  | 'advanceDeduction'
  | 'eidAdvanceDeduction'
  | 'fine'
  | 'correctionBalancePayable'
  | 'correctionBalanceRecovery'
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
  | 'employeeCode'
  | 'employeeName'
  | 'siteName'
  | 'primaryUnit'
  | 'designation'
  | 'grossPay'
  | 'allowance'
  | 'eobiDeduction'
  | 'advanceDeduction'
  | 'eidAdvanceDeduction'
  | 'fine'
  | 'correctionBalancePayable'
  | 'correctionBalanceRecovery'
  | 'totalEarnings'
  | 'totalDeductions'
  | 'netSalary'
  | 'rowStatus'
  | 'correctionCount'
  | 'releasedAt';

/** Employee Name is the one always-selected, non-removable column — the row's own human-readable
 * identity, mirroring both sibling reports' identical treatment of their own primary column. */
export const LOCKED_COLUMN_FIELD_ID: TableColumnFieldId = 'employeeName';

interface FieldMeta<Id extends string> {
  id: Id;
  label: string;
}

/** Order matches Step 5's own totals-card list. */
export const SUMMARY_CARD_FIELDS: readonly FieldMeta<SummaryCardFieldId>[] = [
  { id: 'matchingCount', label: 'Matching Entries' },
  { id: 'grossPay', label: 'Gross Pay' },
  { id: 'allowance', label: 'Allowance' },
  { id: 'eobiDeduction', label: 'EOBI' },
  { id: 'advanceDeduction', label: 'Advance Deduction' },
  { id: 'eidAdvanceDeduction', label: 'EID Advance Deduction' },
  { id: 'fine', label: 'Fine' },
  { id: 'correctionBalancePayable', label: 'Correction Balance Payable' },
  { id: 'correctionBalanceRecovery', label: 'Correction Balance Recovery' },
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

/** Order matches the on-screen table's own column order (Step 6). */
export const TABLE_COLUMN_FIELDS: readonly (FieldMeta<TableColumnFieldId> & { locked?: boolean })[] = [
  { id: 'employeeCode', label: 'Employee Code' },
  { id: 'employeeName', label: 'Employee Name', locked: true },
  { id: 'siteName', label: 'Project Site' },
  { id: 'primaryUnit', label: 'Primary Unit' },
  { id: 'designation', label: 'Designation' },
  { id: 'grossPay', label: 'Gross Pay' },
  { id: 'allowance', label: 'Allowance' },
  { id: 'eobiDeduction', label: 'EOBI' },
  { id: 'advanceDeduction', label: 'Advance Deduction' },
  { id: 'eidAdvanceDeduction', label: 'EID Advance Deduction' },
  { id: 'fine', label: 'Fine' },
  { id: 'correctionBalancePayable', label: 'Correction Balance Payable' },
  { id: 'correctionBalanceRecovery', label: 'Correction Balance Recovery' },
  { id: 'totalEarnings', label: 'Total Earnings' },
  { id: 'totalDeductions', label: 'Total Deductions' },
  { id: 'netSalary', label: 'Net Salary' },
  { id: 'rowStatus', label: 'Row Status' },
  { id: 'correctionCount', label: 'Corrections' },
  { id: 'releasedAt', label: 'Released Date' },
];

export interface ProjectSitePayrollPrintSelection {
  cards: SummaryCardFieldId[];
  /** Always includes `employeeName` — callers never need to special-case adding it back in. */
  columns: TableColumnFieldId[];
}

/**
 * Default print selection includes every safe report column/card — the application must never
 * silently hide report data (matching both sibling reports' identical "Full Report" default). A
 * narrower printout is something a user explicitly opts into by unchecking fields, never the
 * unexplained starting point.
 */
export const FULL_SELECTION: ProjectSitePayrollPrintSelection = {
  cards: SUMMARY_CARD_FIELDS.map((f) => f.id),
  columns: TABLE_COLUMN_FIELDS.map((f) => f.id),
};

export const DEFAULT_PRINT_SELECTION: ProjectSitePayrollPrintSelection = FULL_SELECTION;

function sameIdSet<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

export function isFullSelection(selection: ProjectSitePayrollPrintSelection): boolean {
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

/** This report's own table tops out at 19 columns, the same maximum Payroll Summary's own table
 * has — so this reuses Payroll Summary's own threshold scale (Excellent ≤8 / Good 9–11 / Wide
 * 12–15 / Very Wide 16+) rather than Employee Payroll History's smaller, 13-column-scaled one.
 * Informational guidance only, never blocking — the one exception remains
 * `hasNoMeaningfulColumns` below. */
export const READABILITY_LEVELS: readonly ReadabilityLevel[] = [
  {
    status: 'very-wide',
    label: 'Very Wide',
    minColumns: 16,
    explanation: 'This layout is likely to reduce readability. Consider removing a few columns.',
    tone: 'red',
  },
  {
    status: 'wide',
    label: 'Wide',
    minColumns: 12,
    explanation: 'Some columns may become compressed.',
    tone: 'amber',
  },
  {
    status: 'good',
    label: 'Good',
    minColumns: 9,
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
 * column, with no figure at all (mirrors both sibling reports' identical `hasNoMeaningfulColumns`). */
export function hasNoMeaningfulColumns(selection: ProjectSitePayrollPrintSelection): boolean {
  return selection.columns.every((id) => id === LOCKED_COLUMN_FIELD_ID);
}

const STORAGE_KEY = 'project-site-payroll-print-fields:v1';

function isKnownCardId(id: unknown): id is SummaryCardFieldId {
  return typeof id === 'string' && SUMMARY_CARD_FIELDS.some((f) => f.id === id);
}

function isKnownColumnId(id: unknown): id is TableColumnFieldId {
  return typeof id === 'string' && TABLE_COLUMN_FIELDS.some((f) => f.id === id);
}

/** Browser-local only, this report's own versioned key — never persisted to PostgreSQL (Step 10).
 * Read defensively: an unrecognized id is silently dropped rather than ever crashing the dialog. */
export function loadStoredPrintSelection(): ProjectSitePayrollPrintSelection | null {
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

export function saveStoredPrintSelection(selection: ProjectSitePayrollPrintSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / private browsing — never block printing over a preference save failure.
  }
}
