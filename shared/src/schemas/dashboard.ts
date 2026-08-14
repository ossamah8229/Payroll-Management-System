/**
 * Dashboard Checkpoint 1A (backend foundation, approved Checkpoint 0 architecture). Shared response
 * contract for `GET /api/v1/dashboard` — no request schema, since the route takes no query
 * parameters at all (frozen decision: the current-cycle context is resolved internally by the
 * service, mirroring `useSelectedPayrollCycle`'s own Draft → newest Released → newest Archived
 * algorithm, never taken from the URL — the Dashboard route itself is `/`).
 *
 * **Nullable/unavailable semantics (frozen decision — never a fabricated zero):**
 *   - `cycle: null` means no `PayrollCycle` row exists in the system at all. Every cycle-scoped
 *     widget (`netPayroll`, `pendingRelease`, `releaseProgress`, `deductionBreakdown`, `siteSummary`)
 *     is `null` whenever `cycle` is `null` — there is no meaningful "this cycle's net payroll" to
 *     report when no cycle exists, so `null` here is honest, not merely a permission gate.
 *   - Independent of `cycle` and `null` for a different reason — **unauthorized** — whenever the
 *     viewer lacks that specific widget's own required permission, checked independently of the
 *     outer route gate (`reports:view OR payroll:view`) even though every widget below happens to
 *     require a permission at least as strict as that gate today. A caller can always distinguish
 *     "no cycle" from "unauthorized" via the top-level `cycle` field.
 *   - `attention.heldEntries` is the one exception that is never `null` for a permission reason
 *     (every viewer who reaches this endpoint at all already holds `reports:view OR payroll:view`,
 *     the same permission class this widget uses) — it legitimately reports `count: 0` when no
 *     cycle exists (a true fact: zero `PayrollEntry` rows can be held when there is no cycle to hold
 *     them in), rather than `null`.
 *   - `attention.pendingCorrections`/`attention.recoveryDue` are independently permission-gated
 *     (`corrections:approve`/`advances:manage`) and are **not** cycle-scoped — a pending
 *     `CorrectionRequest`/an `ACTIVE` `Advance` with a real outstanding balance are live,
 *     cross-cycle facts, matching `advance-recovery-report.service.ts`'s own "current, live figures,
 *     not as of any cycle" convention.
 *
 * **Site scope**: `siteScope.siteIds` is the exact accessible-site list actually applied to every
 * site-scoped widget in this one response (mirrors `PayrollSummaryReport.filters.siteIds` — `null`
 * means unrestricted, Master Admin only).
 *
 * **Single-request snapshot**: every widget below is computed from the same resolved cycle and the
 * same resolved site scope, within one `GET /api/v1/dashboard` call — never independently re-fetched
 * per widget (`docs/architecture/workflows/dashboard.md` §"Snapshot consistency").
 */

export type DashboardCycleStatus = 'DRAFT' | 'RELEASED' | 'ARCHIVED';

export interface DashboardCycleRef {
  id: string;
  year: number;
  month: number;
  status: DashboardCycleStatus;
}

/** `count` is always a legitimate, currently-true count; `amount` is included only for the one
 * Attention Required item (`recoveryDue`) whose authoritative source already provides a live
 * monetary figure alongside its count (frozen decision — §10, "optional amount only if already
 * available from the authoritative service and permission allows"). */
export interface DashboardAttentionItem {
  count: number;
  amount?: string;
}

/**
 * Frozen V1 categories only (§10) — Held Entries, Pending Corrections, Recovery Due. Never a task
 * queue; never an employee name or correction reason/actor.
 */
export interface DashboardAttention {
  /** Source: this response's own release-state aggregation (same one `releaseProgress` uses) —
   * never `null` (see this file's own top-of-file doc comment). */
  heldEntries: DashboardAttentionItem;
  /** `corrections:approve` required — `null` when the viewer lacks it, never a misleading zero. */
  pendingCorrections: DashboardAttentionItem | null;
  /** `advances:manage` required (the existing Advances module's own read/manage permission — no
   * separate advances:view exists) — `null` when the viewer lacks it. */
  recoveryDue: DashboardAttentionItem | null;
}

/** Source: Payroll Summary's own release-state bucket counts/amounts (`reports.service.ts`'s
 * `buildPayrollSummaryData`) — never re-derived independently. `totalCount` is the cycle's complete
 * accessible-scope `PayrollEntry` count (Payroll Summary's own `employeeCount`), not a headcount of
 * `Employee` rows (see `totalEmployees`, below, for that separate figure). No release percentage is
 * computed server-side (frozen decision — "do not invent new release formulas"); a consumer may
 * derive `releasedCount / totalCount` itself from these plain counts. */
