import type { PayrollSummaryFigures } from '@/hooks/use-reports';

/**
 * Post-deployment Print Usability Refinement — the stable field-identifier vocabulary for
 * Payroll Summary's Print Options dialog. Every id here is a real `PayrollSummaryFigures` key (the
 * DTO the on-screen report and both exports already share), never a display label — selection state,
 * presets, and localStorage all key off these ids so a future label wording change never breaks a
 * user's saved preference or a preset definition. `advancesIncludingEid` is the one summary-card-only
 * exception: it mirrors the on-screen `StatFigure` that already combines `advanceDeductions` +
 * `eidAdvanceDeductions` into one card — not a new figure, just this dialog's own name for that
 * existing combination.
 *
 * This module defines presentation selection only. No value is computed here — every figure a
 * selected field renders comes directly from the already-loaded `PayrollSummaryReport` the on-screen
 * page and CSV/XLSX exports already use (`reports-payroll-summary-page.tsx`'s own `report.data`).
 */

export type SummaryCardFieldId =
  | 'employeeCount'
  | 'grossPay'
  | 'netSalary'
  | 'releasedAmount'
  | 'pendingReleaseAmount'
  | 'eobi'
  | 'advancesIncludingEid'
  | 'fines';

/** `siteName` is the one always-selected, non-removable table column (`PayrollSummarySiteRow.siteName`
 * — a string, never a monetary/count figure, so it's kept out of `PayrollSummaryFigures`-keyed
 * formatting below and rendered specially wherever a table column is drawn). */
export type TableColumnFieldId = keyof PayrollSummaryFigures | 'siteName';

export const LOCKED_COLUMN_FIELD_ID: TableColumnFieldId = 'siteName';

interface FieldMeta<Id extends string> {
  id: Id;
  label: string;
}

/** Order matches the existing on-screen `StatFigure` row (`reports-payroll-summary-page.tsx`) —
 * the print dialog's own card list should read the same way a user already knows it. */
export const SUMMARY_CARD_FIELDS: readonly FieldMeta<SummaryCardFieldId>[] = [
  { id: 'employeeCount', label: 'Employees' },
  { id: 'grossPay', label: 'Gross Pay' },
  { id: 'netSalary', label: 'Net Salary' },
  { id: 'releasedAmount', label: 'Released Amount' },
  { id: 'pendingReleaseAmount', label: 'Pending Release Amount' },
  { id: 'eobi', label: 'EOBI' },
  { id: 'advancesIncludingEid', label: 'Advances including Eid' },
  { id: 'fines', label: 'Fines' },
];

/** Order matches the existing on-screen table's own column order exactly (and, in turn,
 * `PAYROLL_SUMMARY_EXPORT_HEADERS` on the backend) — a user picking columns here should recognize
 * the same left-to-right order the full table and the exports already use. */
export const TABLE_COLUMN_FIELDS: readonly (FieldMeta<TableColumnFieldId> & { locked?: boolean })[] = [
  { id: 'siteName', label: 'Project Site', locked: true },
  { id: 'employeeCount', label: 'Employees' },
  { id: 'heldCount', label: 'Held' },
  { id: 'releasedCount', label: 'Released' },
  { id: 'pendingReleaseCount', label: 'Pending' },
  { id: 'noPayDueCount', label: 'No Payout' },
  { id: 'recoveryDueCount', label: 'Recovery Due' },
  { id: 'grossPay', label: 'Gross Pay' },
  { id: 'overtimeAmount', label: 'Overtime' },
  { id: 'allowances', label: 'Allowances' },
  { id: 'eobi', label: 'EOBI' },
  { id: 'advanceDeductions', label: 'Advance Deduction' },
  { id: 'eidAdvanceDeductions', label: 'Eid Advance Deduction' },
  { id: 'fines', label: 'Fines' },
  { id: 'balancePayableIncluded', label: 'Balance Payable Included' },
  { id: 'recoveryDeducted', label: 'Recovery Deducted' },
  { id: 'netSalary', label: 'Net Salary' },
  { id: 'releasedAmount', label: 'Released Amount' },
  { id: 'pendingReleaseAmount', label: 'Pending Release Amount' },
];

const COUNT_FIELD_IDS = new Set<TableColumnFieldId>([
  'employeeCount',
  'heldCount',
  'releasedCount',
  'pendingReleaseCount',
  'noPayDueCount',
  'recoveryDueCount',
]);

/** `siteName` is handled specially by callers (a raw string); every other `TableColumnFieldId` is
 * either a count (plain integer) or a money string (`formatMoney`). */
export function isCountField(id: TableColumnFieldId): boolean {
  return COUNT_FIELD_IDS.has(id);
}

export interface PayrollSummaryPrintSelection {
  cards: SummaryCardFieldId[];
  /** Always includes `siteName` — callers never need to special-case adding it back in. */
  columns: TableColumnFieldId[];
}

export interface PrintPreset {
  id: 'compact-summary' | 'deductions' | 'release-status';
  label: string;
  selection: PayrollSummaryPrintSelection;
}

/**
 * Three named presets (Checkpoint brief). "Custom" is not a fourth stored preset — it is simply
 * whatever the current selection is whenever it doesn't exactly match one of these three; the
 * dialog derives that label rather than storing it (see `matchPresetId` below).
 */
