import { ChevronDown } from 'lucide-react';
import { pluralize } from '@payroll/shared';
import { cn } from '@/lib/cn';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface MultiSelectOption {
  id: string;
  label: string;
}

/**
 * A generic, domain-agnostic multi-select checkbox filter (`reference/PROJECT_SPEC.md` item 10:
 * "filtering must support multi-select... an Excel-like filter... implemented as a checkbox
 * multi-select dropdown"). Deliberately not Payroll-Entry-specific — Phase 3 Checkpoint 4 is its
 * first caller (as a Site filter), but the same spec item names Release Salary and the Fines/EOBI
 * report as later callers of exactly this same filter, so no Payroll-Entry-only assumption belongs
 * in this component; callers supply `options`/`label`/`selectedIds`/`onChange` and own everything
 * domain-specific themselves.
 *
 * An empty `selectedIds` means "no filter applied — show everything," matching this app's existing
 * backend convention for an omitted site filter (`payroll-entry.service.ts`'s `listPayrollEntries`:
 * no `siteId` means the caller's full accessible scope, never zero rows).
 */
export function MultiSelectFilter({
  id,
  label,
  options,
  selectedIds,
  onChange,
}: {
  id: string;
  label: string;
  options: MultiSelectOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const selectedSet = new Set(selectedIds);

  function toggle(optionId: string) {
    onChange(
      selectedSet.has(optionId) ? selectedIds.filter((existing) => existing !== optionId) : [...selectedIds, optionId],
    );
  }

  const pluralLabel = pluralize(label);
  const triggerLabel =
    selectedIds.length === 0
      ? `All ${pluralLabel}`
      : selectedIds.length === 1
        ? (options.find((option) => option.id === selectedIds[0])?.label ?? `1 ${label}`)
        : `${selectedIds.length} ${pluralLabel}`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              'flex h-9 w-56 items-center justify-between rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none transition-colors',
              'hover:border-border-strong focus:border-accent-mid focus:ring-2 focus:ring-accent-light',
            )}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          {selectedIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-2 py-1.5 text-left text-xs font-medium text-accent-mid hover:bg-bg"
              >
                Clear filter
              </button>
              <DropdownMenuSeparator />
            </>
          )}
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-text-muted">Nothing to filter by</p>
          ) : (
            options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={selectedSet.has(option.id)}
                onCheckedChange={() => toggle(option.id)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
