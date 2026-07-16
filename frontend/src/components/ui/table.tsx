import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Two-tier table-density system (Post-Phase-5 Stabilization Checkpoint 2, Part 3,
 * docs/design-system.md §1.5) — `density="standard"` for management/selection lists (Employees,
 * Users, Sites, Units, Tasks, Advances, Payslips, Salary Release), `density="compact"` for
 * document-like/high-density financial views (Bank Sheets, Cash Receiving; Payroll Entry's own
 * grid is a separate, deliberately custom-virtualized component and does not use this Table).
 * Propagated via context so `TableHead`/`TableCell` don't need `density` repeated on every cell —
 * one `<Table density="compact">` at the root is enough. Row height stays content-driven
 * (cell padding, not a forced `<tr>`/`<td>` height, which can clip taller content) — the resulting
 * rendered height is documented, not hard-coded, as `--table-row-height-standard`/`-compact` in
 * `index.css`.
 */
export type TableDensity = 'standard' | 'compact';

const TableDensityContext = React.createContext<TableDensity>('standard');

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
}

/**
 * The deterministic half of the density system, pulled out as a plain function so it can be unit
 * tested directly (`table-density.test.ts`) without rendering a component — this project's own
 * established testing convention (`vitest.config.ts`: "deterministic logic... unit tested" rather
 * than jsdom/DOM-rendering tests). `TableHead`/`TableCell` below are the only callers.
 */
export function tableHeadPaddingClass(density: TableDensity): string {
  return density === 'compact' ? 'py-2' : 'py-2.5';
}

export function tableCellPaddingClass(density: TableDensity): string {
  return density === 'compact' ? 'py-2' : 'py-3';
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = 'standard', ...props }, ref) => (
    <TableDensityContext.Provider value={density}>
      <table ref={ref} className={cn('w-full border-collapse text-xs', className)} {...props} />
    </TableDensityContext.Provider>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />,
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn(className)} {...props} />,
);
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn('border-b border-border last:border-0', className)} {...props} />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(TableDensityContext);
    return (
      <th
        ref={ref}
        className={cn(
          'px-3.5 text-left text-[10px] font-semibold uppercase tracking-wide text-text-muted',
          tableHeadPaddingClass(density),
          className,
        )}
        {...props}
      />
    );
  },
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(TableDensityContext);
    return (
      <td
        ref={ref}
        className={cn(
          'px-3.5 text-text',
          // Vertically centers any control (Badge, Checkbox, Button, Toggle) a cell contains,
          // whichever density — a shared invariant this checkpoint requires, not incidental.
          'align-middle',
          tableCellPaddingClass(density),
          className,
        )}
        {...props}
      />
    );
  },
);
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
