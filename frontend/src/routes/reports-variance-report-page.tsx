import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatMoney,
  PERMISSIONS,
  VARIANCE_REPORT_DIRECTION_VALUES,
  type VarianceReportDirection,
  type VarianceReportEmployeeCandidate,
  type VarianceReportRow,
  type VarianceReportSortDirection,
  type VarianceReportSortField,
  type VarianceReportTotals,
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
import {
  formatCycleLabel,
  formatCycleOptionLabel,
  resolveDefaultCycleId,
  usePayrollCycles,
  type PayrollCycle,
} from '@/hooks/use-payroll-cycles';
import { ReportPagination } from '@/components/reports/report-pagination';
import { useTriggerPrint } from '@/components/print/use-print';
import { VarianceReportPrintOptionsDialog } from '@/components/reports/variance-report-print-options-dialog';
import {
  DEFAULT_PRINT_SELECTION,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  type VarianceReportPrintSelection,
  type SummaryCardFieldId,
  type TableColumnFieldId,
} from '@/components/reports/variance-report-print-fields';
import { directionLabel, directionTone, populationStatusLabel, populationStatusTone } from '@/components/reports/variance-report-labels';
import { VarianceReportEmployeeLookup } from '@/components/reports/variance-report-employee-lookup';
import {
  downloadVarianceReportExport,
  useVarianceReportList,
  VarianceReportExportRowLimitExceededError,
  VARIANCE_REPORT_PAGE_SIZE,
  type VarianceReportFilters,
} from '@/hooks/use-variance-report';

type TriState = 'ALL' | 'YES' | 'NO';

function triStateToBoolean(state: TriState): boolean | undefined {
  return state === 'ALL' ? undefined : state === 'YES';
}

/** "All" / "Yes" / "No" — the same three words the filter's own `<select>` options show, reused
 * verbatim in the print context summary so the printed page states every applied filter (mirrors
 * every sibling report's identical print-content-verification pattern). */
function triStateSummaryLabel(state: TriState): string {
  return state === 'ALL' ? 'All' : state === 'YES' ? 'Yes' : 'No';
}

function candidateSummaryLabel(candidate: Pick<VarianceReportEmployeeCandidate, 'name' | 'employeeCode'>): string {
  return candidate.employeeCode ? `${candidate.name} (${candidate.employeeCode})` : candidate.name;
}

/** `cycles` is always newest-first (the backend's own `[{ year: 'desc' }, { month: 'desc' }]`
 * ordering — same list every historical selector already relies on), so the entry immediately
 * *after* the current cycle's own index is chronologically the immediately-preceding cycle.
 * `undefined` when `currentCycleId` is the oldest cycle in the list (nothing to default to) —
 * Checkpoint 1B §4 requires this default only "where one exists," never a forced/synthetic pick. */
function resolveDefaultComparisonCycleId(cycles: PayrollCycle[], currentCycleId: string): string | undefined {
  const index = cycles.findIndex((c) => c.id === currentCycleId);
  if (index === -1) return undefined;
  return cycles[index + 1]?.id;
}

const DIRECTION_OPTIONS = VARIANCE_REPORT_DIRECTION_VALUES;
const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORT_BUTTON_LABEL: Record<ExportFormat, string> = { csv: 'Export CSV', xlsx: 'Export Excel' };

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

function summaryCardValue(id: SummaryCardFieldId, totals: VarianceReportTotals): string {
  switch (id) {
    case 'comparisonTotalNet':
      return formatMoney(totals.comparisonTotalNet);
    case 'currentTotalNet':
      return formatMoney(totals.currentTotalNet);
    case 'aggregateVarianceAmount':
      return formatMoney(totals.aggregateVarianceAmount);
    case 'aggregateVariancePercent':
      return totals.aggregateVariancePercent !== null ? `${totals.aggregateVariancePercent}%` : '—';
    case 'matchingCount':
      return String(totals.matchingCount);
    case 'newEmployeeCount':
      return String(totals.newEmployeeCount);
    case 'departedEmployeeCount':
      return String(totals.departedEmployeeCount);
    case 'continuedEmployeeCount':
      return String(totals.continuedEmployeeCount);
    case 'increasedCount':
      return String(totals.increasedCount);
    case 'decreasedCount':
      return String(totals.decreasedCount);
    case 'unchangedCount':
      return String(totals.unchangedCount);
    case 'siteTransferCount':
      return String(totals.siteTransferCount);
    case 'correctedEntryCount':
      return String(totals.correctedEntryCount);
  }
}

