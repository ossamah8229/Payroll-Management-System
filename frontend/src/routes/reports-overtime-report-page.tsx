import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronUp, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatMoney,
  formatNumber,
  PERMISSIONS,
  type OvertimeReportRow,
  type OvertimeReportRowStatus,
  type OvertimeReportSortDirection,
  type OvertimeReportSortField,
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
import { OvertimeReportPrintOptionsDialog } from '@/components/reports/overtime-report-print-options-dialog';
import {
  DEFAULT_PRINT_SELECTION,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  type OvertimeReportPrintSelection,
  type SummaryCardFieldId,
  type TableColumnFieldId,
} from '@/components/reports/overtime-report-print-fields';
import { rowStatusLabel, rowStatusTone } from '@/components/reports/overtime-report-labels';
import {
  downloadOvertimeReportExport,
  OvertimeReportExportRowLimitExceededError,
  useOvertimeReportList,
  OVERTIME_REPORT_PAGE_SIZE,
  type OvertimeReportFilters,
} from '@/hooks/use-overtime-report';

type TriState = 'ALL' | 'YES' | 'NO';

function triStateToBoolean(state: TriState): boolean | undefined {
  return state === 'ALL' ? undefined : state === 'YES';
}

/** "All" / "Yes" / "No" — the same three words the filter's own `<select>` options show, reused
 * verbatim in the print context summary so the printed page states every applied filter, including
 * both tri-states (mirrors Deduction Report's identical M2 print-content verification pattern). */
function triStateSummaryLabel(state: TriState): string {
  return state === 'ALL' ? 'All' : state === 'YES' ? 'Yes' : 'No';
}

const ROW_STATUS_OPTIONS: OvertimeReportRowStatus[] = ['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'];
const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORT_BUTTON_LABEL: Record<ExportFormat, string> = { csv: 'Export CSV', xlsx: 'Export Excel' };

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-50';

interface ReportTotals {
  matchingCount: number;
  employeesWithOvertimeCount: number | null;
  totalOtHours: string | null;
  totalOtEarnings: string | null;
  sitesWithOvertimeCount: number | null;
  unitsWithOvertimeCount: number | null;
  releasedCount: number;
  heldCount: number;
  pendingCount: number;
  correctedEntryCount: number;
  totalsComputed: boolean;
}

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

function summaryCardValue(id: SummaryCardFieldId, totals: ReportTotals): string {
  switch (id) {
    case 'totalOtHours':
      return totals.totalOtHours !== null ? formatNumber(totals.totalOtHours) : '—';
    case 'totalOtEarnings':
      return totals.totalOtEarnings !== null ? formatMoney(totals.totalOtEarnings) : '—';
    case 'matchingCount':
      return String(totals.matchingCount);
    case 'employeesWithOvertimeCount':
      return totals.employeesWithOvertimeCount !== null ? String(totals.employeesWithOvertimeCount) : '—';
    case 'sitesWithOvertimeCount':
      return totals.sitesWithOvertimeCount !== null ? String(totals.sitesWithOvertimeCount) : '—';
    case 'unitsWithOvertimeCount':
      return totals.unitsWithOvertimeCount !== null ? String(totals.unitsWithOvertimeCount) : '—';
    case 'releasedCount':
      return String(totals.releasedCount);
    case 'heldCount':
      return String(totals.heldCount);
    case 'pendingCount':
      return String(totals.pendingCount);
    case 'correctedEntryCount':
      return String(totals.correctedEntryCount);
  }
}

function printColumnValue(id: TableColumnFieldId, row: OvertimeReportRow): string {
  switch (id) {
    case 'employeeCode':
      return row.employeeCode ?? '—';
    case 'employeeName':
      return row.employeeName;
    case 'siteName':
      return row.siteName;
    case 'unit':
      return row.unit.name;
    case 'designation':
      return row.designation;
    case 'otHours':
      return formatNumber(row.otHours);
    case 'effectiveOtRate':
      return formatMoney(row.effectiveOtRate);
    case 'otEarned':
      return formatMoney(row.otEarned);
    case 'grossPay':
      return formatMoney(row.grossPay);
    case 'rowStatus':
      return rowStatusLabel(row.rowStatus);
    case 'hasCorrection':
      return row.hasCorrection ? 'Yes' : 'No';
  }
}

