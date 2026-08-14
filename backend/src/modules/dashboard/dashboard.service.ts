import { Decimal } from 'decimal.js';
import type { SessionUser } from '@payroll/shared';
import {
  DASHBOARD_SITE_SUMMARY_TOP_N,
  PERMISSIONS,
  type DashboardAttention,
  type DashboardAttentionItem,
  type DashboardCycleRef,
  type DashboardResponse,
  type DashboardSiteSummaryRow,
} from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { getAccessibleSiteIds, hasAnyPermission, hasPermission } from '../../common/authz-policy';
import { listPayrollCycles } from '../payroll-processing/payroll-processing.service';
import { buildPayrollSummaryData } from '../reports/reports.service';

/**
 * Dashboard Checkpoint 1A — the single aggregation service backing `GET /api/v1/dashboard`
 * (`docs/architecture/workflows/dashboard.md`). Pure orchestration layer: every financial figure is
 * read from an already-authoritative source, never recomputed independently —
 * `reports.service.ts`'s own `buildPayrollSummaryData` (Payroll Summary's exact query+aggregation)
 * for every cycle-scoped financial widget (Net Payroll, Pending Release, Release Progress,
 * Deductions, Site Summary), plus small, direct DB-aggregate counts for the two remaining widgets
 * that don't already have a matching report aggregation (Total Employees, Attention Required). No
 * `calcNet` import, no arithmetic recreation of any payroll total anywhere in this file (§19).
 *
 * See `shared/src/schemas/dashboard.ts` for the full nullable/unavailable contract this function
 * implements — outer gate is `reports:view OR payroll:view` (enforced by `dashboard.routes.ts`, not
 * here), but every widget below independently checks its own required permission regardless of what
 * the outer gate happens to guarantee today (§3/§22 hostile-review questions 1–3).
 *
 * **Release Progress/Pending Release/Held Entries deliberately reuse `buildPayrollSummaryData`'s own
 * release-state bucket counts rather than issuing a second call into
 * `salary-release-report.service.ts`'s `computeSalaryReleaseReportTotals` (§9's "Salary Release
 * source" / §22 hostile-review question 17).** Both functions are read-only aggregations over the
 * exact same `PayrollEntry.released`/`.hold`/`.payoutOutcome` columns — the single source of truth
 * Release Salary's own write path (`payroll-release.service.ts`'s `releaseProjectUnit`) sets; neither
 * report "owns" a competing release formula, they are two independently-shaped views over the same
 * stored facts (the same relationship Payroll Summary's own `PayrollSummaryFigures` doc comment
 * already documents: "mirrors `payroll-entry.service.ts`'s own `assertEntryEditable`/
 * release-readiness classification"). Calling `computeSalaryReleaseReportTotals` a second time in
 * the same request would re-fetch and re-aggregate the identical `PayrollEntry` rows
 * `buildPayrollSummaryData` already fetched once — a redundant second pass this checkpoint's own
 * single-request/no-N+1 requirement (§16) argues against, not a correctness improvement. Numeric
 * identity between this Dashboard's `releaseProgress`/`pendingRelease`/`attention.heldEntries` and
 * the Salary Release Report's own live totals is proven directly in `dashboard.test.ts`'s "source
 * reconciliation" suite, not merely asserted here.
 *
 * **Single request snapshot (§12)**: the current cycle and the caller's accessible site scope are
 * each resolved exactly once, at the top of `getDashboard`, and reused by every widget below — no
 * widget re-resolves either independently, so every figure in one response reflects the same
 * cycle/site scope as of the same moment.
 */

type CycleListRow = Awaited<ReturnType<typeof listPayrollCycles>>[number];

/** Mirrors `frontend/src/hooks/use-payroll-cycles.ts`'s own `resolveDefaultCycleId` exactly — Draft
 * → newest Released → newest Archived → none — over `listPayrollCycles()`'s already year/month-desc
 * sorted result, so the backend and frontend can never resolve a different "current" cycle for the
 * same underlying data (`docs/architecture/workflows/payroll-lifecycle.md`). */
