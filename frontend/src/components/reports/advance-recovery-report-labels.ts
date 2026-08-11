import type { AdvanceRecoveryReportRowStatus, AdvanceStatus, AdvanceType, AdvanceRepaymentType } from '@payroll/shared';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Advance Recovery Report Checkpoint 1B — pure label/tone lookups. A fresh, report-owned file (every
 * report module in this app keeps its own `*-report-labels.ts` rather than importing the source
 * domain page's inline helpers), but the actual label text/tone choices mirror `advances-page.tsx`'s
 * own inline `typeLabel`/`statusTone`/`statusLabel` exactly, so the same Advance always reads with
 * the same color/wording whether viewed on the Advances page or in this report.
 */

export function advanceTypeLabel(type: AdvanceType): string {
  return type === 'LOAN' ? 'Advance' : 'Eid Advance';
}

export function advanceStatusLabel(status: AdvanceStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'CANCELLED':
      return 'Cancelled';
    case 'RESERVED':
      return 'Reserved (pending release)';
    case 'PAID_OFF':
      return 'Paid Off';
  }
}

export function advanceStatusTone(status: AdvanceStatus): NonNullable<BadgeProps['tone']> {
  switch (status) {
    case 'ACTIVE':
      return 'green';
    case 'CANCELLED':
      return 'red';
    case 'RESERVED':
      return 'amber';
    case 'PAID_OFF':
      return 'gray';
  }
}

export function repaymentTypeLabel(type: AdvanceRepaymentType): string {
  return type === 'FULL_DEDUCTION' ? 'Full Deduction' : 'Installment';
}

/** The detail page's own Recovery History `rowStatus` (the linked `PayrollEntry`'s derived status)
 * — the identical 5-state union every row-level report in this module shares. Independently declared
 * per this module's own "no confusing cross-report type reference in a public DTO" convention, so the
 * label/tone mapping is duplicated here rather than imported from a sibling report's own labels file. */
const ROW_STATUS_LABELS: Record<AdvanceRecoveryReportRowStatus, string> = {
  RELEASED: 'Released',
  HELD: 'Held',
  NO_PAY_DUE: 'No Pay Due',
  RECOVERY_DUE: 'Recovery Due',
  PENDING: 'Pending',
};

export function rowStatusLabel(status: AdvanceRecoveryReportRowStatus): string {
  return ROW_STATUS_LABELS[status];
}

export function rowStatusTone(status: AdvanceRecoveryReportRowStatus): NonNullable<BadgeProps['tone']> {
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
