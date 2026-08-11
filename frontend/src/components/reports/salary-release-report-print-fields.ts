/**
 * Salary Release Report Checkpoint 1B — this report's own Print Options field vocabulary. A fresh
 * vocabulary, not a reuse of any sibling report's own `SummaryCardFieldId`/`TableColumnFieldId` —
 * this report's own totals/table are a different shape (release-reconciliation-centric, one row per
 * `PayrollEntry`).
 *
 * Print scope is "current page only" — never an unbounded fetch of the full filtered result;
 * `reports-salary-release-report-page.tsx`'s own print-only table draws from the exact same
 * already-loaded page the on-screen table shows. No Released By, no Payment Method, no bank/account
 * details, no CNIC, no correction reason, no audit actor is ever offered as a print field here — none
 * of these even exist on `SalaryReleaseReportRow` (frozen Checkpoint 1A contract), so this vocabulary
 * only ever covers the list's own approved safe row/summary fields.
 */

export type SummaryCardFieldId =
  | 'releasedAmount'
  | 'pendingReleaseAmount'
  | 'correctionBalancePayableTotal'
  | 'correctionBalanceRecoveryTotal'
  | 'matchingCount'
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
  | 'rowStatus'
  | 'originalReleasedAmount'
  | 'releasedAt'
  | 'correctionCount'
  | 'correctionBalancePayable'
  | 'correctionBalanceRecovery';

/** Employee Name is the one always-selected, non-removable column — the row's own human-readable
 * identity, mirroring every sibling report's identical treatment of its own primary column. */
export const LOCKED_COLUMN_FIELD_ID: TableColumnFieldId = 'employeeName';

interface FieldMeta<Id extends string> {
  id: Id;
  label: string;
}

/** Order matches the on-screen totals layout: Release Amounts, then Status. */
export const SUMMARY_CARD_FIELDS: readonly FieldMeta<SummaryCardFieldId>[] = [
  { id: 'releasedAmount', label: 'Released Amount' },
  { id: 'pendingReleaseAmount', label: 'Pending Release Amount' },
  { id: 'correctionBalancePayableTotal', label: 'Correction Balance Payable' },
  { id: 'correctionBalanceRecoveryTotal', label: 'Correction Balance Recovery' },
  { id: 'matchingCount', label: 'Matching Entries' },
  { id: 'releasedCount', label: 'Released' },
  { id: 'heldCount', label: 'Held' },
  { id: 'pendingCount', label: 'Pending' },
  { id: 'noPayDueCount', label: 'No Pay Due' },
  { id: 'recoveryDueCount', label: 'Recovery Due' },
  { id: 'correctedEntryCount', label: 'Corrected Entries' },
];

/** Order matches the on-screen table's own column order (Employee identity → org context → status
 * → release specifics → correction context). */
export const TABLE_COLUMN_FIELDS: readonly (FieldMeta<TableColumnFieldId> & { locked?: boolean })[] = [
  { id: 'employeeCode', label: 'Employee Code' },
  { id: 'employeeName', label: 'Employee Name', locked: true },
  { id: 'siteName', label: 'Project Site' },
  { id: 'primaryUnit', label: 'Primary Unit' },
  { id: 'designation', label: 'Designation' },
  { id: 'rowStatus', label: 'Row Status' },
  { id: 'originalReleasedAmount', label: 'Original Released Amount' },
  { id: 'releasedAt', label: 'Released At' },
  { id: 'correctionCount', label: 'Correction Count' },
  { id: 'correctionBalancePayable', label: 'Correction Balance Payable' },
  { id: 'correctionBalanceRecovery', label: 'Correction Balance Recovery' },
];

export interface SalaryReleaseReportPrintSelection {
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
export const FULL_SELECTION: SalaryReleaseReportPrintSelection = {
  cards: SUMMARY_CARD_FIELDS.map((f) => f.id),
  columns: TABLE_COLUMN_FIELDS.map((f) => f.id),
};

export const DEFAULT_PRINT_SELECTION: SalaryReleaseReportPrintSelection = FULL_SELECTION;

function sameIdSet<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

export function isFullSelection(selection: SalaryReleaseReportPrintSelection): boolean {
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

/** This report's own table tops out at 11 columns — identical ceiling to Overtime Report's own
 * table, so its identical thresholds are reused verbatim (Excellent 0–4 / Good 5–7 / Wide 8–9 /
 * Very Wide 10+). Informational guidance only, never blocking — the one exception remains
 * `hasNoMeaningfulColumns` below. */
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
export function hasNoMeaningfulColumns(selection: SalaryReleaseReportPrintSelection): boolean {
  return selection.columns.every((id) => id === LOCKED_COLUMN_FIELD_ID);
}

const STORAGE_KEY = 'salary-release-report-print-fields:v1';

function isKnownCardId(id: unknown): id is SummaryCardFieldId {
  return typeof id === 'string' && SUMMARY_CARD_FIELDS.some((f) => f.id === id);
}

function isKnownColumnId(id: unknown): id is TableColumnFieldId {
  return typeof id === 'string' && TABLE_COLUMN_FIELDS.some((f) => f.id === id);
}

/** Browser-local only, this report's own versioned key — never persisted to PostgreSQL. Read
 * defensively: an unrecognized id is silently dropped rather than ever crashing the dialog. */
export function loadStoredPrintSelection(): SalaryReleaseReportPrintSelection | null {
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

export function saveStoredPrintSelection(selection: SalaryReleaseReportPrintSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / private browsing — never block printing over a preference save failure.
  }
}
