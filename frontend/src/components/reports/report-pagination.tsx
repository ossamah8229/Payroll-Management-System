import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Phase 8B Checkpoint 1 — the Reports module's own minimal server-side pagination control (Phase 8A
 * investigation report §10/§15.2: no generic pagination UI exists anywhere in this codebase today;
 * every existing list screen either renders its full filtered result set or fetches every page behind
 * the scenes and flattens it client-side). Deliberately scoped to `components/reports/`, mirroring
 * the backend's own `reports/reports-pagination.ts` — a second report needing the same control can
 * import this directly; a genuine cross-module need can be promoted later (no premature
 * `components/ui/pagination.tsx` abstraction this checkpoint doesn't have a second caller for yet).
 *
 * Print-hidden (`print:hidden`) — pagination controls describe an on-screen browsing affordance, not
 * something a printed report needs to show, matching every other print-enabled page's identical
 * treatment of its own filter/selection controls.
 */
export function ReportPagination({
  page,
  pageSize,
  total,
  onPageChange,
  disabled = false,
  // v1.0.4 Advances Scalability checkpoint — this control's row-count label was hardcoded to "site(s)"
  // (Payroll Summary was its only caller, whose pagination unit genuinely is Project Site). A second
  // caller (the Advances page, whose rows are Advances) needs its own noun. `itemLabelPlural` is
  // always the plural form (e.g. "sites"/"advances") — the singular is derived by stripping the
  // trailing "s", matching the original hardcoded "site"/"sites" split exactly, so the default
  // preserves every existing caller's rendered text byte-for-byte.
  itemLabelPlural = 'sites',
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  itemLabelPlural?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  const itemLabel = total === 1 ? itemLabelPlural.slice(0, -1) : itemLabelPlural;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-[18px] py-2.5 print:hidden">
      <p className="text-[11px] text-text-muted">
        {total === 0 ? `No ${itemLabelPlural}` : `Showing ${rangeStart}–${rangeEnd} of ${total} ${itemLabel}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Previous
        </Button>
        <span className="text-[11px] text-text-muted">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
