import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBulkUpdatePayrollEntries } from '@/hooks/use-payroll-entries';
import { isValidDecimalDraft, parseValidCycleDays } from './numeric-validation';

type BulkField = 'cycleDays' | 'otRate' | 'leaveRate';

const FIELDS: { field: BulkField; label: string; placeholder: string }[] = [
  { field: 'cycleDays', label: 'Cycle Days', placeholder: 'e.g. 30' },
  { field: 'otRate', label: 'OT Rate', placeholder: 'e.g. 150' },
  { field: 'leaveRate', label: 'Leave Rate', placeholder: 'e.g. 1000' },
];

function isValidDraft(field: BulkField, value: string): boolean {
  if (value === '') return false;
  return field === 'cycleDays' ? parseValidCycleDays(value) !== undefined : isValidDecimalDraft(value, false);
}

/**
 * "Copy to All" (Phase 3 Checkpoint 4, `reference/PROJECT_SPEC.md` item 6) — pushes Cycle Days /
 * OT Rate / Leave Rate to every currently-filtered employee's Payroll Entry in one click, via the
 * dedicated bulk endpoint (never a loop of individual row PATCHes). Cycle Days/OT Rate apply only
 * to each entry's primary work line (frozen 2026-07-09 decision) — the same field a split entry's
 * grid columns already represent; non-primary lines stay reachable only through the Split by
 * {unitLabel} modal.
 *
 * Deliberately requires at least one site to be explicitly selected in the filter above — the grid
 * itself may display "every site" when unfiltered, but a bulk mutation's scope must always be a
 * deliberate selection, never implicitly "everyone in the cycle" (mirrored server-side by
 * `bulkUpdatePayrollEntriesSchema`'s non-empty `siteIds` requirement).
 */
export function CopyToAllToolbar({ cycleId, siteIds }: { cycleId: string; siteIds: string[] }) {
  const bulkUpdate = useBulkUpdatePayrollEntries(cycleId);
  const [drafts, setDrafts] = useState<Record<BulkField, string>>({
    cycleDays: '',
    otRate: '',
    leaveRate: '',
  });

  const noSiteSelected = siteIds.length === 0;

  async function handleApply(field: BulkField) {
    const raw = drafts[field];
    if (!isValidDraft(field, raw)) return;

    try {
      const result = await bulkUpdate.mutateAsync(
        field === 'cycleDays'
          ? { siteIds, field, value: parseValidCycleDays(raw)! }
          : { siteIds, field, value: raw },
      );
      toast.success(`Applied to ${result.appliedCount} of ${result.matchedCount} employee(s)`);
      setDrafts((prev) => ({ ...prev, [field]: '' }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not apply the bulk update');
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-dashed border-border bg-surface-2 px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Bulk apply to filtered employees
      </span>
      {noSiteSelected && (
        <p className="text-xs text-text-muted">Select at least one site above to enable bulk apply.</p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        {FIELDS.map(({ field, label, placeholder }) => (
          <div key={field} className="flex items-end gap-1.5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`bulk-${field}`}>{label}</Label>
              <Input
                id={`bulk-${field}`}
                className="w-28"
                placeholder={placeholder}
                value={drafts[field]}
                disabled={noSiteSelected || bulkUpdate.isPending}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [field]: e.target.value }))}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={noSiteSelected || bulkUpdate.isPending || !isValidDraft(field, drafts[field])}
              onClick={() => void handleApply(field)}
            >
              Copy to All
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
