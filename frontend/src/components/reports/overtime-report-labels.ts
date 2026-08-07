import type { OvertimeReportRowStatus } from '@payroll/shared';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Overtime Report Checkpoint 1B — pure label/tone lookups over the backend's own derived
 * `rowStatus` (identical 5-state union to every other row-level report in this module). This
 * frontend never re-derives it, only decides how the already-derived value is displayed. Mirrors
 * `deduction-report-labels.ts`'s own tone mapping exactly, so the same status always reads the same
 * color across every report in this module.
 *
 * No `primaryUnitLabel` helper exists here, unlike Deduction Report/Project Site Payroll Report —
 * this report's grain is `PayrollEntryWorkLine`, so each row already carries its own single, direct
 * `unit` (never a "primary unit + N more" summary of several work lines collapsed into one row).
 */

const ROW_STATUS_LABELS: Record<OvertimeReportRowStatus, string> = {
  RELEASED: 'Released',
  HELD: 'Held',
  NO_PAY_DUE: 'No Pay Due',
  RECOVERY_DUE: 'Recovery Due',
  PENDING: 'Pending',
};

export function rowStatusLabel(status: OvertimeReportRowStatus): string {
  return ROW_STATUS_LABELS[status];
}

/** Five distinct semantic tones — never color alone, every caller renders the tone alongside
 * `rowStatusLabel`'s own text label. */
export function rowStatusTone(status: OvertimeReportRowStatus): NonNullable<BadgeProps['tone']> {
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