function printColumnValue(id: TableColumnFieldId, row: VarianceReportRow): string {
  switch (id) {
    case 'employeeCode':
      return row.employeeCode ?? '—';
    case 'employeeName':
      return row.employeeName;
    case 'populationStatus':
      return populationStatusLabel(row.populationStatus);
    case 'direction':
      return row.direction ? directionLabel(row.direction) : '—';
    case 'comparisonSite':
      return row.comparisonSiteName ?? '—';
    case 'currentSite':
      return row.currentSiteName ?? '—';
    case 'comparisonNet':
      return formatMoney(row.comparisonNet);
    case 'currentNet':
      return formatMoney(row.currentNet);
    case 'varianceAmount':
      return formatMoney(row.varianceAmount);
    case 'variancePercent':
      return row.variancePercent !== null ? `${row.variancePercent}%` : '—';
    case 'siteTransfer':
      return row.siteTransfer ? 'Yes' : 'No';
    case 'unitChange':
      return row.unitChange ? 'Yes' : 'No';
    case 'hasComparisonCorrection':
      return row.hasComparisonCorrection ? 'Yes' : 'No';
    case 'hasCurrentCorrection':
      return row.hasCurrentCorrection ? 'Yes' : 'No';
  }
}

/**
 * Phase 7 Reports, Variance / Month-on-Month Report Checkpoint 1B — the frontend for the frozen
 * Checkpoint 1A backend (`GET /api/v1/reports/variance` and its two siblings,
 * `docs/architecture/workflows/reports.md`'s own Variance section). Gated on `reports:view` alone —
 * no `statements:view`, no OR gate (frozen Checkpoint 1A decision).
 *
 * The first cross-cycle report in this module: report grain is one row per Employee, paired by
 * `employeeId` across two explicit, independently-choosable Payroll Cycles. Both Cycle ids live in
 * the URL (`?currentCycleId=...&comparisonCycleId=...`), never local-only state — bookmarkable, and
 * Browser Back/Forward restores the exact comparison being viewed. Comparison Cycle intelligently
 * defaults to the immediately-preceding cycle once a Current Cycle is known (only when no explicit
 * `comparisonCycleId` is already present), but arbitrary, non-adjacent comparison is always
 * available by picking any other cycle — the API itself never infers "previous month," and neither
 * does this page beyond that one initial default. Every financial figure rendered is the backend's
 * own already-computed `calcNet`-derived value — this page never computes Net Salary itself and
 * never replays a correction into the compared figure.
 */
