import { Badge } from '@/components/ui/badge';
import {
  formatCycleLabel,
  formatCycleOptionLabel,
  formatCycleStatusLabel,
  type PayrollCycle,
} from '@/hooks/use-payroll-cycles';

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

/**
 * The shared Historical Payroll Cycle Selector (Phase 5 Checkpoint 4 architecture review, §9) —
 * two small pieces, not one rigid block, so each page composes them into its own existing
 * `CardHeader` layout rather than being forced into a new one:
 *
 * - `PayrollCycleStatusBadge` — the label-line badge every page already showed in some form
 *   (`"July 2026"` or `"July 2026 · DRAFT"`), now consistent everywhere: label + status, always.
 * - `PayrollCycleSelectField` — the `<select>` itself. Newest-first (the list's own existing
 *   order), keyboard-accessible via native `<select>` semantics, no search or virtualization —
 *   this codebase's cycle count stays in the dozens even after years of operation, not thousands.
 *
 * No page-specific filter (Site/Bank/Unit/search) belongs in either piece — those stay owned by
 * each page, exactly as before.
 */
export function PayrollCycleStatusBadge({ cycle }: { cycle: Pick<PayrollCycle, 'year' | 'month' | 'status'> }) {
  return (
    <Badge tone={cycle.status === 'DRAFT' ? 'green' : cycle.status === 'RELEASED' ? 'blue' : 'gray'}>
      {formatCycleLabel(cycle)} · {formatCycleStatusLabel(cycle.status)}
    </Badge>
  );
}

export function PayrollCycleSelectField({
  id,
  cycles,
  selectedCycleId,
  onSelect,
}: {
  id: string;
  cycles: PayrollCycle[];
  selectedCycleId: string | undefined;
  onSelect: (cycleId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted" htmlFor={id}>
        Cycle
      </label>
      <select
        id={id}
        className={selectClassName}
        value={selectedCycleId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {cycles.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {formatCycleOptionLabel(cycle)}
          </option>
        ))}
      </select>
    </div>
  );
}
