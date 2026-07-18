import type {
  BalanceAdjustmentStatus,
  BalanceAdjustmentType,
  CorrectionField,
  CorrectionRequestStatus,
} from '@payroll/shared';
import type { BadgeProps } from '@/components/ui/badge';

/** Pure label/tone lookups — no rendering, so these are unit-testable directly (this codebase's
 * own convention: `vitest.config.ts` only collects `*.test.ts`, deterministic logic gets a
 * co-located test, component rendering is left to Playwright). Every `CorrectionField` value the
 * backend's `correctionFieldSchema` (`@payroll/shared`) accepts must have an entry here — an
 * unmapped field falls back to its raw enum string rather than throwing, so a future backend field
 * addition never breaks this page, it just displays less prettily until this map catches up. */
const FIELD_LABELS: Record<CorrectionField, string> = {
  GROSS_PAY: 'Gross Pay',
  DAYS: 'Days',
  OT_HOURS: 'OT Hours',
  OT_RATE: 'OT Rate',
  ALLOWANCE: 'Allowance',
  LEAVE_DAYS: 'Leave Days',
  LEAVE_RATE: 'Leave Rate',
  CYCLE_DAYS: 'Cycle Days',
  EOBI_AMOUNT: 'EOBI Amount',
  EOBI_APPLICABLE: 'EOBI Applicable',
  ADVANCE_DEDUCTION: 'Advance Deduction',
  EID_ADVANCE_DEDUCTION: 'Eid Advance Deduction',
  FINE: 'Fine',
};

export function correctionFieldLabel(field: CorrectionField | string): string {
  return FIELD_LABELS[field as CorrectionField] ?? field;
}

/** `EOBI_APPLICABLE` is the one boolean-valued field (`"true"`/`"false"` wire strings, per
 * `corrections.ts` schema's own doc comment) — every other field is a decimal/integer amount. */
export function isBooleanCorrectionField(field: CorrectionField): boolean {
  return field === 'EOBI_APPLICABLE';
}

export function correctionRequestStatusTone(status: CorrectionRequestStatus): NonNullable<BadgeProps['tone']> {
  if (status === 'PENDING') return 'amber';
  if (status === 'APPROVED') return 'green';
  return 'red'; // REJECTED
}

export function balanceAdjustmentStatusTone(status: BalanceAdjustmentStatus): NonNullable<BadgeProps['tone']> {
  return status === 'SETTLED' ? 'green' : 'amber';
}

/** Deliberately not color-only (docs/architecture accessibility rule, restated in this
 * checkpoint's own brief: "status is not communicated by color alone") — every caller renders
 * this tone alongside the type's own text label ("Payable"/"Recovery"), never the badge alone. */
export function balanceAdjustmentTypeTone(type: BalanceAdjustmentType): NonNullable<BadgeProps['tone']> {
  if (type === 'PAYABLE') return 'blue';
  if (type === 'RECOVERY') return 'purple';
  return 'gray'; // NONE
}

export function balanceAdjustmentTypeLabel(type: BalanceAdjustmentType): string {
  if (type === 'PAYABLE') return 'Payable';
  if (type === 'RECOVERY') return 'Recovery';
  return 'None';
}

export function materializationStatusTone(status: 'ACTIVE' | 'CONSUMED' | 'CANCELLED'): NonNullable<BadgeProps['tone']> {
  if (status === 'ACTIVE') return 'amber';
  if (status === 'CONSUMED') return 'green';
  return 'gray'; // CANCELLED
}

export function cyclePeriodLabel(cycle: { year: number; month: number } | null | undefined): string {
  if (!cycle) return '—';
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${MONTH_NAMES[cycle.month - 1]} ${cycle.year}`;
}

/** `remainingAmount - activeReservedAmount`, the exact settlement-side ceiling
 * `corrections.settlement.ts`'s own `calculateSettlement` enforces server-side (Checkpoint 5A) —
 * reproduced here **only** for display (a label showing what's available, not a value ever sent
 * back to the server or used to gate a submit client-side; the server's own fresh transactional
 * check remains the sole authority, per this checkpoint's own "Preview is advisory" rule). Callers
 * must pass both figures from already-fetched backend data, never estimate either one. */
export function availableForStandaloneSettlement(remainingAmount: string, activeReservedAmount: string): string {
  const remaining = Number(remainingAmount);
  const reserved = Number(activeReservedAmount);
  return (remaining - reserved).toFixed(2);
}