export function ReportsVarianceReportPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.REPORTS_VIEW);
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const currentCycleId = searchParams.get('currentCycleId') ?? '';
  const comparisonCycleId = searchParams.get('comparisonCycleId') ?? '';

  const cyclesQuery = usePayrollCycles();
  const cycles = useMemo(() => cyclesQuery.data ?? [], [cyclesQuery.data]);
  const hasAnyCycle = cycles.length > 0;

  // Smart defaults — applied once cycles are loaded and a URL param is genuinely absent. Never
  // touches an explicit, already-present id (even an invalid one) — the report's own error state
  // is what surfaces a bad id, matching every sibling cycle-aware page's identical "never silently
  // redirected away from an explicit URL" convention. Uses `replace` so an automatic default never
  // grows the Back-stack; an explicit user pick (the `<select>` handlers below) always pushes, so
  // Back/Forward can restore a prior comparison (Checkpoint 1B §19).
  useEffect(() => {
    if (cyclesQuery.isLoading || cycles.length === 0) return;
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;

    let effectiveCurrentId = currentCycleId;
    if (!effectiveCurrentId) {
      const defaultId = resolveDefaultCycleId(cycles);
      if (defaultId) {
        effectiveCurrentId = defaultId;
        nextParams.set('currentCycleId', defaultId);
        changed = true;
      }
    }

    if (effectiveCurrentId && !comparisonCycleId) {
      const defaultComparisonId = resolveDefaultComparisonCycleId(cycles, effectiveCurrentId);
      if (defaultComparisonId) {
        nextParams.set('comparisonCycleId', defaultComparisonId);
        changed = true;
      }
    }

    if (changed) setSearchParams(nextParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cyclesQuery.isLoading, cycles, currentCycleId, comparisonCycleId]);

  function selectCurrentCycle(id: string) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('currentCycleId', id);
    setSearchParams(nextParams);
  }

  function selectComparisonCycle(id: string) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('comparisonCycleId', id);
    setSearchParams(nextParams);
  }

  const sites = useAccessibleProjectSites(user);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [unitId, setUnitId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<VarianceReportEmployeeCandidate | undefined>(undefined);
  const [direction, setDirection] = useState<VarianceReportDirection | ''>('');
  const [hasCorrection, setHasCorrection] = useState<TriState>('ALL');
  const [sortBy, setSortBy] = useState<VarianceReportSortField>('employeeName');
  const [sortDir, setSortDir] = useState<VarianceReportSortDirection>('asc');
  const [page, setPage] = useState(1);
  const [activeExport, setActiveExport] = useState<ExportFormat | null>(null);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState<VarianceReportPrintSelection>(DEFAULT_PRINT_SELECTION);
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

  // A filter, sort, or either Cycle change invalidates whichever page was previously being viewed —
  // never silently keep showing "page 3" of a now-different filtered/sorted/compared result.
  useEffect(() => {
    setPage(1);
  }, [currentCycleId, comparisonCycleId, selectedSiteIdsKey, unitId, employeeId, direction, hasCorrection, sortBy, sortDir]);

  const filters: VarianceReportFilters = {
    currentCycleId,
    comparisonCycleId,
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    unitId: unitId || undefined,
    employeeId: employeeId || undefined,
    direction: direction || undefined,
    hasCorrection: triStateToBoolean(hasCorrection),
  };

  // No report request is ever made without BOTH Cycles — `useVarianceReportList` is disabled
  // internally whenever either id is empty.
  const report = useVarianceReportList({
    ...filters,
    page,
    pageSize: VARIANCE_REPORT_PAGE_SIZE,
    sortBy,
    sortDir,
  });

  // Narrow safeguard, independent of the filter/sort/Cycle page-reset effect above: if the backend
  // total for the *currently requested* page shrinks below the page being viewed, clamp down to the
  // new last valid page rather than silently showing a stale, empty page as if it were current data.
  useEffect(() => {
    if (!report.data) return;
    const lastValidPage = Math.max(1, Math.ceil(report.data.total / report.data.pageSize));
    if (page > 1 && page > lastValidPage) {
      setPage(lastValidPage);
    }
  }, [report.data, page]);

  const siteOptions = useMemo(() => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })), [sites.data]);

  function handleClearFilters() {
    // Clear Filters restores the approved filter defaults but never touches either selected Cycle —
    // the Cycle selectors are navigation/report-state controls, not filters. Sort is deliberately
    // preserved, matching Salary Release Report's/Employee Payroll History's own established Clear
    // Filters convention (documented choice, Checkpoint 1B §6).
    setSelectedSiteIds([]);
    setUnitId('');
    setEmployeeId('');
    setSelectedCandidate(undefined);
    setDirection('');
    setHasCorrection('ALL');
  }

  function handleSort(field: VarianceReportSortField) {
    if (field === sortBy) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  }

  async function handleExport(format: ExportFormat) {
    if (!report.data || activeExport) return;
    setActiveExport(format);
    try {
      await downloadVarianceReportExport(report.data.currentCycle, report.data.comparisonCycle, filters, sortBy, sortDir, format);
    } catch (error) {
      if (error instanceof VarianceReportExportRowLimitExceededError) {
        toast.error(error.message);
      } else {
        toast.error(error instanceof ApiError ? error.message : `Variance Report ${format.toUpperCase()} export failed`);
      }
    } finally {
      setActiveExport(null);
    }
  }

  function handlePrintConfirm(selection: VarianceReportPrintSelection) {
    flushSync(() => {
      setPrintSelection(selection);
      setPrintOptionsOpen(false);
    });
    triggerPrint({ orientation: 'landscape', fit: 'normal' });
  }

  /** Never a new query — reuses the identical `location.state.listState` mechanism Employee Payroll
   * History's own row already carries (Checkpoint 1B §20). `cnic` is synthesized `null` (this row
   * never carries CNIC) and the site fields fall back across sides so a `DEPARTED` row (no current
   * side) still resolves a display site — neither field is ever rendered by the lookup's own
   * collapsed chip beyond `name`/`employeeCode`, so an approximate site here is harmless. */
  function handleViewFullHistory(row: VarianceReportRow) {
    navigate('/reports/employee-payroll-history', {
      state: {
        listState: {
          employeeId: row.employeeId,
          selectedCandidate: {
            employeeId: row.employeeId,
            employeeCode: row.employeeCode,
            cnic: null,
            currentSiteId: row.currentSiteId ?? row.comparisonSiteId ?? '',
            currentSiteName: row.currentSiteName ?? row.comparisonSiteName ?? '—',
            name: row.employeeName,
          },
        },
      },
    });
  }

  if (!canView) {
    return (
      <AppShell
        user={user}
        title="Variance / Month-on-Month Report"
        subtitle="Employee-level Net Salary comparison between two payroll cycles."
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

  const isLoading = cyclesQuery.isLoading || sites.isLoading;
  const currentCycleObj = report.data?.currentCycle ?? cycles.find((c) => c.id === currentCycleId);
  const comparisonCycleObj = report.data?.comparisonCycle ?? cycles.find((c) => c.id === comparisonCycleId);
  const totals: VarianceReportTotals | undefined = report.data?.totals;
  const filtersActive = Boolean(selectedSiteIds.length || unitId || employeeId || direction || hasCorrection !== 'ALL');
  const bothCyclesSelected = Boolean(currentCycleId) && Boolean(comparisonCycleId);

  return (
    <AppShell
      user={user}
      title="Variance / Month-on-Month Report"
      subtitle="Employee-level Net Salary comparison between two payroll cycles — New/Departed/Continued, transfers, and correction context."
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <PayrollPageToolbar
              title="Variance / Month-on-Month Report"
              filters={
                <>
                  {hasAnyCycle && (
                    <FilterField id="vr-current-cycle" label="Current Cycle">
                      <select
                        id="vr-current-cycle"
                        className={selectClassName}
                        value={currentCycleId}
                        onChange={(e) => selectCurrentCycle(e.target.value)}
                      >
                        {!currentCycleId && <option value="">Select…</option>}
                        {cycles.map((cycle) => (
                          <option key={cycle.id} value={cycle.id}>
                            {formatCycleOptionLabel(cycle)}
                          </option>
                        ))}
                      </select>
                    </FilterField>
                  )}

                  {hasAnyCycle && (
                    <FilterField id="vr-comparison-cycle" label="Comparison Cycle">
                      <select
                        id="vr-comparison-cycle"
                        className={selectClassName}
                        value={comparisonCycleId}
                        onChange={(e) => selectComparisonCycle(e.target.value)}
                      >
                        {!comparisonCycleId && <option value="">Select…</option>}
                        {cycles.map((cycle) => (
                          <option key={cycle.id} value={cycle.id}>
                            {formatCycleOptionLabel(cycle)}
                          </option>
                        ))}
                      </select>
                    </FilterField>
                  )}

                  <MultiSelectFilter
                    id="vr-site-filter"
                    label="Site"
                    options={siteOptions}
                    selectedIds={selectedSiteIds}
                    onChange={setSelectedSiteIds}
                    disabled={report.isFetching}
                  />

                  <FilterField id="vr-unit-filter" label={unitLabel}>
                    <select
                      id="vr-unit-filter"
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

                  <FilterField id="vr-employee-filter" label="Employee">
                    <VarianceReportEmployeeLookup
                      id="vr-employee-filter"
                      value={employeeId}
                      selectedCandidate={selectedCandidate}
                      onChange={(id, candidate) => {
                        setEmployeeId(id);
                        setSelectedCandidate(candidate);
                      }}
                      siteId={singleSiteId}
                      unitId={unitId || undefined}
                      disabled={report.isFetching}
                    />
                  </FilterField>

                  <FilterField id="vr-direction" label="Direction">
                    <select
                      id="vr-direction"
                      className={selectClassName}
                      value={direction}
                      onChange={(e) => setDirection(e.target.value as VarianceReportDirection | '')}
                      disabled={report.isFetching}
                    >
                      <option value="">All</option>
                      {DIRECTION_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {directionLabel(value)}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField id="vr-has-correction" label="Has Correction">
                    <select
                      id="vr-has-correction"
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
                  <Button variant="secondary" onClick={() => setPrintOptionsOpen(true)} disabled={activeExport !== null || !bothCyclesSelected}>
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
            {currentCycleObj && comparisonCycleObj && (
              <div className="flex flex-wrap items-center gap-2 px-[18px] pt-[18px] text-xs text-text-muted print:hidden">
                <span>
                  Current: <span className="font-medium text-text">{formatCycleLabel(currentCycleObj)}</span>
                </span>
                <span aria-hidden>·</span>
                <span>
                  Compared with: <span className="font-medium text-text">{formatCycleLabel(comparisonCycleObj)}</span>
                </span>
              </div>
            )}

            {currentCycleObj && comparisonCycleObj && (
              <div className="px-[18px] pt-[18px]">
                <PrintContextHeader
                  title="Variance / Month-on-Month Report"
                  context={[
                    `Current: ${formatCycleLabel(currentCycleObj)}`,
                    `Compared with: ${formatCycleLabel(comparisonCycleObj)}`,
                    `Site: ${selectedSiteIds.length ? `${selectedSiteIds.length} selected` : 'All'}`,
                    `Unit: ${unitId ? (units.data?.find((u) => u.id === unitId)?.name ?? unitId) : 'Any'}`,
                    `Employee: ${selectedCandidate ? candidateSummaryLabel(selectedCandidate) : 'All'}`,
                    `Direction: ${direction ? directionLabel(direction) : 'All'}`,
                    `Has Correction: ${triStateSummaryLabel(hasCorrection)}`,
                    'Variance = Current Net − Comparison Net',
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

            {!isLoading && cyclesQuery.error && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load payroll cycles</p>
                <p className="text-xs text-text-muted">{cyclesQuery.error.message}</p>
              </div>
            )}

            {!isLoading && !cyclesQuery.error && !hasAnyCycle && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-text">No payroll cycles exist yet</p>
                <p className="text-xs text-text-muted">A Variance Report can only be generated once at least one payroll cycle exists.</p>
              </div>
            )}

            {!isLoading && !cyclesQuery.error && hasAnyCycle && !bothCyclesSelected && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-text">Select a Current Cycle and a Comparison Cycle</p>
                <p className="text-xs text-text-muted">Choose both payroll cycles above to generate this comparison.</p>
              </div>
            )}

            {!isLoading && !cyclesQuery.error && bothCyclesSelected && report.error && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load the Variance Report</p>
                <p className="text-xs text-text-muted">
                  {report.error instanceof ApiError ? report.error.message : 'Something went wrong'}
                </p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => report.refetch()}>
                  Try Again
                </Button>
              </div>
            )}

            {!isLoading && !report.error && bothCyclesSelected && report.isLoading && (
              <div className="flex flex-col gap-2 p-[18px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}

            {!isLoading && !report.error && !report.isLoading && report.data && (
              <div className="flex flex-col gap-4 p-[18px] print:p-0">
                {report.data.total === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-14 text-center">
                    <p className="text-xs font-medium text-text">
                      {filtersActive ? 'No employees match these filters' : 'No employee-level variance data for this comparison'}
                    </p>
                    <p className="max-w-sm text-xs text-text-muted">
                      {filtersActive
                        ? 'Try a different filter combination, or use Clear Filters to start over.'
                        : 'Neither cycle has any accessible payroll entries to compare.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {totals && (
                      <div data-testid="on-screen-cards" className="flex flex-col gap-3 print:hidden">
                        <div>
                          <StatGroupLabel>Financial Totals</StatGroupLabel>
                          {totals.totalsComputed ? (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              <StatFigure label="Comparison Total Net" value={formatMoney(totals.comparisonTotalNet)} testId="vr-stat-comparison-total-net" />
                              <StatFigure label="Current Total Net" value={formatMoney(totals.currentTotalNet)} testId="vr-stat-current-total-net" />
                              <StatFigure label="Aggregate Variance" value={formatMoney(totals.aggregateVarianceAmount)} testId="vr-stat-aggregate-variance" />
                              <StatFigure
                                label="Aggregate Variance %"
                                value={totals.aggregateVariancePercent !== null ? `${totals.aggregateVariancePercent}%` : '—'}
                                testId="vr-stat-aggregate-variance-percent"
                              />
                            </div>
                          ) : (
                            <div className="flex flex-col justify-center rounded border border-border bg-surface px-3.5 py-3" data-testid="vr-totals-unavailable">
                              <span className="text-xs text-text-muted">
                                Totals are unavailable for this result size. Narrow the filters to calculate totals.
                              </span>
                            </div>
                          )}
                        </div>

                        <div>
                          <StatGroupLabel>Population &amp; Direction</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatFigure label="Matching Employees" value={String(totals.matchingCount)} testId="vr-stat-matching" />
                            <StatFigure label="New" value={String(totals.newEmployeeCount)} testId="vr-stat-new" />
                            <StatFigure label="Departed" value={String(totals.departedEmployeeCount)} testId="vr-stat-departed" />
                            <StatFigure label="Continued" value={String(totals.continuedEmployeeCount)} testId="vr-stat-continued" />
                            <StatFigure label="Increased" value={String(totals.increasedCount)} testId="vr-stat-increased" />
                            <StatFigure label="Decreased" value={String(totals.decreasedCount)} testId="vr-stat-decreased" />
                            <StatFigure label="Unchanged" value={String(totals.unchangedCount)} testId="vr-stat-unchanged" />
                            <StatFigure label="Site Transfers" value={String(totals.siteTransferCount)} testId="vr-stat-site-transfers" />
                            <StatFigure label="Corrected Entries" value={String(totals.correctedEntryCount)} testId="vr-stat-corrected-entries" />
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
                            <SortableHead field="populationStatus" label="Population Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <TableHead className="whitespace-nowrap">Direction</TableHead>
                            <SortableHead field="comparisonSite" label="Comparison Site" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="currentSite" label="Current Site" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="comparisonNet" label="Previous Net" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                            <SortableHead field="currentNet" label="Current Net" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                            <SortableHead field="varianceAmount" label="Variance Amount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                            <TableHead className="whitespace-nowrap text-right">Variance %</TableHead>
                            <TableHead className="whitespace-nowrap">Site Transfer</TableHead>
                            <TableHead className="whitespace-nowrap">Unit Change</TableHead>
                            <TableHead className="whitespace-nowrap">Has Comparison Correction</TableHead>
                            <TableHead className="whitespace-nowrap">Has Current Correction</TableHead>
                            <TableHead className="whitespace-nowrap">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.rows.map((row) => (
                            <TableRow key={row.employeeId}>
                              <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                              <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone={populationStatusTone(row.populationStatus)}>{populationStatusLabel(row.populationStatus)}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {row.direction ? <Badge tone={directionTone(row.direction)}>{directionLabel(row.direction)}</Badge> : '—'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{row.comparisonSiteName ?? '—'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.currentSiteName ?? '—'}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.comparisonNet)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.currentNet)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.varianceAmount)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {row.variancePercent !== null ? `${row.variancePercent}%` : '—'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {row.siteTransfer ? <Badge tone="amber">Yes</Badge> : 'No'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{row.unitChange ? <Badge tone="amber">Yes</Badge> : 'No'}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {row.hasComparisonCorrection ? <Badge tone="amber">Yes</Badge> : 'No'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {row.hasCurrentCorrection ? <Badge tone="amber">Yes</Badge> : 'No'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Button size="sm" variant="secondary" onClick={() => handleViewFullHistory(row)}>
                                  View Full History
                                </Button>
                              </TableCell>
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
                            <TableRow key={row.employeeId}>
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
      <VarianceReportPrintOptionsDialog open={printOptionsOpen} onOpenChange={setPrintOptionsOpen} onConfirm={handlePrintConfirm} />
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
  field: VarianceReportSortField;
  label: string;
  sortBy: VarianceReportSortField;
  sortDir: VarianceReportSortDirection;
  onSort: (field: VarianceReportSortField) => void;
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
