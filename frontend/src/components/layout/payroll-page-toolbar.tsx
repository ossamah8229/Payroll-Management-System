import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

/**
 * The shared `CardHeader` toolbar for every payroll-cycle-scoped page (Payroll Entry, Salary
 * Release, Bank Sheet, Cash Receiving, Payslips) — replaces five near-identical hand-rolled
 * header blocks (Production Stabilization — Shared Payroll Header Correction).
 *
 * `filters` are `PayrollCycleSelectField`/`MultiSelectFilter`/`FilterField` children — each
 * already shaped `flex flex-col gap-1.5` with an uppercase label above a 36px (`--control-height`)
 * control. The title/badge group and the action-button group are given that exact same shape (an
 * invisible label-height spacer above a 36px row) purely so every group's control bottom edge —
 * and visual centre line — lines up automatically, with no page-specific vertical offset.
 *
 * `justify-between` on the outer row (rather than `margin-left: auto` on `actions` alone) is
 * deliberate: when the row is too narrow and `actions` wraps onto its own line, `ml-auto` would
 * still push it to that line's right edge, stranding it behind a wide empty gap. A `justify-between`
 * parent with `filters`/`actions` as its two flex items keeps `actions` flush left on its own line
 * once wrapped, and flush right otherwise — the same "actions to the far side" result without the
 * wrap artifact.
 */
export function PayrollPageToolbar({
  title,
  badge,
  filters,
  actions,
  className,
}: {
  title: string;
  badge?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex w-full flex-wrap items-end justify-between gap-3', className)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label aria-hidden className="invisible select-none">
            spacer
          </Label>
          <div className="flex h-9 items-center gap-2.5">
            <CardTitle>{title}</CardTitle>
            {badge}
          </div>
        </div>
        {filters}
      </div>
      {actions && (
        <div className="flex flex-col gap-1.5">
          <Label aria-hidden className="invisible select-none">
            spacer
          </Label>
          <div className="flex h-9 items-center gap-2">{actions}</div>
        </div>
      )}
    </div>
  );
}
