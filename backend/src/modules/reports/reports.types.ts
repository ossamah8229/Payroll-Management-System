/**
 * Phase 8B Checkpoint 1 — Payroll Summary Report, canonical domain types. Independent of Prisma's
 * generated types, matching this codebase's established convention for a module's pure domain shape
 * (`statements.types.ts`, `corrections.types.ts`).
 *
 * **Read-only, derived, never persisted** (Phase 8A investigation report §1.1/§16/§17): every figure
 * here is computed from `PayrollEntry`'s own already-frozen columns (plus its `PayrollEntryWorkLine`
 * children) via the single canonical `calcNet` function — there is no `PayrollReportSnapshot` table,
 * no cached/materialized result, and no second net-salary formula anywhere in this module.
 *
 * **Grouping (Phase 8A §4A / Checkpoint 1 brief):** Payroll Cycle → Project Site → totals. This
 * report is always scoped to exactly one `PayrollCycle` (the same "one cycle at a time" shape Bank
 * Sheet/Cash Receiving/Payslips already use) — there is no cross-cycle comparison here (that is the
 * explicitly out-of-scope Variance/Month-on-Month report, Phase 8A §4H). `cycleTotals` is always
 * computed over the *complete* filtered/accessible site scope, never just the current page — a
 * paginated site list must never imply a partial grand total.
 */

export type PayrollCycleStatusRef = 'DRAFT' | 'RELEASED' | 'ARCHIVED';

export interface PayrollSummaryCycleRef {
  id: string;
  year: number;
  month: number;
  status: PayrollCycleStatusRef;
}

/**
 * One site's (or the whole cycle's, for `cycleTotals`) aggregated payroll figures.
 *
 * **Release-state counts/amounts (Phase 8A §3/§13 — released status is never inferred from net
 * salary or from `PayrollCycle.status` alone):** every `PayrollEntry` in scope falls into exactly one
 * of five buckets, mirroring `payroll-entry.service.ts`'s own `assertEntryEditable`/release-readiness
 * logic — `released` (paid), `held` (excluded from release entirely, always shown, never dropped),
 * `NO_PAY_DUE`/`RECOVERY_DUE` (resolved by a Unit release sweep without `released` itself being set —
 * Negative Payroll Recovery checkpoint), or `pendingRelease` (Draft-editable, awaiting release). The
 * five counts always sum to `employeeCount`.
 *
 * **`releasedAmount`** — sum of `netSalary` for `released = true` entries only, defensively filtered
 * to `netSalary > 0` (the same guard `bank-sheets.service.ts`'s `getBankSheet` already applies, for
 * the same pre-existing legacy-anomaly reason — `released` has only ever been set for a positive net
 * salary going forward, but a pre-existing row from before that invariant shipped must still never
 * inflate this figure).
 *
 * **`pendingReleaseAmount`** — sum of `netSalary` for entries that are neither released, held, nor
 * already resolved by a Unit release sweep (`payoutOutcome === null`) — i.e. "computed for this cycle
 * and site, but not yet paid out." This is this report's answer to the Checkpoint 1 brief's
 * "Outstanding / balance amount" field, deliberately defined this way rather than by joining the
 * live, cross-cycle `BalanceAdjustment.remainingAmount` table — see the Checkpoint 1 report's own
 * "Released / outstanding / correction treatment" section for the full reasoning: `remainingAmount`
 * is a *live, current-state* figure whose origin cycle and settlement history can span cycles other
 * than the one this report is scoped to, so surfacing it inside a single-cycle summary risks
 * conflating "as of today" with "as of this cycle" — exactly the kind of misleading combination
 * Phase 8A's financial-correctness rules warn against. A dedicated, cross-cycle Balance
 * Adjustment/Advance Recovery report (Phase 8A §4F, not built in this checkpoint) is the correct home
 * for that figure.
 *
 * **`balancePayableIncluded`/`recoveryDeducted`** — sums of `PayrollEntry.correctionBalancePayable`/
 * `.correctionBalanceRecovery`, the per-cycle *materialized* amounts already reconciled into this
 * cycle's own `netSalary` (Phase 6 Balance Adjustment materialization) — clearly separate fields, never
 * merged into `pendingReleaseAmount` or any other bucket, so a reviewer can see exactly how much of
 * this cycle's payout/deduction is a settlement of a prior correction versus ordinary salary.
 */
export interface PayrollSummaryFigures {
  employeeCount: number;
  heldCount: number;
  releasedCount: number;
  pendingReleaseCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;

  /** Sum of `PayrollEntry.grossPay`. */
  grossPay: string;
  /** Sum of each entry's `calcNet().otEarned` (work-line-level OT hours × effective OT rate). */
  overtimeAmount: string;
  /** Sum of `PayrollEntry.allowance`. */
  allowances: string;
  /** Sum of each entry's `calcNet().eobiDeduction` — `eobiApplicable ? eobiAmount : 0`, never a flat
   * assumption (Phase 8A §13 rule 9). */
  eobi: string;
  advanceDeductions: string;
  eidAdvanceDeductions: string;
  fines: string;
  /** See this interface's own doc comment above. */
  balancePayableIncluded: string;
  recoveryDeducted: string;

  /** Sum of each entry's `calcNet().totalEarning`. */
  totalEarnings: string;
  /** Sum of each entry's `calcNet().totalDeduction`. */
  totalDeductions: string;
  /** Sum of each entry's `calcNet().netSalary` — the single canonical figure, never recomputed by
   * this module. */
  netSalary: string;
  releasedAmount: string;
  pendingReleaseAmount: string;
}

export interface PayrollSummarySiteRow extends PayrollSummaryFigures {
  siteId: string;
  siteName: string;
}

export interface PayrollSummaryReport {
  cycle: PayrollSummaryCycleRef;
  generatedAt: string;
  /** The site scope actually applied — `null` means unrestricted (Master Admin, no explicit filter);
   * otherwise the exact resolved list, matching `getAccessibleSiteIds`'s own convention. Echoed back
   * so the frontend/export can display exactly what was included, never inferred from the caller's
   * original request alone. */
  filters: { siteIds: string[] | null };
  /** Computed over the *complete* filtered/accessible site scope — never just `siteRows` (the current
   * page). See this module's own top-of-file doc comment. */
  cycleTotals: PayrollSummaryFigures;
  page: number;
  pageSize: number;
  /** Total number of site rows in the complete filtered scope (i.e. how many sites had at least one
   * `PayrollEntry` this cycle) — the pagination unit here is a Project Site, not an employee. */
  total: number;
  siteRows: PayrollSummarySiteRow[];
}

export interface GetPayrollSummaryReportParams {
  cycleId: string;
  /** Explicit site filter — each id is independently access-checked (`assertSiteAccess`) and throws
   * 403 for any inaccessible site named, never silently narrowed (Checkpoint 1 brief: "a restricted
   * user must never obtain totals for inaccessible sites... do not silently widen an out-of-scope
   * site request"). Omitted entirely resolves to the caller's full accessible scope. */
  siteIds?: string[];
  page?: number;
  pageSize?: number;
}

export interface PayrollSummaryExportResult {
  buffer: Buffer;
  rowCount: number;
  cycle: PayrollSummaryCycleRef;
}
