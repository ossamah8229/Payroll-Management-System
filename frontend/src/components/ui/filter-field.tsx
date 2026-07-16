import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Label } from '@/components/ui/label';

/**
 * The shared label+control wrapper every filter-row field uses (Post-Phase-5 Stabilization
 * Checkpoint 2, Part 2) — `MultiSelectFilter` already established this exact shape (`flex flex-col
 * gap-1.5` + the shared `Label` component); this extracts it so every other filter field (Cycle
 * select, Bank select, Type/Status selects, Search input) stops hand-rolling its own slightly
 * different version (several used a raw `<label>` at `text-[10px]`/`gap-1` instead of `Label`'s
 * `text-[11px]`/`gap-1.5` — a few-pixel drift that, compounded across a row, is exactly what broke
 * the Payslips filter row's shared baseline in Checkpoint 1). Removes repeated page-specific
 * layout markup rather than adding a new one — every field in this row still owns its own
 * business logic (options, value, onChange); this only owns the shell.
 */
export function FilterField({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
