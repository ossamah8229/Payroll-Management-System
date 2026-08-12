import * as React from 'react';
import { formatMoney } from '@payroll/shared';
import { cn } from '@/lib/cn';

/** Shared keyboard-navigation addressing — every editable cell carries its grid position so the
 * grid's single delegated keydown handler can move focus between cells (Up/Down/Enter), including
 * across virtualization boundaries (see `use-grid-keyboard-nav.ts`). */
export interface GridNavProps {
  'data-grid-row': number;
  'data-grid-col': string;
}

export function gridNavProps(row: number, col: string): GridNavProps {
  return { 'data-grid-row': row, 'data-grid-col': col };
}

const baseInputClassName =
  'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-text outline-none transition-colors placeholder:text-text-faint hover:border-border focus:border-accent-mid focus:ring-1 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-transparent';

interface InlineTextCellProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  align?: 'left' | 'right' | 'center';
  maxLength?: number;
  nav: GridNavProps;
  ariaLabel: string;
}

export function InlineTextCell({
  value,
  onChange,
  disabled,
  placeholder,
  align = 'left',
  maxLength,
  nav,
  ariaLabel,
}: InlineTextCellProps) {
  return (
    <input
      type="text"
      className={cn(baseInputClassName, align === 'right' && 'text-right', align === 'center' && 'text-center')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-label={ariaLabel}
      {...nav}
    />
  );
}

interface InlineNumberCellProps {
  /** Decimal string, per this codebase's wire-format convention — never a native number, to avoid
   * float precision issues before the value ever reaches `calcNet`. Empty string is a valid value
   * for nullable rate fields (OT Rate / Leave Rate), meaning "auto-derive". */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  deduct?: boolean;
  /** The current text doesn't parse into a value that can be saved yet (e.g. `"-"`, `"."`,
   * `"abc"`, or an empty required field) — a purely visual cue while the user is still typing;
   * never blocks typing itself, and the value is simply not sent until it becomes valid (see
   * `usePayrollEntryEditor`'s `sanitizeEntryDraft`/`sanitizeWorkLineDraft`). */
  invalid?: boolean;
  /** Tighter vertical padding (Advance Balance presentation fix, 2026-07-30) — used only when this
   * cell also stacks a `BalanceLabel` beneath it (`advanceDeduction`/`eidAdvanceDeduction`), so the
   * combined two-line block has genuine headroom within the fixed 40px row instead of its content
   * height consuming the row almost exactly, which left the balance line touching the row border.
   * Every other numeric cell keeps the default `py-1`. */
  compact?: boolean;
  nav: GridNavProps;
  ariaLabel: string;
}

/** Numeric alignment is a strict convention here (docs/design-system.md §1.2), not a preference —
 * always right-aligned, always tabular-nums. `.deduct` tints red for deduction-type fields
 * (Advance/Eid Advance/Fine). */
export function InlineNumberCell({
  value,
  onChange,
  disabled,
  placeholder,
  deduct,
  invalid,
  compact,
  nav,
  ariaLabel,
}: InlineNumberCellProps) {
  return (
    <input
      type="text"
      inputMode="decimal"
      className={cn(
        baseInputClassName,
        'text-right tabular-nums',
        compact && 'py-0.5',
        deduct && 'text-danger',
        invalid && 'border-danger bg-danger-light/40 focus:border-danger',
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={invalid ? `${ariaLabel} (not yet a valid value)` : ariaLabel}
      aria-invalid={invalid || undefined}
      {...nav}
    />
  );
}

interface InlineSelectCellProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  options: { value: string; label: string }[];
  nav: GridNavProps;
  ariaLabel: string;
}

export function InlineSelectCell({ value, onChange, disabled, options, nav, ariaLabel }: InlineSelectCellProps) {
  return (
    <select
      className={cn(baseInputClassName, 'cursor-pointer')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      {...nav}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ReadOnlyCell({
  children,
  colId,
  align = 'left',
  muted = true,
  truncate = true,
  className,
  style,
}: {
  children: React.ReactNode;
  /** The `PAYROLL_COLUMNS` id this cell renders — same `data-col-id` convention every other cell in
   * the row carries, so header/body/totals alignment stays mechanically verifiable (Operational
   * Stabilization Checkpoint, 2026-07-24). Every current caller (`payroll-entry-row.tsx`) supplies
   * it; optional only so a future usage without a meaningful column id doesn't need a placeholder
   * value. */
  colId?: string;
  align?: 'left' | 'right' | 'center';
  muted?: boolean;
  /** Defaults to the original ellipsis-on-overflow behavior. Set `false` for a business-critical
   * identifier the permanent Layout Integrity Rule protects (Employee Code, CNIC, ...) — ellipsis
   * is exactly the "depend on hidden overflow" this rule forbids, so those cells must render at
   * `white-space: nowrap` instead and rely on the grid's own horizontal scroll if content is ever
   * wider than its column (2026-07-12 fix: `truncate` was silently clipping Employee Code). */
  truncate?: boolean;
  /** Frozen Employee Identity Pane (UAT 2026-08-12) — lets `employeeCode`/`employeeName` layer the
   * shared `stickyIdentityCellClassName` (`columns.ts`) on top of this cell's own base styling,
   * exactly the way the sticky-right actions cell already layers its own treatment on top of its
   * base classes. `undefined` for every other caller, unchanged from before this checkpoint. */
  className?: string;
  /** Pairs with `className` above — the frozen pane's own dynamic per-column `left` pixel offset
   * (`columns.ts`'s `stickyLeftOffsets`), which can't be expressed as a static Tailwind class. */
  style?: React.CSSProperties;
}) {
  return (
    <div
      role="cell"
      data-col-id={colId}
      style={style}
      className={cn(
        'px-1.5 py-1 text-xs',
        truncate ? 'truncate' : 'overflow-visible whitespace-nowrap',
        muted ? 'text-text-muted' : 'text-text',
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Secondary monetary line under a primary editable value — currently the linked Advance/Eid
 * Advance balance under `advanceDeduction`/`eidAdvanceDeduction` (Presentation & Workflow
 * Stabilization Checkpoint, 2026-07-25), and the reusable presentation for any future
 * Balance/Remaining-style secondary figure elsewhere in this grid. Never wraps or clips — the
 * column hosting it is measured to already fit this text (`columns.ts`'s `BALANCE_LABEL_COLUMN_IDS`
 * / `extractBalanceLabelValue`, the single place that width decision is made), so `whitespace-nowrap`
 * here is a guarantee, not a truncation risk.
 *
 * `leading-none` + `mt-0` (Advance Balance presentation fix, 2026-07-30) — paired with
 * `InlineNumberCell`'s `compact` prop above, this is what gives the two-line
 * amount-plus-balance block real clearance within the fixed 40px row instead of the balance text
 * crowding/touching the row's bottom border.
 */
export function BalanceLabel({ amount }: { amount: string }) {
  return (
    <p className="mt-0 whitespace-nowrap text-center text-[10px] leading-none text-text-faint">
      Bal: {formatMoney(amount)}
    </p>
  );
}
