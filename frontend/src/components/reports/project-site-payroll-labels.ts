import type { ProjectSitePayrollReportRow, ProjectSitePayrollReportRowStatus } from '@payroll/shared';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Project Site Payroll Report Checkpoint 1B — pure label/tone lookups over the backend's own
 * derived `rowStatus` (identical 5-state union to Employee Payroll History's own, §16.1 frozen
 * decision 2's "same state machine" note) — this frontend never re-derives it (Step 6: "Status must
 * come from backend. Do not rederive it client-side"), only decides how the already-derived value
 * is displayed. Mirrors `employee-payroll-history-labels.ts`'s own tone mapping exactly, so the same
 * status always reads the same color across both reports.
 */

const ROW_STATUS_LABELS: Record<ProjectSitePayrollReportRowStatus, string> = {
  RELEASED: 'Released',
  HELD: 'Held',
  NO_PAY_DUE: 'No Pay Due',
  RECOVERY_DUE: 'Recovery Due',
  PENDING: 'Pending',
};

export function rowStatusLabel(status: ProjectSitePayrollReportRowStatus): string {
  return ROW_STATUS_LABELS[status];
}

/** Five distinct semantic tones — never color alone, every caller renders the tone alongside
 * `rowStatusLabel`'s own text label. */
export function rowStatusTone(status: ProjectSitePayrollReportRowStatus): NonNullable<BadgeProps['tone']> {
  switch (status) {
    case 'RELEASED':
      return 'green';
    case 'HELD':
      return 'hold';
    case 'PENDING':
      return 'amber';
    case 'RECOVERY_DUE':
      return 'red';
    case 'NO_PAY_DUE':
      return 'gray';
  }
}

/** `"Site A HQ (+2 more)"`-style primary-unit label — `additionalUnitCount` is a plain integer the
 * backend already batched (never a client-side recount of the entry's own work lines). Frozen
 * decision 5: display only, never a per-Unit financial allocation. */
export function primaryUnitLabel(row: Pick<ProjectSitePayrollReportRow, 'primaryUnit' | 'additionalUnitCount'>): string {
  const base = row.primaryUnit?.name ?? '—';
  return row.additionalUnitCount > 0 ? `${base} (+${row.additionalUnitCount} more)` : base;
}
