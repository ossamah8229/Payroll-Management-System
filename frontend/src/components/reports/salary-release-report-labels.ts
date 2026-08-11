import type { SalaryReleaseReportRow, SalaryReleaseReportRowStatus } from '@payroll/shared';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Salary Release Report Checkpoint 1B — pure label/tone lookups over the backend's own derived
 * `rowStatus` (identical 5-state union to every other row-level report in this module). This
 * frontend never re-derives it, only decides how the already-derived value is displayed. Mirrors
 * `deduction-report-labels.ts`'s own tone mapping exactly, so the same status always reads the same
 * color across every report in this module.
 */

const ROW_STATUS_LABELS: Record<SalaryReleaseReportRowStatus, string> = {
  RELEASED: 'Released',
  HELD: 'Held',
  NO_PAY_DUE: 'No Pay Due',
  RECOVERY_DUE: 'Recovery Due',
  PENDING: 'Pending',
};

export function rowStatusLabel(status: SalaryReleaseReportRowStatus): string {
  return ROW_STATUS_LABELS[status];
}

/** Five distinct semantic tones — never color alone, every caller renders the tone alongside
 * `rowStatusLabel`'s own text label. */
export function rowStatusTone(status: SalaryReleaseReportRowStatus): NonNullable<BadgeProps['tone']> {
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
 * backend already batched (never a client-side recount of the entry's own work lines). Display only,
 * never a per-Unit financial allocation. */
export function primaryUnitLabel(row: Pick<SalaryReleaseReportRow, 'primaryUnit' | 'additionalUnitCount'>): string {
  const base = row.primaryUnit?.name ?? '—';
  return row.additionalUnitCount > 0 ? `${base} (+${row.additionalUnitCount} more)` : base;
}
