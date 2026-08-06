import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronUp, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatDate,
  formatMoney,
  PERMISSIONS,
  type ProjectSitePayrollReportRow,
  type ProjectSitePayrollReportRowStatus,
  type ProjectSitePayrollReportSortDirection,
  type ProjectSitePayrollReportSortField,
  type SessionUser,
} from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FilterField } from '@/components/ui/filter-field';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useProjectUnits } from '@/hooks/use-project-units';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import { ReportPagination } from '@/components/reports/report-pagination';
import { useTriggerPrint } from '@/components/print/use-print';
import { ProjectSitePayrollPrintOptionsDialog } from '@/components/reports/project-site-payroll-print-options-dialog';
import {
  DEFAULT_PRINT_SELECTION,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  type ProjectSitePayrollPrintSelection,
  type SummaryCardFieldId,
  type TableColumnFieldId,
} from '@/components/reports/project-site-payroll-print-fields';
import { primaryUnitLabel, rowStatusLabel, rowStatusTone } from '@/components/reports/project-site-payroll-labels';
import {
  downloadProjectSitePayrollReportExport,
  ProjectSitePayrollReportExportRowLimitExceededError,
  useProjectSitePayrollReportList,
  PROJECT_SITE_PAYROLL_REPORT_PAGE_SIZE,
  type ProjectSitePayrollReportFilters,
} from '@/hooks/use-project-site-payroll-report';

type TriState = 'ALL' | 'YES' | 'NO';

const ROW_STATUS_OPTIONS: ProjectSitePayrollReportRowStatus[] = ['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'];
const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORT_BUTTON_LABEL: Record<ExportFormat, string> = { csv: 'Export CSV', xlsx: 'Export Excel' };

const SORTABLE_COLUMNS: { field: ProjectSitePayrollReportSortField; label: string }[] = [
  { field: 'employeeCode', label: 'Employee Code' },
  { field: 'employeeName', label: 'Employee Name' },
  { field: 'site', label: 'Project Site' },
];

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-50';

