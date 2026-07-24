import { useEffect, useMemo, useRef } from 'react';
import { createColumnHelper, getCoreRowModel, useReactTable, flexRender } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PayrollCycle } from '@/hooks/use-payroll-cycles';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import type { Bank } from '@/hooks/use-banks';
import { PAYROLL_COLUMNS, computeColumnWidths, gridTemplateColumns, totalGridWidth, type ResolvedPayrollColumnDef } from './columns';
import { PayrollEntryRow, ROW_HEIGHT } from './payroll-entry-row';
import { PayrollEntryTotalsRow } from './payroll-entry-totals-row';
import { LiveTotalsStore } from './live-totals-store';
import { computeServerSnapshot } from './calc-input';
import { useGridKeyboardNav } from './use-grid-keyboard-nav';

const columnHelper = createColumnHelper<PayrollEntry>();
const GROUP_ROW_HEIGHT = 22;
const HEADER_ROW_HEIGHT = 30;

/** Contiguous grouped header spans ("Bank Details", "EOBI") computed once from the *resolved*
 * (already width-measured) column array — a lighter-weight approach than TanStack Table's
 * nested-grouped-column API, since the grouping here is purely a visual label row, not a
 * structural pivot. Takes `resolvedColumns` as a parameter (rather than reading the static
 * `PAYROLL_COLUMNS` directly) so a group's span always reflects the same dynamically-computed
 * widths every other layer uses — never a second, independently-sized copy. */
function computeGroupSpans(resolvedColumns: ResolvedPayrollColumnDef[]) {
  const spans: { label: string; width: number }[] = [];
  let i = 0;
  while (i < resolvedColumns.length) {
    const column = resolvedColumns[i]!;
    if (!column.group) {
      spans.push({ label: '', width: column.width });
      i += 1;
      continue;
    }
    let width = 0;
    while (i < resolvedColumns.length && resolvedColumns[i]!.group === column.group) {
      width += resolvedColumns[i]!.width;
      i += 1;
    }
    spans.push({ label: column.group, width });
  }
  return spans;
}

export function PayrollEntryGrid({
  cycle,
  entries,
  banks,
  canCorrect,
  onCreateCorrection,
  onViewCorrectionHistory,
}: {
  cycle: PayrollCycle;
  entries: PayrollEntry[];
  banks: Bank[];
  canCorrect: boolean;
  onCreateCorrection: (entry: PayrollEntry) => void;
  onViewCorrectionHistory: (entry: PayrollEntry) => void;
}) {
  const liveTotalsStore = useMemo(() => new LiveTotalsStore(), []);
  const containerRef = useRef<HTMLDivElement>(null);

  // Seeds/refreshes every entry's totals contribution, including the ~475-out-of-503 rows (at
  // this checkpoint's tested scale) the virtualizer has never mounted — without this, the totals
  // row would silently only ever sum whatever's currently rendered on screen. Safe to call on
  // every `entries` change (any row's autosave produces a new array reference): `setBase` never
  // overwrites a row that's currently being actively edited (see live-totals-store.ts).
  useEffect(() => {
    liveTotalsStore.setBase(entries.map((entry) => ({ id: entry.id, snapshot: computeServerSnapshot(entry) })));
  }, [entries, liveTotalsStore]);

  // TanStack Table drives column/header structure and the row model the virtualizer scrolls over
  // (tech-stack.md: "sorting/filtering hooks, per-cell editing, and — critically — integrates with
  // row virtualization"). Body rows render via a single custom component per row rather than one
  // TanStack cell renderer per column, since each row's edit/autosave state (`usePayrollEntryEditor`)
  // is one stateful hook shared across every cell in that row — splitting it per-cell would mean
  // duplicate, conflicting editors autosaving the same row independently.
  const columns = useMemo(
    () => PAYROLL_COLUMNS.map((c) => columnHelper.accessor((row) => row.id, { id: c.id, header: c.label })),
    [],
  );

  const table = useReactTable({
    data: entries,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const { handleKeyDown } = useGridKeyboardNav(containerRef, rowVirtualizer, rows.length);

  // The one shared dynamic column-sizing calculation (Layout Integrity Rule, corrected
  // 2026-07-13) — inspects the *full* loaded `entries` array, not just whichever rows the
  // virtualizer currently has mounted, so a long value scrolled out of view still gets its column
  // the width it needs. Recomputed only when the loaded dataset or bank list actually changes
  // (never per keystroke — draft edits live in each row's own `usePayrollEntryEditor`, not here),
  // then reused as-is by the grouped header, the column header, every body row, and the totals
  // row below — one calculation, four layers, always pixel-aligned.
  const resolvedColumns = useMemo(() => computeColumnWidths(entries, banks), [entries, banks]);
  const gridTemplate = useMemo(() => gridTemplateColumns(resolvedColumns), [resolvedColumns]);
  const groupSpans = useMemo(() => computeGroupSpans(resolvedColumns), [resolvedColumns]);
  const width = totalGridWidth(resolvedColumns);
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/*
       * A single scroll container for header, body, and totals row together — horizontal scroll
       * must move all three in lockstep, which only works if they share one scrolling ancestor.
       * The header (top) and totals row (bottom) are pinned via `position: sticky` on the
       * *vertical* axis only, so they still pan horizontally with the body instead of living in a
       * separately-scrolled element that could drift out of column alignment.
       */}
      <div
        ref={containerRef}
        onKeyDown={handleKeyDown}
        role="table"
        aria-label="Payroll Entry grid"
        aria-rowcount={rows.length}
        className="max-h-[70vh] overflow-auto"
      >
        <div style={{ width, minWidth: '100%' }}>
          <div
            className="sticky top-0 z-20 flex border-b border-border bg-surface"
            style={{ width, height: GROUP_ROW_HEIGHT }}
          >
            {groupSpans.map((span, i) => (
              <div
                key={i}
                style={{ width: span.width }}
                className="truncate px-1.5 py-1 text-center text-[9.5px] font-semibold uppercase tracking-wide text-text-muted"
              >
                {span.label}
              </div>
            ))}
          </div>

          {table.getHeaderGroups().map((headerGroup) => (
            <div
              role="row"
              key={headerGroup.id}
              className="sticky z-20 grid border-b border-border bg-surface"
              style={{ top: GROUP_ROW_HEIGHT, gridTemplateColumns: gridTemplate, width, height: HEADER_ROW_HEIGHT }}
            >
              {headerGroup.headers.map((header) => (
                <div
                  role="columnheader"
                  key={header.id}
                  data-col-id={header.column.id}
                  className="truncate px-1.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </div>
              ))}
            </div>
          ))}

          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width }}>
            {virtualItems.map((virtualRow) => {
              const entry = rows[virtualRow.index]!.original;
              return (
                <PayrollEntryRow
                  key={entry.id}
                  entry={entry}
                  rowIndex={virtualRow.index}
                  cycleId={cycle.id}
                  cycleStatus={cycle.status}
                  banks={banks}
                  liveTotalsStore={liveTotalsStore}
                  gridTemplateColumns={gridTemplate}
                  canCorrect={canCorrect}
                  onCreateCorrection={onCreateCorrection}
                  onViewCorrectionHistory={onViewCorrectionHistory}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                />
              );
            })}
          </div>

          <div className="sticky bottom-0 z-20" style={{ width }}>
            <PayrollEntryTotalsRow store={liveTotalsStore} gridTemplateColumns={gridTemplate} />
          </div>
        </div>
      </div>
    </div>
  );
}
