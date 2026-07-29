import { formatDate } from '@payroll/shared';
import type { StatementBalanceKind, StatementLedgerCategory, StatementLedgerEntry, StatementRange } from './statements.types';

/**
 * Phase 7B Checkpoint 2 — shared Statement label vocabulary, extracted from
 * `lib/pdf/templates/statement.ts` (Phase 7B Checkpoint 1). That file originally defined these
 * functions as its own backend-local mirror of `frontend/src/components/statements/
 * statement-labels.ts` — a monorepo package-boundary duplication its own doc comment explicitly
 * tolerated "worth revisiting only if a third consumer appears." This checkpoint's Excel and CSV
 * export functions (`statements.service.ts`) are that third backend consumer, so the vocabulary is
 * extracted here once and imported by every backend renderer (PDF, XLSX, CSV) rather than copied a
 * third time — matching this codebase's own "grep for duplicates on a new shared utility"
 * convention. The frontend copy is intentionally left as its own file: it lives across the package
 * boundary this file cannot cross (a backend module can't import frontend code), the same accepted
 * tolerance `statement-labels.ts` (frontend) already documents for its half of the duplication.
 *
 * Pure label lookups only — no rendering, no HTML, no CSV/Excel-specific formatting. Every backend
 * renderer wraps these with its own presentation concerns (escaping, currency display, cell types).
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "July 2026". */
export function cyclePeriodLabel(cycle: { year: number; month: number } | null | undefined): string {
  if (!cycle) return '—';
  return `${MONTH_NAMES[cycle.month - 1] ?? ''} ${cycle.year}`;
}

/** The resolved Statement Period, as the backend actually resolved it — mirrors
 * `frontend/src/components/statements/statement-labels.ts`'s `statementPeriodLabel` exactly. */
export function statementPeriodLabel(range: StatementRange): string {
  if (!range.fromCycle || !range.toCycle) return 'No payroll cycles exist yet';
  if (range.fromCycle.id === range.toCycle.id) return cyclePeriodLabel(range.fromCycle);
  return `${cyclePeriodLabel(range.fromCycle)} – ${cyclePeriodLabel(range.toCycle)} (${range.cycleCount} cycle${range.cycleCount === 1 ? '' : 's'})`;
}

/** Deliberately plain text, not a status-semantic Badge tone (docs/design-system.md §3) —
 * SALARY/CORRECTION/ADVANCE is a domain grouping, not a status. */
export function statementCategoryLabel(category: StatementLedgerCategory): string {
  if (category === 'SALARY') return 'Salary';
  if (category === 'CORRECTION') return 'Correction';
  return 'Advance';
}

/** "Payable to Employee" / "Recoverable from Employee" / "Advance" — the exact vocabulary
 * `docs/architecture/workflows/statements-ledger.md §2` establishes, never raw Debit/Credit. */
export function statementBalanceLabel(balance: StatementBalanceKind): string {
  if (balance === 'PAYABLE') return 'Payable to Employee';
  if (balance === 'RECOVERABLE') return 'Recoverable from Employee';
  return 'Advance';
}

/** The short form used inline next to a movement figure, where the full sentence-length label
 * above would be too wide. */
export function statementBalanceShortLabel(balance: StatementBalanceKind): string {
  if (balance === 'PAYABLE') return 'Payable';
  if (balance === 'RECOVERABLE') return 'Recoverable';
  return 'Advance';
}

/** A ledger row's own display date — the owning cycle's period when one exists, falling back to
 * the row's own `date` (`formatDate`, `@payroll/shared` — this codebase's one display-date format)
 * for the handful of kinds with no cycle attribution at all (Advance Given/Cancelled/Deferred, a
 * standalone Correction Payment). Mirrors the frontend's identically-named `statementEntryDateLabel`
 * exactly. */
export function entryDateLabel(entry: Pick<StatementLedgerEntry, 'date' | 'cycleYear' | 'cycleMonth'>): string {
  if (entry.cycleYear && entry.cycleMonth) {
    return cyclePeriodLabel({ year: entry.cycleYear, month: entry.cycleMonth });
  }
  return formatDate(entry.date);
}
