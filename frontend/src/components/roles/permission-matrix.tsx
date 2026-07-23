import { useMemo } from 'react';
import type { PermissionCatalogEntry } from '@/hooks/use-roles';
import { groupPermissionCatalog } from '@/lib/permission-catalog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

/**
 * Administration & Security Management Phase 1 — the shared, reusable permission-matrix editor
 * used by both the Create Role and Edit Role forms (never duplicated between them). Grouped by
 * `PermissionCatalogEntry.group` (a presentational label only — `PERMISSION_GROUPS`,
 * shared/src/constants/permissions.ts); every value this component reads or writes is a real
 * permission `key`, never a role name or a hardcoded preset, so this component has no notion of
 * "Payroll Staff" or "Finance" at all.
 */
export function PermissionMatrix({
  catalog,
  selectedKeys,
  onChange,
  disabled = false,
}: {
  catalog: PermissionCatalogEntry[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}) {
  const groups = useMemo(() => groupPermissionCatalog(catalog), [catalog]);

  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  function toggleOne(key: string, checked: boolean) {
    if (disabled) return;
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onChange(Array.from(next));
  }

  function setGroup(keys: string[], checked: boolean) {
    if (disabled) return;
    const next = new Set(selected);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-text-muted" aria-live="polite">
        {selected.size} permission{selected.size === 1 ? '' : 's'} selected
      </p>
      {/* UAT Defect 2 correction — this used to be its own independently max-height-capped,
          independently scrolling region nested inside ModalContent's own scroll region
          (components/ui/modal.tsx), which is what produced the reported double-scrollbar/
          "excessive empty scrolling" bug. ModalContent now provides exactly one scroll region for
          the whole dialog body; this is a plain, unconstrained block within it. */}
      <div className="flex flex-col gap-4 pr-1">
        {groups.map(([group, entries]) => {
          const groupKeys = entries.map((e) => e.key);
          const selectedInGroup = groupKeys.filter((k) => selected.has(k)).length;
          const allSelected = selectedInGroup === groupKeys.length;
          const noneSelected = selectedInGroup === 0;

          return (
            <fieldset key={group} className="rounded border border-border p-3">
              <legend className="flex w-full items-center justify-between gap-2 px-1 text-xs font-semibold text-text">
                {group}
                <span className="flex items-center gap-1.5 text-[11px] font-normal text-text-muted">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={disabled || allSelected}
                    onClick={() => setGroup(groupKeys, true)}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={disabled || noneSelected}
                    onClick={() => setGroup(groupKeys, false)}
                  >
                    Clear
                  </Button>
                </span>
              </legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {entries.map((entry) => (
                  <label key={entry.key} className="flex items-center gap-2 text-xs text-text">
                    <Checkbox
                      checked={selected.has(entry.key)}
                      disabled={disabled}
                      onCheckedChange={(checked) => toggleOne(entry.key, checked === true)}
                      aria-label={entry.label}
                    />
                    {entry.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