/**
 * Phase 7 Reports, Overtime Report Checkpoint 1B — the frontend for the frozen Checkpoint 1A
 * backend (`GET /api/v1/reports/overtime-report` and its export sibling,
 * `docs/architecture/workflows/reports.md` §18). Gated on `reports:view`, the same permission
 * Project Site Payroll Report/Deduction Report already use — a single-cycle, site-scoped,
 * operational overtime report, always scoped to exactly one required `PayrollCycle` (no From/To
 * range), never a cross-cycle trend.
 *
 * **Report grain is `PayrollEntryWorkLine`, not `PayrollEntry`** — an intentional, frozen
 * architectural exception from every sibling report in this module. An employee with 2 work lines
 * this cycle legitimately appears as 2 rows, each with its own Unit, OT Hours, Effective OT Rate,
 * and OT Earnings — this page never merges, groups, or deduplicates those rows by employee. OT Hours
 * is always the stored `PayrollEntryWorkLine.otHours` column; Effective OT Rate and OT Earnings are
 * always the backend's own canonical `calcNet`-derived values — this page never recomputes either.
 * Historical authorization is always `PayrollEntry.siteId`, never the employee's current site. No
 * detail page exists in V1 — every field this page needs lives directly on the list row.
 */
export function ReportsOvertimeReportPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.REPORTS_VIEW);

  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('reports/overtime-report');
  const hasAnyCycle = cycles.length > 0;

  const sites = useAccessibleProjectSites(user);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [unitId, setUnitId] = useState('');
  const [rowStatus, setRowStatus] = useState<OvertimeReportRowStatus | ''>('');
  const [hasCorrection, setHasCorrection] = useState<TriState>('ALL');
  const [hasOvertime, setHasOvertime] = useState<TriState>('ALL');
  const [sortBy, setSortBy] = useState<OvertimeReportSortField>('employeeName');
  const [sortDir, setSortDir] = useState<OvertimeReportSortDirection>('asc');
  const [page, setPage] = useState(1);
  const [activeExport, setActiveExport] = useState<ExportFormat | null>(null);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState<OvertimeReportPrintSelection>(DEFAULT_PRINT_SELECTION);
  const triggerPrint = useTriggerPrint('landscape');

  // A Unit only ever means something relative to exactly one Site — Site is a multi-select here, so
  // Unit narrowing is only ever meaningful when precisely one Site is currently selected; any other
  // Site-scope change (0 or 2+ sites) clears whichever Unit was chosen.
  const singleSiteId = selectedSiteIds.length === 1 ? selectedSiteIds[0] : undefined;
  const units = useProjectUnits(singleSiteId);
  const selectedSingleSite = sites.data?.find((site) => site.id === singleSiteId);
  const unitLabel = selectedSingleSite?.unitLabel ?? 'Unit';

  useEffect(() => {
    setUnitId('');
  }, [singleSiteId]);

  const selectedSiteIdsKey = selectedSiteIds.join(',');

  // A filter, sort, or Cycle change invalidates whichever page was previously being viewed — never
  // silently keep showing "page 3" of a now-different filtered/sorted result.
  useEffect(() => {
    setPage(1);
  }, [cycleId, selectedSiteIdsKey, unitId, rowStatus, hasCorrection, hasOvertime, sortBy, sortDir]);

  const filters: OvertimeReportFilters = {
    cycleId: cycleId ?? '',
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    unitId: unitId || undefined,
    rowStatus: rowStatus || undefined,
    hasCorrection: triStateToBoolean(hasCorrection),
    hasOvertime: triStateToBoolean(hasOvertime),
  };

  // No report request is ever made without a valid Cycle — `useOvertimeReportList` is disabled
  // internally whenever `cycleId` is empty.
  const report = useOvertimeReportList({
    ...filters,
    page,
    pageSize: OVERTIME_REPORT_PAGE_SIZE,
    sortBy,
    sortDir,
  });

  // Narrow safeguard, independent of the filter/sort/Cycle page-reset effect above: if the backend
  // total for the *currently requested* page shrinks below the page being viewed (e.g. another user
  // releases/holds rows while this page sits on page 3, under an otherwise unchanged filter set),
  // clamp down to the new last valid page rather than silently showing a stale, empty page as if it
  // were current data. Keyed on `report.data` (never on `report.isLoading`/`isFetching`) — this hook
  // has no `placeholderData`/`keepPreviousData` configured, so `report.data` is only ever defined
  // once a response for the exact current query key (including `page`) has actually resolved.
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
    // Cycle — the Cycle selector is a navigation control, not a filter.
    setSelectedSiteIds([]);
    setUnitId('');
    setRowStatus('');
    setHasCorrection('ALL');
    setHasOvertime('ALL');
  }

  function handleSort(field: OvertimeReportSortField) {
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
      await downloadOvertimeReportExport(cycle, filters, sortBy, sortDir, format);
    } catch (error) {
      if (error instanceof OvertimeReportExportRowLimitExceededError) {
        toast.error(error.message);
      } else {
        toast.error(error instanceof ApiError ? error.message : `Overtime Report ${format.toUpperCase()} export failed`);
      }
    } finally {
      setActiveExport(null);
    }
  }

  function handlePrintConfirm(selection: OvertimeReportPrintSelection) {
    flushSync(() => {
      setPrintSelection(selection);
      setPrintOptionsOpen(false);
    });
    triggerPrint({ orientation: 'landscape', fit: 'normal' });
  }

  if (!canView) {
    return (
      <AppShell
        user={user}
        title="Overtime Report"
        subtitle="Operational overtime analysis by employee, site, and unit for one payroll cycle."
      >
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
  const filtersActive = Boolean(
    selectedSiteIds.length || unitId || rowStatus || hasCorrection !== 'ALL' || hasOvertime !== 'ALL',
  );

  return (
    <AppShell
      user={user}
      title="Overtime Report"
      subtitle="Operational overtime analysis by employee, site, and unit for one payroll cycle."
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <PayrollPageToolbar
              title="Overtime Report"
              badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
              filters={
                <>
                  {hasAnyCycle && (
                    <PayrollCycleSelectField
                      id="or-cycle"
                      cycles={cycles}
                      selectedCycleId={cycleId}
                      onSelect={selectCycle}
                    />
                  )}

                  <MultiSelectFilter
                    id="or-site-filter"
                    label="Site"
                    options={siteOptions}
                    selectedIds={selectedSiteIds}
                    onChange={setSelectedSiteIds}
                    disabled={report.isFetching}
                  />

                  <FilterField id="or-unit-filter" label={unitLabel}>
                    <select
                      id="or-unit-filter"
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

                  <FilterField id="or-row-status" label="Row Status">
                    <select
                      id="or-row-status"
                      className={selectClassName}
                      value={rowStatus}
                      onChange={(e) => setRowStatus(e.target.value as OvertimeReportRowStatus | '')}
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

                  <FilterField id="or-has-correction" label="Has Correction">
                    <select
                      id="or-has-correction"
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

                  <FilterField id="or-has-overtime" label="Has Overtime">
                    <select
                      id="or-has-overtime"
                      className={selectClassName}
                      value={hasOvertime}
                      onChange={(e) => setHasOvertime(e.target.value as TriState)}
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
                  title="Overtime Report"
                  context={[
                    formatCycleLabel(cycle),
                    `Site: ${selectedSiteIds.length ? `${selectedSiteIds.length} selected` : 'All'}`,
                    `Unit: ${unitId ? units.data?.find((u) => u.id === unitId)?.name ?? unitId : 'Any'}`,
                    `Row Status: ${rowStatus ? rowStatusLabel(rowStatus) : 'All'}`,
                    `Has Correction: ${triStateSummaryLabel(hasCorrection)}`,
                    `Has Overtime: ${triStateSummaryLabel(hasOvertime)}`,
                    'Current page only',
                  ].join(' — ')}
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
                <p className="text-xs text-text-muted">An Overtime Report can only be generated once a payroll cycle exists.</p>
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
                <p className="text-xs font-medium text-danger">Could not load the Overtime Report</p>
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
                      {filtersActive ? 'No work lines match these filters' : 'This cycle has no payroll entries yet'}
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
                          <StatGroupLabel>Overtime</StatGroupLabel>
                          {totals.totalsComputed ? (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <StatFigure label="Total OT Hours" value={formatNumber(totals.totalOtHours ?? '0')} testId="or-stat-total-ot-hours" />
                              <StatFigure
                                label="Total OT Earnings"
                                value={formatMoney(totals.totalOtEarnings ?? '0')}
                                testId="or-stat-total-ot-earnings"
                              />
                            </div>
                          ) : (
                            <div className="flex flex-col justify-center rounded border border-border bg-surface px-3.5 py-3" data-testid="or-totals-unavailable">
                              <span className="text-xs text-text-muted">
                                Totals are unavailable for this result size. Narrow the filters to calculate totals.
                              </span>
                            </div>
                          )}
                        </div>

                        <div>
                          <StatGroupLabel>Coverage</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatFigure label="Matching Work Lines" value={String(totals.matchingCount)} testId="or-stat-matching-count" />
                            <StatFigure
                              label="Employees With Overtime"
                              value={totals.employeesWithOvertimeCount !== null ? String(totals.employeesWithOvertimeCount) : '—'}
                              testId="or-stat-employees-with-overtime"
                            />
                            <StatFigure
                              label="Sites With Overtime"
                              value={totals.sitesWithOvertimeCount !== null ? String(totals.sitesWithOvertimeCount) : '—'}
                              testId="or-stat-sites-with-overtime"
                            />
                            <StatFigure
                              label="Units With Overtime"
                              value={totals.unitsWithOvertimeCount !== null ? String(totals.unitsWithOvertimeCount) : '—'}
                              testId="or-stat-units-with-overtime"
                            />
                          </div>
                        </div>

                        <div>
                          <StatGroupLabel>Status</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatFigure label="Released" value={String(totals.releasedCount)} testId="or-stat-released" />
                            <StatFigure label="Held" value={String(totals.heldCount)} testId="or-stat-held" />
                            <StatFigure label="Pending" value={String(totals.pendingCount)} testId="or-stat-pending" />
                            <StatFigure label="Corrected Entries" value={String(totals.correctedEntryCount)} testId="or-stat-corrected-entries" />
                          </div>
                        </div>
                      </div>
                    )}

                    <div data-testid="on-screen-table" className="print-flow overflow-x-auto rounded border border-border print:hidden">
                      <Table density="compact" className="min-w-full">
                        <TableHeader>
                          <TableRow>
                            <SortableHead field="employeeCode" label="Employee Code" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="employeeName" label="Employee Name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="site" label="Project Site" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="unit" label="Unit" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <TableHead className="whitespace-nowrap">Designation</TableHead>
                            <SortableHead field="otHours" label="OT Hours" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                            <TableHead className="whitespace-nowrap text-right">Effective OT Rate</TableHead>
                            <TableHead className="whitespace-nowrap text-right">OT Earnings</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Gross Pay</TableHead>
                            <SortableHead field="rowStatus" label="Row Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <TableHead className="whitespace-nowrap">Has Correction</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.rows.map((row) => (
                            <TableRow key={row.workLineId}>
                              <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                              <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.siteName}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone="blue">{row.unit.name}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{row.designation}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatNumber(row.otHours)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.effectiveOtRate)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(row.otEarned)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.grossPay)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone={rowStatusTone(row.rowStatus)}>{rowStatusLabel(row.rowStatus)}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{row.hasCorrection ? 'Yes' : 'No'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Print-only — current page only, never an unbounded fetch. Draws from the
                        exact same already-loaded `report.data` the on-screen table above already
                        shows. */}
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
                            <TableRow key={row.workLineId}>
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
      <OvertimeReportPrintOptionsDialog open={printOptionsOpen} onOpenChange={setPrintOptionsOpen} onConfirm={handlePrintConfirm} />
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
  field: OvertimeReportSortField;
  label: string;
  sortBy: OvertimeReportSortField;
  sortDir: OvertimeReportSortDirection;
  onSort: (field: OvertimeReportSortField) => void;
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
