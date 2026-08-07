/**
 * Deduction Report Checkpoint 1B — this report's own Print Options field vocabulary. A fresh
 * vocabulary, not a reuse of any sibling report's own `SummaryCardFieldId`/`TableColumnFieldId` —
 * this report's own totals/table are a different shape (deduction-type-centric, not per-site
 * aggregates or a per-employee cross-cycle history).
 *
 * Print scope is "current page only" — never an unbounded fetch of the full filtered result;
 * `reports-deduction-report-page.tsx`'s own print-only table draws from the exact same already-
 * loaded page the on-screen table shows. No CNIC, no banking, no release actor, no audit data is
 * ever offered as a print field here — this vocabulary only ever covers the list's own safe
 * row/summary fields.
 */

export type SummaryCardFieldId =
  | 'eobiTotal'
  | 'advanceDeductionTotal'
  | 'eidAdvanceDeductionTotal'
  | 'fineTotal'
  | 'correctionRecoveryTotal'
  | 'totalDeductions'
  | 'matchingCount'
  | 'employeesWithAnyDeduction'
  | 'releasedCount'
  | 'heldCount'
  | 'pendingCount'
  | 'noPayDueCount'
  | 'recoveryDueCount'
  | 'correctedEntryCount';

export type TableColumnFieldId =
  | 'employeeCode'
  | 'employeeName'
  | 'siteName'
  | 'primaryUnit'
  | 'designation'
  | 'eobi'
  | 'advanceDeduction'
  | 'eidAdvanceDeduction'
  | 'fine'
  | 'correctionBalanceRecovery'
  | 'totalDeductions'
  | 'correctionCount'
  | 'rowStatus'
  | 'releasedAt';

/** Employee Name is the one always-selected, non-removable column — the row's own human-readable
 * identity, mirroring every sibling report's identical treatment of its own primary column. */
export const LOCKED_COLUMN_FIELD_ID: TableColumnFieldId = 'employeeName';

interface FieldMeta<Id extends string> {
  id: Id;
  label: string;
}

/** Order matches Step 6's own two-group totals layout: Payroll Deductions, then Status. */
export const SUMMARY_CARD_FIELDS: readonly FieldMeta<SummaryCardFieldId>[] = [
  { id: 'eobiTotal', label: 'EOBI' },
  { id: 'advanceDeductionTotal', label: 'Advance Deduction' },
  { id: 'eidAdvanceDeductionTotal', label: 'EID Advance Deduction' },
  { id: 'fineTotal', label: 'Fine' },
  { id: 'correctionRecoveryTotal', label: 'Correction Recovery' },
  { id: 'totalDeductions', label: 'Total Deductions' },
  { id: 'matchingCount', label: 'Matching Entries' },
  { id: 'employeesWithAnyDeduction', label: 'Employees With Any Deduction' },
  { id: 'releasedCount', label: 'Released' },
  { id: 'heldCount', label: 'Held' },
  { id: 'pendingCount', label: 'Pending' },
  { id: 'noPayDueCount', label: 'No Pay Due' },
  { id: 'recoveryDueCount', label: 'Recovery Due' },
  { id: 'correctedEntryCount', label: 'Corrected Entries' },
];

/** Order matches the on-screen table's own column order (Step 7). */
export const TABLE_COLUMN_FIELDS: readonly (FieldMeta<TableColumnFieldId> & { locked?: boolean })[] = [
  { id: 'employeeCode', label: 'Employee Code' },
  { id: 'employeeName', label: 'Employee Name', locked: true },
  { id: 'siteName', label: 'Project Site' },
  { id: 'primaryUnit', label: 'Primary Unit' },
  { id: 'designation', label: 'Designation' },
  { id: 'eobi', label: 'EOBI' },
  { id: 'advanceDeduction', label: 'Advance Deduction' },
  { id: 'eidAdvanceDeduction', label: 'EID Advance Deduction' },
  { id: 'fine', label: 'Fine' },
  { id: 'correctionBalanceRecovery', label: 'Correction Balance Recovery' },
  { id: 'totalDeductions', label: 'Total Deductions' },
  { id: 'correctionCount', label: 'Correction Count' },
  { id: 'rowStatus', label: 'Row Status' },
  { id: 'releasedAt', label: 'Released Date' },
];

export interface DeductionReportPrintSelection {
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
export const FULL_SELECTION: DeductionReportPrintSelection = {
  cards: SUMMARY_CARD_FIELDS.map((f) => f.id),
  columns: TABLE_COLUMN_FIELDS.map((f) => f.id),
};

export const DEFAULT_PRINT_SELECTION: DeductionReportPrintSelection = FULL_SELECTION;

function sameIdSet<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

export function isFullSelection(selection: DeductionReportPrintSelection): boolean {
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

/** This report's own table tops out at 14 columns — scaled proportionally from Employee Payroll
 * History's own 13-column-scaled thresholds (Excellent 0–4 / Good 5–7 / Wide 8–10 / Very Wide 11+),
 * nudging the Very Wide floor up by one column to account for the one extra column here.
 * Informational guidance only, never blocking — the one exception remains
 * `hasNoMeaningfulColumns` below. */
export const READABILITY_LEVELS: readonly ReadabilityLevel[] = [
  {
    status: 'very-wide',
    label: 'Very Wide',
    minColumns: 12,
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
 * column, with no figure at all (mirrors every sibling report's identical `hasNoMeaningfulColumns`). */
export function hasNoMeaningfulColumns(selection: DeductionReportPrintSelection): boolean {
  return selection.columns.every((id) => id === LOCKED_COLUMN_FIELD_ID);
}

const STORAGE_KEY = 'deduction-report-print-fields:v1';

function isKnownCardId(id: unknown): id is SummaryCardFieldId {
  return typeof id === 'string' && SUMMARY_CARD_FIELDS.some((f) => f.id === id);
}

function isKnownColumnId(id: unknown): id is TableColumnFieldId {
  return typeof id === 'string' && TABLE_COLUMN_FIELDS.some((f) => f.id === id);
}

/** Browser-local only, this report's own versioned key — never persisted to PostgreSQL. Read
 * defensively: an unrecognized id is silently dropped rather than ever crashing the dialog. */
export function loadStoredPrintSelection(): DeductionReportPrintSelection | null {
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

export function saveStoredPrintSelection(selection: DeductionReportPrintSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / private browsing — never block printing over a preference save failure.
  }
}
