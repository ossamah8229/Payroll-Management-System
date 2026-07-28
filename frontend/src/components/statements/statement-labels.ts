import { formatDate } from '@payroll/shared';
import { cyclePeriodLabel } from '@/components/corrections/correction-labels';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import { ApiError } from '@/lib/api-client';
import type {
  StatementBalanceKind,
  StatementLedgerCategory,
  StatementLedgerEntry,
  StatementRange,
} from '@/hooks/use-employee-statement';

/** Pure label lookups — no rendering, unit-testable directly (this codebase's own convention;
 * see `correction-labels.ts`'s identical doc comment). Deliberately plain text, not a
 * status-semantic Badge tone (docs/design-system.md §3: "color always maps to the same meaning
 * app-wide" — SALARY/CORRECTION/ADVANCE is a domain grouping, not a status, so it does not borrow
 * green/amber/red/blue/purple's own reserved meanings). */
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
 * above would be too wide for a table cell. */
export function statementBalanceShortLabel(balance: StatementBalanceKind): string {
  if (balance === 'PAYABLE') return 'Payable';
  if (balance === 'RECOVERABLE') return 'Recoverable';
  return 'Advance';
}

/** A ledger row's own display date — the owning cycle's period when one exists (every
 * cycle-attributed event), falling back to the row's own `date` (`DD-MM-YYYY`, this codebase's
 * one display-date format, `shared/lib/date.ts`) for the handful of kinds with no cycle
 * attribution at all (Advance Given/Cancelled/Deferred, a standalone Correction Payment) — see
 * `statements.service.ts §9`'s own "period anchoring" note for why those still have a *period*
 * (used for ordering/range-bounding) despite having no `PayrollCycle` row of their own. */
export function statementEntryDateLabel(entry: Pick<StatementLedgerEntry, 'date' | 'cycleYear' | 'cycleMonth'>): string {
  if (entry.cycleYear && entry.cycleMonth) {
    return cyclePeriodLabel({ year: entry.cycleYear, month: entry.cycleMonth });
  }
  return formatDate(entry.date);
}

/** The resolved Statement Period, as the backend actually resolved it — `range.fromCycle`/
 * `.toCycle` are the authoritative echo of what was requested (or, if neither was supplied, the
 * server's own "latest 12 cycles" default, `statements.service.ts`'s `resolveStatementRange`) —
 * never recomputed from the caller's own local selector state, so this can never drift from what
 * the ledger below was actually built against. */
export function statementPeriodLabel(range: StatementRange): string {
  if (!range.fromCycle || !range.toCycle) return 'No payroll cycles exist yet';
  if (range.fromCycle.id === range.toCycle.id) return formatCycleLabel(range.fromCycle);
  return `${formatCycleLabel(range.fromCycle)} – ${formatCycleLabel(range.toCycle)} (${range.cycleCount} cycle${range.cycleCount === 1 ? '' : 's'})`;
}

export interface StatementErrorPresentation {
  headline: string;
  detail: string;
  /** Whether a "Try Again" action makes sense — never true for 403/404, since retrying an
   * unauthorized or (deliberately, per the site-scope-concealment rule) not-found request can
   * never succeed and would only invite repeated retrying of something that isn't transient. */
  retryable: boolean;
}

/** Maps a Statement fetch failure to display copy — deliberately never distinguishes a genuine
 * "no such employee" 404 from the concealed "zero Site overlap" 404
 * (`statements.service.ts`'s own "reveal nothing" rule, matching Payslips' precedent) and never
 * echoes a raw backend error body/stack trace. */
export function classifyStatementError(error: unknown): StatementErrorPresentation {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return {
        headline: 'You do not have access to this Statement',
        detail: 'Ask a Master User for the statements:view permission if you believe this is a mistake.',
        retryable: false,
      };
    }
    if (error.status === 404) {
      return {
        headline: 'No Statement is available for this selection',
        detail:
          'Check the employee and Statement Period — this can also happen when the record falls outside your assigned Site access.',
        retryable: false,
      };
    }
    return { headline: 'Could not load the Statement', detail: error.message, retryable: true };
  }
  return {
    headline: 'Could not load the Statement',
    detail: 'A network or server error occurred. Please try again.',
    retryable: true,
  };
}