function resolveCurrentCycle(cycles: CycleListRow[]): CycleListRow | undefined {
  return (
    cycles.find((cycle) => cycle.status === 'DRAFT') ??
    cycles.find((cycle) => cycle.status === 'RELEASED') ??
    cycles.find((cycle) => cycle.status === 'ARCHIVED')
  );
}

function toCycleRef(cycle: CycleListRow): DashboardCycleRef {
  return { id: cycle.id, year: cycle.year, month: cycle.month, status: cycle.status };
}

/** `employees:view` required. Active (`dateOfLeaving: null`) `Employee` count, scoped by current
 * `Employee.siteId` — the current roster, deliberately independent of `PayrollEntry.siteId`/the
 * resolved cycle (§6: Employee-vs-PayrollEntry site-scoping applies to payroll/financial history
 * only, never to this widget). */
async function computeTotalEmployees(currentUser: SessionUser, siteIdFilter: string[] | undefined): Promise<number | null> {
  if (!hasPermission(currentUser, PERMISSIONS.EMPLOYEES_VIEW)) return null;
  return prisma.employee.count({
    where: { dateOfLeaving: null, ...(siteIdFilter && { siteId: { in: siteIdFilter } }) },
  });
}

/** Held Entries — never permission-gated to `null` (every viewer reaching this endpoint already
 * holds `reports:view OR payroll:view`, the same permission class this widget itself would use),
 * cycle-scoped: legitimately `{ count: 0 }` when no cycle exists, mirroring the exact
 * `hold: true, released: false, payoutOutcome: null` predicate `payroll-release.service.ts`'s own
 * `releaseAllEligible` already uses for "currently-unresolved, held" entries. */
async function computeHeldEntries(cycleId: string | undefined, siteIdFilter: string[] | undefined): Promise<DashboardAttentionItem> {
  if (!cycleId) return { count: 0 };
  const count = await prisma.payrollEntry.count({
    where: {
      cycleId,
      hold: true,
      released: false,
      payoutOutcome: null,
      ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
    },
  });
  return { count };
}

/** `corrections:approve` required. A pending `CorrectionRequest` is only ever raised against an
 * already-`released` `PayrollEntry` (`assertEntryIsReleased`, `corrections.service.ts`) — deliberately
 * NOT scoped to the resolved "current" cycle (which, when Draft, can hold no released entries at all
 * by definition); this is a live, cross-cycle queue, matching `corrections.repository.ts`'s own
 * `listCorrectionRequests` filter shape (`payrollEntry.siteId` site scoping). */
async function computePendingCorrections(
  currentUser: SessionUser,
  siteIdFilter: string[] | undefined,
): Promise<DashboardAttentionItem | null> {
  if (!hasPermission(currentUser, PERMISSIONS.CORRECTIONS_APPROVE)) return null;
  const count = await prisma.correctionRequest.count({
    where: {
      status: 'PENDING',
      ...(siteIdFilter && { payrollEntry: { siteId: { in: siteIdFilter } } }),
    },
  });
  return { count };
}

/** `advances:manage` required (the existing Advances module's own read/manage permission — no
 * separate `advances:view` exists, `advances.routes.ts`'s own blanket gate). A live, cross-cycle
 * figure — an Advance still due for recovery (`status: 'ACTIVE'`, a genuine remaining
 * `outstandingBalance`) is a current-state fact, not a per-cycle one, mirroring
 * `advance-recovery-report.service.ts`'s own "current, live figures, not as of any Cycle"
 * convention. Site-scoped via `Advance.employee.siteId` (current site) — Advance has no historical
 * site of its own, the same authorization model `advances.service.ts`'s own `listAdvances` already
 * uses. */
async function computeRecoveryDue(
  currentUser: SessionUser,
  siteIdFilter: string[] | undefined,
): Promise<DashboardAttentionItem | null> {
  if (!hasPermission(currentUser, PERMISSIONS.ADVANCES_MANAGE)) return null;
  const where = {
    status: 'ACTIVE' as const,
    outstandingBalance: { gt: 0 },
    ...(siteIdFilter && { employee: { siteId: { in: siteIdFilter } } }),
  };
  const [count, agg] = await Promise.all([
    prisma.advance.count({ where }),
    prisma.advance.aggregate({ where, _sum: { outstandingBalance: true } }),
  ]);
  return { count, amount: (agg._sum.outstandingBalance ?? new Decimal(0)).toFixed(2) };
}

