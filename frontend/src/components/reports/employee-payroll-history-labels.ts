import type { EmployeePayrollHistoryRosterStatus, EmployeePayrollHistoryRow, EmployeePayrollHistoryRowStatus } from '@payroll/shared';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * Employee Payroll History Checkpoint 1B — pure label/tone lookups over the backend's own derived
 * `rowStatus`/`currentEmployeeRosterStatus` enums (this codebase's own convention: deterministic
 * logic gets a colocated unit test, `correction-labels.ts`/`statement-labels.ts`). The frontend
 * never re-derives `rowStatus` itself (Step 7: "Do not derive status client-side") — these
 * functions only decide how the backend's own already-derived value is *displayed*.
 */

const ROW_STATUS_LABELS: Record<EmployeePayrollHistoryRowStatus, string> = {
  RELEASED: 'Released',
  HELD: 'Held',
  NO_PAY_DUE: 'No Pay Due',
  RECOVERY_DUE: 'Recovery Due',
  PENDING: 'Pending',
};

export function rowStatusLabel(status: EmployeePayrollHistoryRowStatus): string {
  return ROW_STATUS_LABELS[status];
}

/** Five distinct semantic tones (Step 7) — never color alone, every caller renders the tone
 * alongside `rowStatusLabel`'s own text label. */
export function rowStatusTone(status: EmployeePayrollHistoryRowStatus): NonNullable<BadgeProps['tone']> {
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

export function rosterStatusLabel(status: EmployeePayrollHistoryRosterStatus): string {
  return status === 'ACTIVE' ? 'Active' : 'Departed';
}

/** `"Site A HQ (+2 more)"`-style primary-unit label — `additionalUnitCount` is a plain integer the
 * backend already batched (never a client-side recount of the entry's own work lines). */
export function primaryUnitLabel(row: Pick<EmployeePayrollHistoryRow, 'primaryUnit' | 'additionalUnitCount'>): string {
  const base = row.primaryUnit?.name ?? '—';
  return row.additionalUnitCount > 0 ? `${base} (+${row.additionalUnitCount} more)` : base;
}