export interface DashboardReleaseProgress {
  totalCount: number;
  releasedCount: number;
  pendingCount: number;
  heldCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  releasedAmount: string;
  pendingAmount: string;
}

/** Source: Payroll Summary's own `cycleTotals.pendingReleaseCount`/`.pendingReleaseAmount` — the
 * same figures `releaseProgress.pendingCount`/`.pendingAmount` above already carry, surfaced again
 * under its own name/permission gate (`reports:view OR payroll:view`, distinct from
 * `releaseProgress`'s own gate only in that the two happen to share the same permission set today —
 * each is still independently checked, per §3/§22). */
export interface DashboardPendingRelease {
  count: number;
  amount: string;
}

/** Source: Payroll Summary's own `cycleTotals` fields — the same four-line breakdown the Deduction
 * Report's own totals establish (EOBI via `calcNet`'s effective-EOBI formula, never a raw column
 * sum; Advance/EID Advance/Fine are plain stored-column sums). No fifth category — Correction
 * Balance Recovery is deliberately excluded from this widget, mirroring Payroll Summary's own
 * `balancePayableIncluded`/`recoveryDeducted` being kept separate from this bucket. */
export interface DashboardDeductionBreakdown {
  eobi: string;
  advance: string;
  eidAdvance: string;
  fine: string;
}

/** One compact site row — a subset of Payroll Summary's own `PayrollSummarySiteRow` fields, never
 * the full report row set (§11: "must NOT expose the full Payroll Summary report row dataset"). */
export interface DashboardSiteSummaryRow {
  siteId: string;
  siteName: string;
  employeeCount: number;
  netPayroll: string;
  releasedAmount: string;
  pendingReleaseAmount: string;
}

/** Top-N cap applied to `siteSummary` (frozen V1 decision — a compact landing-page widget, never
 * the full Payroll Summary dataset). `siteSummaryTotalSites` (on `DashboardResponse`) reports how
 * many sites exist in the complete accessible/filtered scope, so a consumer can render "+N more —
 * see full Payroll Summary" without a second request. */
export const DASHBOARD_SITE_SUMMARY_TOP_N = 5;

export interface DashboardResponse {
  generatedAt: string;
  /** `null` only when no `PayrollCycle` exists in the system at all (§14's "No Payroll Cycle" empty
   * state) — see this file's own top-of-file doc comment for the full nullable-semantics contract. */
  cycle: DashboardCycleRef | null;
  /** The exact accessible-site scope applied to every site-scoped widget in this response —
   * `null` = unrestricted (Master Admin, no narrower scope exists). */
  siteScope: { siteIds: string[] | null };
  /** `employees:view` required — active (`dateOfLeaving: null`), accessible-site-scoped `Employee`
   * count. Independent of `cycle`/`siteScope`'s payroll-history scoping — this counts current
   * `Employee.siteId`, the current roster, never `PayrollEntry.siteId` (§6's Employee-vs-PayrollEntry
   * site-scoping distinction applies to payroll/financial history only, not this widget). `null`
   * when the viewer lacks `employees:view`. */
  totalEmployees: number | null;
  /** `reports:view` required. Source: Payroll Summary's own `cycleTotals.netSalary` — never
   * recomputed. `null` when unauthorized or when `cycle` is `null`. */
  netPayroll: string | null;
  /** `reports:view OR payroll:view` required. `null` when unauthorized or when `cycle` is `null`. */
  pendingRelease: DashboardPendingRelease | null;
  /** `reports:view OR payroll:view` required. `null` when unauthorized or when `cycle` is `null`. */
  releaseProgress: DashboardReleaseProgress | null;
  /** `reports:view` required. `null` when unauthorized or when `cycle` is `null`. */
  deductionBreakdown: DashboardDeductionBreakdown | null;
  /** `reports:view` required. `null` when unauthorized; an empty array (never `null`) when
   * authorized but the complete accessible/filtered scope has no site rows this cycle (no cycle, or
   * zero accessible sites with a `PayrollEntry` this cycle) — a genuine empty list is not the same
   * fact as "not authorized to see this widget at all," so the two are never conflated. */
  siteSummary: DashboardSiteSummaryRow[] | null;
  /** Total number of site rows in the complete accessible/filtered scope this cycle (before the
   * `DASHBOARD_SITE_SUMMARY_TOP_N` cap) — `null` under the exact same condition `siteSummary` is
   * `null` (unauthorized), `0` whenever `siteSummary` is a valid empty array. */
  siteSummaryTotalSites: number | null;
  attention: DashboardAttention;
}