export async function getDashboard(currentUser: SessionUser): Promise<DashboardResponse> {
  const siteIdFilter = getAccessibleSiteIds(currentUser);
  const cycles = await listPayrollCycles();
  const currentCycle = resolveCurrentCycle(cycles);
  const cycleRef = currentCycle ? toCycleRef(currentCycle) : null;

  const canViewPayrollSummary = hasAnyPermission(currentUser, [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYROLL_VIEW]);
  const canViewReports = hasPermission(currentUser, PERMISSIONS.REPORTS_VIEW);

  const [summary, totalEmployees, heldEntries, pendingCorrections, recoveryDue] = await Promise.all([
    currentCycle && canViewPayrollSummary ? buildPayrollSummaryData(currentUser, { cycleId: currentCycle.id }) : Promise.resolve(null),
    computeTotalEmployees(currentUser, siteIdFilter),
    computeHeldEntries(currentCycle?.id, siteIdFilter),
    computePendingCorrections(currentUser, siteIdFilter),
    computeRecoveryDue(currentUser, siteIdFilter),
  ]);

  const attention: DashboardAttention = { heldEntries, pendingCorrections, recoveryDue };

  const releaseProgress =
    summary && canViewPayrollSummary
      ? {
          totalCount: summary.cycleTotals.employeeCount,
          releasedCount: summary.cycleTotals.releasedCount,
          pendingCount: summary.cycleTotals.pendingReleaseCount,
          heldCount: summary.cycleTotals.heldCount,
          noPayDueCount: summary.cycleTotals.noPayDueCount,
          recoveryDueCount: summary.cycleTotals.recoveryDueCount,
          releasedAmount: summary.cycleTotals.releasedAmount,
          pendingAmount: summary.cycleTotals.pendingReleaseAmount,
        }
      : null;

  const pendingRelease =
    summary && canViewPayrollSummary
      ? { count: summary.cycleTotals.pendingReleaseCount, amount: summary.cycleTotals.pendingReleaseAmount }
      : null;

  const netPayroll = summary && canViewReports ? summary.cycleTotals.netSalary : null;

  const deductionBreakdown =
    summary && canViewReports
      ? {
          eobi: summary.cycleTotals.eobi,
          advance: summary.cycleTotals.advanceDeductions,
          eidAdvance: summary.cycleTotals.eidAdvanceDeductions,
          fine: summary.cycleTotals.fines,
        }
      : null;

  let siteSummary: DashboardSiteSummaryRow[] | null = null;
  let siteSummaryTotalSites: number | null = null;
  if (canViewReports) {
    const rows = summary ? summary.siteRows : [];
    // Top-N by Net Payroll, descending (frozen V1 choice, `docs/architecture/workflows/
    // dashboard.md` §"Site Summary") — a display-ordering decision only (every value is read
    // verbatim off `summary.siteRows`, never recomputed), so the landing page's most financially
    // significant sites surface first rather than an arbitrary alphabetical slice.
    const sorted = [...rows].sort((a, b) => Number(b.netSalary) - Number(a.netSalary));
    siteSummaryTotalSites = sorted.length;
    siteSummary = sorted.slice(0, DASHBOARD_SITE_SUMMARY_TOP_N).map((row) => ({
      siteId: row.siteId,
      siteName: row.siteName,
      employeeCount: row.employeeCount,
      netPayroll: row.netSalary,
      releasedAmount: row.releasedAmount,
      pendingReleaseAmount: row.pendingReleaseAmount,
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    cycle: cycleRef,
    siteScope: { siteIds: siteIdFilter ?? null },
    totalEmployees,
    netPayroll,
    pendingRelease,
    releaseProgress,
    deductionBreakdown,
    siteSummary,
    siteSummaryTotalSites,
    attention,
  };
}