function StatFigure({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-surface px-3.5 py-3" data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

function StatGroupLabel({ children }: { children: string }) {
  return <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{children}</p>;
}

interface ReportTotals {
  matchingCount: number;
  releasedCount: number;
  heldCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  pendingCount: number;
  correctedEntryCount: number;
  grossPay: string | null;
  allowance: string | null;
  eobiDeduction: string | null;
  advanceDeduction: string | null;
  eidAdvanceDeduction: string | null;
  fine: string | null;
  correctionBalancePayable: string | null;
  correctionBalanceRecovery: string | null;
  totalEarnings: string | null;
  totalDeductions: string | null;
  netSalaryTotal: string | null;
  totalsComputed: boolean;
}

function summaryCardValue(id: SummaryCardFieldId, totals: ReportTotals): string {
  switch (id) {
    case 'matchingCount':
      return String(totals.matchingCount);
    case 'grossPay':
      return totals.grossPay !== null ? formatMoney(totals.grossPay) : '—';
    case 'allowance':
      return totals.allowance !== null ? formatMoney(totals.allowance) : '—';
    case 'eobiDeduction':
      return totals.eobiDeduction !== null ? formatMoney(totals.eobiDeduction) : '—';
    case 'advanceDeduction':
      return totals.advanceDeduction !== null ? formatMoney(totals.advanceDeduction) : '—';
    case 'eidAdvanceDeduction':
      return totals.eidAdvanceDeduction !== null ? formatMoney(totals.eidAdvanceDeduction) : '—';
    case 'fine':
      return totals.fine !== null ? formatMoney(totals.fine) : '—';
    case 'correctionBalancePayable':
      return totals.correctionBalancePayable !== null ? formatMoney(totals.correctionBalancePayable) : '—';
    case 'correctionBalanceRecovery':
      return totals.correctionBalanceRecovery !== null ? formatMoney(totals.correctionBalanceRecovery) : '—';
    case 'totalEarnings':
      return totals.totalEarnings !== null ? formatMoney(totals.totalEarnings) : '—';
    case 'totalDeductions':
      return totals.totalDeductions !== null ? formatMoney(totals.totalDeductions) : '—';
    case 'netSalaryTotal':
      return totals.netSalaryTotal !== null ? formatMoney(totals.netSalaryTotal) : '—';
    case 'releasedCount':
      return String(totals.releasedCount);
    case 'heldCount':
      return String(totals.heldCount);
    case 'noPayDueCount':
      return String(totals.noPayDueCount);
    case 'recoveryDueCount':
      return String(totals.recoveryDueCount);
    case 'pendingCount':
      return String(totals.pendingCount);
    case 'correctedEntryCount':
      return String(totals.correctedEntryCount);
  }
}

function printColumnValue(id: TableColumnFieldId, row: ProjectSitePayrollReportRow): string {
  switch (id) {
    case 'employeeCode':
      return row.employeeCode ?? '—';
    case 'employeeName':
      return row.employeeName;
    case 'siteName':
      return row.siteName;
    case 'primaryUnit':
      return primaryUnitLabel(row);
    case 'designation':
      return row.designation;
    case 'grossPay':
      return formatMoney(row.grossPay);
    case 'allowance':
      return formatMoney(row.allowance);
    case 'eobiDeduction':
      return formatMoney(row.eobiDeduction);
    case 'advanceDeduction':
      return formatMoney(row.advanceDeduction);
    case 'eidAdvanceDeduction':
      return formatMoney(row.eidAdvanceDeduction);
    case 'fine':
      return formatMoney(row.fine);
    case 'correctionBalancePayable':
      return formatMoney(row.correctionBalancePayable);
    case 'correctionBalanceRecovery':
      return formatMoney(row.correctionBalanceRecovery);
    case 'totalEarnings':
      return formatMoney(row.totalEarnings);
    case 'totalDeductions':
      return formatMoney(row.totalDeductions);
    case 'netSalary':
      return formatMoney(row.netSalary);
    case 'rowStatus':
      return rowStatusLabel(row.rowStatus);
    case 'correctionCount':
      return String(row.correctionCount);
    case 'releasedAt':
      return formatDate(row.releasedAt) || '—';
  }
}

/**
 * Phase 7 Reports, Project Site Payroll Report Checkpoint 1B — the frontend for the frozen
 * Checkpoint 1A backend (`GET /api/v1/reports/project-site-payroll` and its export sibling,
 * `docs/architecture/workflows/reports.md` §16). Gated on `reports:view`, the same permission
 * Payroll Summary already uses (frozen decision 2) — this report is the row-level drill-down
 * beneath Payroll Summary's own site-aggregate rows, always scoped to exactly one required
 * `PayrollCycle` (frozen decision 1/3, no From/To range), never a cross-cycle, employee-searchable
 * history like Employee Payroll History.
 *
 * Every row is always the entry's own *original*, as-released figures via canonical `calcNet` —
 * this page never computes a financial value itself and never replays a correction; corrections are
 * shown only as a count badge (frozen decision 6). Historical authorization is always
 * `PayrollEntry.siteId`, never the employee's current site. No detail page exists in V1 (frozen
 * decision 4) — every field this page needs lives directly on the list row.
 */
export function ReportsProjectSitePayrollPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.REPORTS_VIEW);

  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('reports/project-site-payroll');
  const hasAnyCycle = cycles.length > 0;

  const sites = useAccessibleProjectSites(user);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [unitId, setUnitId] = useState('');
  const [rowStatus, setRowStatus] = useState<ProjectSitePayrollReportRowStatus | ''>('');
  const [hasCorrection, setHasCorrection] = useState<TriState>('ALL');
  const [sortBy, setSortBy] = useState<ProjectSitePayrollReportSortField>('employeeName');
  const [sortDir, setSortDir] = useState<ProjectSitePayrollReportSortDirection>('asc');
  const [page, setPage] = useState(1);
  const [activeExport, setActiveExport] = useState<ExportFormat | null>(null);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState<ProjectSitePayrollPrintSelection>(DEFAULT_PRINT_SELECTION);
  const triggerPrint = useTriggerPrint('landscape');

  // A Unit only ever means something relative to exactly one Site — Site is a multi-select here
  // (Step 4), so Unit narrowing is only ever meaningful when precisely one Site is currently
  // selected; any other Site-scope change (0 or 2+ sites) clears whichever Unit was chosen.
  const singleSiteId = selectedSiteIds.length === 1 ? selectedSiteIds[0] : undefined;
  const units = useProjectUnits(singleSiteId);
  const selectedSingleSite = sites.data?.find((site) => site.id === singleSiteId);
  const unitLabel = selectedSingleSite?.unitLabel ?? 'Unit';

  useEffect(() => {
    setUnitId('');
  }, [singleSiteId]);

  const selectedSiteIdsKey = selectedSiteIds.join(',');

  // A filter, sort, or Cycle change invalidates whichever page was previously being viewed — never
  // silently keep showing "page 3" of a now-different filtered/sorted result (Step 4/Step 7).
  useEffect(() => {
    setPage(1);
  }, [cycleId, selectedSiteIdsKey, unitId, rowStatus, hasCorrection, sortBy, sortDir]);

  const filters: ProjectSitePayrollReportFilters = {
    cycleId: cycleId ?? '',
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    unitId: unitId || undefined,
    rowStatus: rowStatus || undefined,
    hasCorrection: hasCorrection === 'ALL' ? undefined : hasCorrection === 'YES',
  };

  // No report request is ever made without a valid Cycle (Step 8) — `useProjectSitePayrollReportList`
  // is disabled internally whenever `cycleId` is empty.
  const report = useProjectSitePayrollReportList({
    ...filters,
    page,
    pageSize: PROJECT_SITE_PAYROLL_REPORT_PAGE_SIZE,
    sortBy,
    sortDir,
  });

  // Narrow safeguard, independent of the filter/sort/Cycle page-reset effect above: if the backend
  // total for the *currently requested* page shrinks below the page being viewed (e.g. another user
  // releases/holds rows while this page sits on page 3, under an otherwise unchanged filter set),
  // clamp down to the new last valid page rather than silently showing a stale, empty page as if it
  // were current data. Keyed on `report.data` (never on `report.isLoading`/`isFetching`) — this hook
  // has no `placeholderData`/`keepPreviousData` configured, so `report.data` is only ever defined
  // once a response for the exact current query key (including `page`) has actually resolved; it is
  // `undefined` for the entire duration of any in-flight request, including a page/filter/Cycle
  // change. That single property is what makes checking `report.data` alone sufficient to guarantee
  // this never clamps before a valid response exists and never clamps against loading/stale data.
  // Never fires below page 1, and only ever calls `setPage` when the current page is already out of
  // range for the resolved total — so it cannot loop with, or fight, the effect above (that one only
  // ever sets page to 1; this one only ever lowers an already-too-high page to a still-valid one,
  // after which recomputing against the same total no longer finds it out of range).
  useEffect(() => {
    if (!report.data) return;
    const lastValidPage = Math.max(1, Math.ceil(report.data.total / report.data.pageSize));
    if (page > 1 && page > lastValidPage) {
      setPage(lastValidPage);
    }
  }, [report.data, page]);

  const siteOptions = useMemo(() => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })), [sites.data]);

  function handleClearFilters() {
    // Clear Filters restores the approved filter defaults but never touches the required selected
    // Cycle (Step 4) — the Cycle selector is a navigation control, not a filter.
    setSelectedSiteIds([]);
    setUnitId('');
    setRowStatus('');
    setHasCorrection('ALL');
  }

  function handleSort(field: ProjectSitePayrollReportSortField) {
    if (field === sortBy) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  }

  async function handleExport(format: ExportFormat) {
    if (!cycle || activeExport) return;
    setActiveExport(format);
    try {
      await downloadProjectSitePayrollReportExport(cycle, filters, sortBy, sortDir, format);
    } catch (error) {
      if (error instanceof ProjectSitePayrollReportExportRowLimitExceededError) {
        toast.error(error.message);
      } else {
        toast.error(error instanceof ApiError ? error.message : `Project Site Payroll Report ${format.toUpperCase()} export failed`);
      }
    } finally {
      setActiveExport(null);
    }
  }

  function handlePrintConfirm(selection: ProjectSitePayrollPrintSelection) {
    flushSync(() => {
      setPrintSelection(selection);
      setPrintOptionsOpen(false);
    });
    triggerPrint({ orientation: 'landscape', fit: 'normal' });
  }

  if (!canView) {
    return (
      <AppShell user={user} title="Project Site Payroll Report" subtitle="Reports">
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
            <p className="text-xs font-medium text-text">You don&apos;t have access to Reports</p>
            <p className="text-xs text-text-muted">Contact a Master User if you believe this is a mistake.</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const isLoading = cycleLoading || sites.isLoading;
  const totals: ReportTotals | undefined = report.data?.totals;
  const filtersActive = Boolean(selectedSiteIds.length || unitId || rowStatus || hasCorrection !== 'ALL');

  return (
    <AppShell
      user={user}
      title="Project Site Payroll Report"
      subtitle="Employee payroll detail for selected sites within one payroll cycle"
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <PayrollPageToolbar
              title="Project Site Payroll Report"
              badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
              filters={
                <>
                  {hasAnyCycle && (
                    <PayrollCycleSelectField
                      id="psp-cycle"
                      cycles={cycles}
                      selectedCycleId={cycleId}
                      onSelect={selectCycle}
                    />
                  )}

                  <MultiSelectFilter
                    id="psp-site-filter"
                    label="Site"
                    options={siteOptions}
                    selectedIds={selectedSiteIds}
                    onChange={setSelectedSiteIds}
                    disabled={report.isFetching}
                  />

                  <FilterField id="psp-unit-filter" label={unitLabel}>
                    <select
                      id="psp-unit-filter"
                      className={selectClassName}
                      value={unitId}
                      onChange={(e) => setUnitId(e.target.value)}
                      disabled={report.isFetching || !singleSiteId}
                      title={!singleSiteId ? 'Select exactly one Site to filter by Unit' : undefined}
                    >
                      <option value="">Any {unitLabel}</option>
                      {(units.data ?? []).map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField id="psp-row-status" label="Row Status">
                    <select
                      id="psp-row-status"
                      className={selectClassName}
                      value={rowStatus}
                      onChange={(e) => setRowStatus(e.target.value as ProjectSitePayrollReportRowStatus | '')}
                      disabled={report.isFetching}
                    >
                      <option value="">All</option>
                      {ROW_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {rowStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField id="psp-has-correction" label="Has Correction">
                    <select
                      id="psp-has-correction"
                      className={selectClassName}
                      value={hasCorrection}
                      onChange={(e) => setHasCorrection(e.target.value as TriState)}
                      disabled={report.isFetching}
                    >
                      <option value="ALL">All</option>
                      <option value="YES">Yes</option>
                      <option value="NO">No</option>
                    </select>
                  </FilterField>

                  <Button variant="secondary" size="default" onClick={handleClearFilters} disabled={report.isFetching}>
                    Clear Filters
                  </Button>
                </>
              }
              actions={
                <>
                  <Button variant="secondary" onClick={() => setPrintOptionsOpen(true)} disabled={activeExport !== null || !cycleId}>
                    <Printer className="h-3.5 w-3.5" aria-hidden />
                    Print
                  </Button>
                  {EXPORT_FORMATS.map((format) => (
                    <Button
                      key={format}
                      variant="secondary"
                      onClick={() => handleExport(format)}
                      disabled={activeExport !== null || !report.data || report.data.total === 0}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      {EXPORT_BUTTON_LABEL[format]}
                    </Button>
                  ))}
                </>
              }
            />
          </CardHeader>
          <CardContent className="p-0">
            {cycle && (
              <div className="px-[18px] pt-[18px]">
                <PrintContextHeader
                  title="Project Site Payroll Report"
                  context={`${formatCycleLabel(cycle)} — Site: ${selectedSiteIds.length ? `${selectedSiteIds.length} selected` : 'All'} — Unit: ${unitId ? units.data?.find((u) => u.id === unitId)?.name ?? unitId : 'Any'} — Row Status: ${rowStatus ? rowStatusLabel(rowStatus) : 'All'} — Has Correction: ${hasCorrection === 'ALL' ? 'All' : hasCorrection === 'YES' ? 'Yes' : 'No'} — Current page only`}
                  showLogo
                />
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col gap-2 p-[18px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}

            {!isLoading && cycleError && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load the payroll cycle</p>
                <p className="text-xs text-text-muted">{cycleError.message}</p>
              </div>
            )}

            {!isLoading && !cycleError && !hasAnyCycle && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-text">No payroll cycles exist yet</p>
                <p className="text-xs text-text-muted">
                  A Project Site Payroll Report can only be generated once a payroll cycle exists.
                </p>
              </div>
            )}

            {!isLoading && !cycleError && hasAnyCycle && !cycleId && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-text">Select a payroll cycle</p>
                <p className="text-xs text-text-muted">Choose a Payroll Cycle above to generate this report.</p>
              </div>
            )}

            {!isLoading && !cycleError && hasAnyCycle && cycleId && report.error && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load the Project Site Payroll Report</p>
                <p className="text-xs text-text-muted">
                  {report.error instanceof ApiError ? report.error.message : 'Something went wrong'}
                </p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => report.refetch()}>
                  Try Again
                </Button>
              </div>
            )}

            {!isLoading && !report.error && cycleId && report.isLoading && (
              <div className="flex flex-col gap-2 p-[18px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}

            {!isLoading && !report.error && !report.isLoading && report.data && cycle && (
              <div className="flex flex-col gap-4 p-[18px] print:p-0">
                {report.data.total === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-14 text-center">
                    <p className="text-xs font-medium text-text">
                      {filtersActive ? 'No payroll entries match these filters' : 'This cycle has no payroll entries yet'}
                    </p>
                    <p className="max-w-sm text-xs text-text-muted">
                      {filtersActive
                        ? 'Try a different filter combination, or use Clear Filters to start over.'
                        : 'Payroll entries appear here once employees have been added to this cycle under Payroll Entry.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {totals && (
                      <div data-testid="on-screen-cards" className="flex flex-col gap-3 print:hidden">
                        <div>
                          <StatGroupLabel>Payroll Totals</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatFigure label="Matching Entries" value={String(totals.matchingCount)} testId="psp-stat-matching-entries" />
                            {totals.totalsComputed ? (
                              <>
                                <StatFigure label="Gross Pay" value={formatMoney(totals.grossPay ?? '0')} />
                                <StatFigure label="Allowance" value={formatMoney(totals.allowance ?? '0')} />
                                <StatFigure label="Total Earnings" value={formatMoney(totals.totalEarnings ?? '0')} />
                                <StatFigure label="Total Deductions" value={formatMoney(totals.totalDeductions ?? '0')} />
                                <StatFigure label="Net Salary" value={formatMoney(totals.netSalaryTotal ?? '0')} testId="psp-stat-net-salary" />
                              </>
                            ) : (
                              <div className="col-span-full flex flex-col justify-center rounded border border-border bg-surface px-3.5 py-3" data-testid="psp-totals-unavailable">
                                <span className="text-xs text-text-muted">
                                  Totals are unavailable for this result size. Narrow the filters to calculate totals.
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {totals.totalsComputed && (
                          <div>
                            <StatGroupLabel>Deductions and Adjustments</StatGroupLabel>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <StatFigure label="EOBI" value={formatMoney(totals.eobiDeduction ?? '0')} />
                              <StatFigure label="Advance Deduction" value={formatMoney(totals.advanceDeduction ?? '0')} />
                              <StatFigure label="EID Advance Deduction" value={formatMoney(totals.eidAdvanceDeduction ?? '0')} />
                              <StatFigure label="Fine" value={formatMoney(totals.fine ?? '0')} />
                              <StatFigure label="Correction Balance Payable" value={formatMoney(totals.correctionBalancePayable ?? '0')} />
                              <StatFigure label="Correction Balance Recovery" value={formatMoney(totals.correctionBalanceRecovery ?? '0')} />
                            </div>
                          </div>
                        )}

                        <div>
                          <StatGroupLabel>Status Counts</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatFigure label="Released" value={String(totals.releasedCount)} testId="psp-stat-released" />
                            <StatFigure label="Held" value={String(totals.heldCount)} testId="psp-stat-held" />
                            <StatFigure label="No Pay Due" value={String(totals.noPayDueCount)} testId="psp-stat-no-pay-due" />
                            <StatFigure label="Recovery Due" value={String(totals.recoveryDueCount)} testId="psp-stat-recovery-due" />
                            <StatFigure label="Pending" value={String(totals.pendingCount)} testId="psp-stat-pending" />
                            <StatFigure label="Corrected Entries" value={String(totals.correctedEntryCount)} testId="psp-stat-corrected-entries" />
                          </div>
                        </div>
                      </div>
                    )}

                    <div data-testid="on-screen-table" className="print-flow overflow-x-auto rounded border border-border print:hidden">
                      <Table density="compact" className="min-w-full">
                        <TableHeader>
                          <TableRow>
                            {SORTABLE_COLUMNS.map((col) => (
                              <SortableHead key={col.field} field={col.field} label={col.label} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            ))}
                            <TableHead className="whitespace-nowrap">Primary Unit</TableHead>
                            <TableHead className="whitespace-nowrap">Designation</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Gross Pay</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Allowance</TableHead>
                            <TableHead className="whitespace-nowrap text-right">EOBI</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Advance Deduction</TableHead>
                            <TableHead className="whitespace-nowrap text-right">EID Advance Deduction</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Fine</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Correction Bal. Payable</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Correction Bal. Recovery</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Total Earnings</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Total Deductions</TableHead>
                            <SortableHead field="netSalary" label="Net Salary" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                            <SortableHead field="rowStatus" label="Row Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <TableHead className="whitespace-nowrap text-right">Corrections</TableHead>
                            <TableHead className="whitespace-nowrap">Released Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.rows.map((row) => (
                            <TableRow key={row.payrollEntryId}>
                              <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                              <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.siteName}</TableCell>
                              <TableCell className="whitespace-nowrap">{primaryUnitLabel(row)}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.designation}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.grossPay)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.allowance)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.eobiDeduction)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.advanceDeduction)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.eidAdvanceDeduction)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.fine)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.correctionBalancePayable)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.correctionBalanceRecovery)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.totalEarnings)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.totalDeductions)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(row.netSalary)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone={rowStatusTone(row.rowStatus)}>{rowStatusLabel(row.rowStatus)}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {row.correctionCount > 0 ? <Badge tone="amber">{row.correctionCount}</Badge> : 0}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{formatDate(row.releasedAt) || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Print-only — current page only (Step 10), never an unbounded fetch. Draws
                        from the exact same already-loaded `report.data` the on-screen table above
                        already shows. */}
                    {totals && (
                      <div data-testid="print-only-cards" className="hidden print:mb-3 print:grid print:grid-cols-4 print:gap-3">
                        {SUMMARY_CARD_FIELDS.filter((field) => printSelection.cards.includes(field.id)).map((field) => (
                          <StatFigure key={field.id} label={field.label} value={summaryCardValue(field.id, totals)} />
                        ))}
                      </div>
                    )}
                    <div data-testid="print-only-table" className="hidden print:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {TABLE_COLUMN_FIELDS.filter((field) => printSelection.columns.includes(field.id)).map((field) => (
                              <TableHead key={field.id}>{field.label}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.rows.map((row) => (
                            <TableRow key={row.payrollEntryId}>
                              {TABLE_COLUMN_FIELDS.filter((field) => printSelection.columns.includes(field.id)).map((field) => (
                                <TableCell key={field.id}>{printColumnValue(field.id, row)}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <ReportPagination
                      page={report.data.page}
                      pageSize={report.data.pageSize}
                      total={report.data.total}
                      onPageChange={setPage}
                      disabled={report.isFetching}
                    />
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ProjectSitePayrollPrintOptionsDialog open={printOptionsOpen} onOpenChange={setPrintOptionsOpen} onConfirm={handlePrintConfirm} />
    </AppShell>
  );
}

function SortableHead({
  field,
  label,
  sortBy,
  sortDir,
  onSort,
  align,
}: {
  field: ProjectSitePayrollReportSortField;
  label: string;
  sortBy: ProjectSitePayrollReportSortField;
  sortDir: ProjectSitePayrollReportSortDirection;
  onSort: (field: ProjectSitePayrollReportSortField) => void;
  align?: 'right';
}) {
  const isActive = sortBy === field;
  return (
    <TableHead
      className={`whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors hover:text-text ${
          isActive ? 'text-text' : 'text-text-muted'
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        {isActive &&
          (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />)}
      </button>
    </TableHead>
  );
}