export const PRINT_PRESETS: readonly PrintPreset[] = [
  {
    id: 'compact-summary',
    label: 'Compact Summary',
    selection: {
      cards: ['employeeCount', 'grossPay', 'netSalary', 'releasedAmount', 'pendingReleaseAmount'],
      columns: ['siteName', 'employeeCount', 'grossPay', 'netSalary', 'releasedAmount', 'pendingReleaseAmount'],
    },
  },
  {
    id: 'deductions',
    label: 'Deductions',
    selection: {
      cards: ['employeeCount', 'eobi', 'advancesIncludingEid', 'fines', 'netSalary'],
      columns: [
        'siteName',
        'employeeCount',
        'eobi',
        'advanceDeductions',
        'eidAdvanceDeductions',
        'fines',
        'recoveryDeducted',
        'netSalary',
      ],
    },
  },
  {
    id: 'release-status',
    label: 'Release Status',
    selection: {
      cards: ['employeeCount', 'releasedAmount', 'pendingReleaseAmount'],
      columns: [
        'siteName',
        'employeeCount',
        'heldCount',
        'releasedCount',
        'pendingReleaseCount',
        'noPayDueCount',
        'recoveryDueCount',
        'releasedAmount',
        'pendingReleaseAmount',
      ],
    },
  },
];

/**
 * Final Print UX Refinement — the complete report (every card, every column) is the dialog's own
 * initial state and what "Reset to Default" restores. The application must never silently hide
 * report data; a smaller printout is now something a user explicitly opts into (a preset, or a hand
 * -picked selection), never the unexplained starting point. Compact Summary/Deductions/Release
 * Status remain available exactly as before, as opt-in shortcuts, not the default.
 */
export const FULL_REPORT_SELECTION: PayrollSummaryPrintSelection = {
  cards: SUMMARY_CARD_FIELDS.map((f) => f.id),
  columns: TABLE_COLUMN_FIELDS.map((f) => f.id),
};

export const DEFAULT_PRINT_SELECTION: PayrollSummaryPrintSelection = FULL_REPORT_SELECTION;

function sameIdSet<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

/** Returns the matching preset's id, or `null` if the current selection is genuinely Custom (either
 * hand-picked, or a saved preference that no longer matches any preset exactly). Full Report itself
 * is never one of these three named presets — `isFullReportSelection` below is the caller's own
 * separate check for that specific, common state. */
export function matchPresetId(selection: PayrollSummaryPrintSelection): PrintPreset['id'] | null {
  const match = PRINT_PRESETS.find(
    (preset) => sameIdSet(preset.selection.cards, selection.cards) && sameIdSet(preset.selection.columns, selection.columns),
  );
  return match?.id ?? null;
}

/** Whether the current selection is exactly the complete report — every card, every column. Used
 * only to label the dialog's own state clearly ("Full Report" rather than a bare, slightly
 * misleading "Custom") — never to change behavior. */
export function isFullReportSelection(selection: PayrollSummaryPrintSelection): boolean {
  return (
    sameIdSet(selection.cards, FULL_REPORT_SELECTION.cards) && sameIdSet(selection.columns, FULL_REPORT_SELECTION.columns)
  );
}

export type ReadabilityStatus = 'excellent' | 'good' | 'wide' | 'very-wide';

export interface ReadabilityLevel {
  status: ReadabilityStatus;
  label: string;
  /** Inclusive column-count floor this level applies from — thresholds count the locked Project
   * Site column too, matching what the dialog's own column count already shows the user. */
  minColumns: number;
  explanation: string;
  /** `Badge`'s own semantic tones (green=positive, blue=info, amber=caution, red=danger) — a
   * strictly increasing-concern progression as column count grows. */
  tone: 'green' | 'blue' | 'amber' | 'red';
}

/**
 * Print Readability guidance (Final Print UX Refinement) — informational only, never blocking and
 * never a silent selection change; the one exception remains `hasNoMeaningfulColumns` below, which
 * blocks printing a report with no figures at all, not a wide one. Ordered widest-first so
 * `getReadabilityLevel` can return the first threshold the count still satisfies.
 */
export const READABILITY_LEVELS: readonly ReadabilityLevel[] = [
  {
    status: 'very-wide',
    label: 'Very Wide',
    minColumns: 16,
    explanation: 'This layout is likely to reduce readability. Consider using a preset.',
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

/** The one thing this dialog actually blocks — printing a report with no figures at all, just the
 * site name column (Checkpoint brief: "prevent accidental printing with only Project Site and no
 * meaningful figures"). */
export function hasNoMeaningfulColumns(selection: PayrollSummaryPrintSelection): boolean {
  return selection.columns.every((id) => id === LOCKED_COLUMN_FIELD_ID);
}

const STORAGE_KEY = 'payroll-summary-print-fields:v1';

function isKnownCardId(id: unknown): id is SummaryCardFieldId {
  return typeof id === 'string' && SUMMARY_CARD_FIELDS.some((f) => f.id === id);
}

function isKnownColumnId(id: unknown): id is TableColumnFieldId {
  return typeof id === 'string' && TABLE_COLUMN_FIELDS.some((f) => f.id === id);
}

/**
 * Browser-local only (Checkpoint brief: "do not persist this preference to PostgreSQL in this
 * checkpoint") — a user's last-used print field selection, read defensively: an unrecognized id
 * (an old field name after a future rename, or hand-edited storage) is silently dropped rather than
 * ever crashing the dialog or reintroducing a field this checkpoint no longer knows about.
 */
export function loadStoredPrintSelection(): PayrollSummaryPrintSelection | null {
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
    // Private browsing / storage disabled / corrupt JSON — never block the dialog over a read failure.
    return null;
  }
}

export function saveStoredPrintSelection(selection: PayrollSummaryPrintSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / private browsing — never block printing over a preference save failure.
  }
}
