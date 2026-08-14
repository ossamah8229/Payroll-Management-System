import { formatNumber } from '@payroll/shared';
import type { DashboardCycleRef, DashboardReleaseProgress } from '@payroll/shared';

/**
 * Dashboard Checkpoint 1B — pure label/text helpers over the frozen Checkpoint 1A backend contract
 * (`shared/src/schemas/dashboard.ts`). No financial or count value is ever recomputed here — every
 * function below only decides how an already-resolved backend value (or its `null`) is displayed.
 *
 * **Never conflate "no cycle" with "unauthorized."** The backend contract's own doc comment is
 * explicit: a `null` cycle-scoped widget (`netPayroll`, `pendingRelease`, `releaseProgress`,
 * `deductionBreakdown`, `siteSummary`) means one of two structurally different things, and "a caller
 * can always distinguish [them]... via the top-level `cycle` field." `cycleScopedUnavailableReason`
 * below is that distinction, made once, so every widget on this page reports the *true* reason
 * rather than a single generic "Unavailable" that would hide whether the fix is "wait for a cycle to
 * exist" or "ask a Master User for a permission."
 */

export type DashboardUnavailableReason = 'NO_CYCLE' | 'UNAUTHORIZED';

/** Only valid for a *cycle-scoped* widget's own `null` value (never `totalEmployees`,
 * `attention.pendingCorrections`, or `attention.recoveryDue` — those are independent of `cycle`
 * entirely, always `UNAUTHORIZED` when `null`, per the schema's own doc comment). */
export function cycleScopedUnavailableReason(cycle: DashboardCycleRef | null): DashboardUnavailableReason {
  return cycle === null ? 'NO_CYCLE' : 'UNAUTHORIZED';
}

export function unavailableLabel(reason: DashboardUnavailableReason): string {
  return reason === 'NO_CYCLE' ? 'No active cycle' : 'Unavailable';
}

/** "39 of 42 entries released" — Current Cycle Status's own operational context line (§8: "no
 * financial sensitive data here"), built only from plain counts already on `releaseProgress`, never
 * a fabricated percentage. `null` when `releaseProgress` itself is `null` (no cycle, or
 * unauthorized) — the caller renders nothing in that case rather than a broken sentence fragment. */
export function cycleOperationalContext(progress: DashboardReleaseProgress | null): string | null {
  if (!progress) return null;
  return `${formatNumber(progress.releasedCount)} of ${formatNumber(progress.totalCount)} entries released`;
}

/** Release Progress stat card's own headline value — "39 / 42 released". */
export function releaseProgressSummaryText(progress: DashboardReleaseProgress): string {
  return `${formatNumber(progress.releasedCount)} / ${formatNumber(progress.totalCount)} released`;
}

/** Release Progress stat card's own muted sub-line — only the buckets that are actually nonzero,
 * so a fully-released cycle doesn't show a redundant "0 pending · 0 held". */
export function releaseProgressSubtext(progress: DashboardReleaseProgress): string {
  const parts: string[] = [];
  if (progress.pendingCount > 0) parts.push(`${formatNumber(progress.pendingCount)} pending`);
  if (progress.heldCount > 0) parts.push(`${formatNumber(progress.heldCount)} held`);
  return parts.length > 0 ? parts.join(' · ') : 'All entries released';
}

export interface DashboardAttentionCategoryLabel {
  title: string;
  description: string;
}

/** Frozen V1 categories only (§15) — no fourth category, never a task queue. */
export const DASHBOARD_ATTENTION_LABELS: Record<'heldEntries' | 'pendingCorrections' | 'recoveryDue', DashboardAttentionCategoryLabel> = {
  heldEntries: {
    title: 'Held Entries',
    description: 'Payroll entries currently on hold in the active cycle, not yet released.',
  },
  pendingCorrections: {
    title: 'Pending Corrections',
    description: 'Correction requests awaiting review.',
  },
  recoveryDue: {
    title: 'Recovery Due',
    description: 'Active advances with an outstanding balance still to be recovered.',
  },
};

/** Deep-link targets (§16) — every route already exists; Dashboard never invents a detail screen of
 * its own. Cycle-scoped destinations fall back to the flat (cycle-selector-driven) route when no
 * current cycle is resolved, mirroring every other cycle-aware page's own flat-route fallback. */
export function dashboardDeepLinks(cycleId: string | undefined) {
  return {
    employeeRegistry: '/employees',
    payrollSummary: cycleId ? `/payroll-cycles/${cycleId}/reports/payroll-summary` : '/reports/payroll-summary',
    salaryRelease: cycleId ? `/payroll-cycles/${cycleId}/reports/salary-release` : '/reports/salary-release',
    deductionReport: cycleId ? `/payroll-cycles/${cycleId}/reports/deduction-report` : '/reports/deduction-report',
    advanceRecovery: '/reports/advance-recovery',
    corrections: '/corrections',
  } as const;
}
