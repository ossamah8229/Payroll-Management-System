import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Download, Info, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatDate,
  formatMoney,
  PERMISSIONS,
  type AdvanceRecoveryReportEmployeeCandidate,
  type AdvanceRecoveryReportRow,
  type AdvanceRecoveryReportSortDirection,
  type AdvanceRecoveryReportSortField,
  type AdvanceRecoveryReportTotals,
  type AdvanceStatus,
  type AdvanceType,
  type SessionUser,
} from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { FilterField } from '@/components/ui/filter-field';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { usePayrollCycles, formatCycleLabel, formatCycleOptionLabel } from '@/hooks/use-payroll-cycles';
import { PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import { ReportPagination } from '@/components/reports/report-pagination';
import { useTriggerPrint } from '@/components/print/use-print';
import { AdvanceRecoveryReportPrintOptionsDialog } from '@/components/reports/advance-recovery-report-print-options-dialog';
import {
  DEFAULT_PRINT_SELECTION,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  type AdvanceRecoveryReportPrintSelection,
  type SummaryCardFieldId,
  type TableColumnFieldId,
} from '@/components/reports/advance-recovery-report-print-fields';
import {
  advanceStatusLabel,
  advanceStatusTone,
  advanceTypeLabel,
  repaymentTypeLabel,
} from '@/components/reports/advance-recovery-report-labels';
import { AdvanceRecoveryReportEmployeeLookup } from '@/components/reports/advance-recovery-report-employee-lookup';
import {
  ADVANCE_RECOVERY_REPORT_PAGE_SIZE,
  AdvanceRecoveryReportExportRowLimitExceededError,
  downloadAdvanceRecoveryReportExport,
  useAdvanceRecoveryReportList,
  type AdvanceRecoveryReportFilters,
} from '@/hooks/use-advance-recovery-report';

type TriState = 'ALL' | 'YES' | 'NO';

function triStateToBoolean(state: TriState): boolean | undefined {
  return state === 'ALL' ? undefined : state === 'YES';
}

function triStateSummaryLabel(state: TriState): string {
  return state === 'ALL' ? 'All' : state === 'YES' ? 'Yes' : 'No';
}

const ADVANCE_TYPE_OPTIONS: AdvanceType[] = ['LOAN', 'EID_ADVANCE'];
const STATUS_OPTIONS: AdvanceStatus[] = ['ACTIVE', 'RESERVED', 'PAID_OFF', 'CANCELLED'];
const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORT_BUTTON_LABEL: Record<ExportFormat, string> = { csv: 'Export CSV', xlsx: 'Export Excel' };

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The filter/sort/page selection carried via `useNavigate`'s own `state` option when opening a row's
 * detail page — mirrors `EmployeePayrollHistoryListNavigationState`'s own established pattern
 * (`location.state`, not a new global store or URL query serialization). `cycleId` is carried
 * separately from the filter fields below because it drives the URL itself (a navigation control,
 * §2.6 of `docs/design-system.md`), not a filter restored into local state.
 */
export interface AdvanceRecoveryReportListNavigationState {
  cycleId: string | undefined;
  selectedSiteIds: string[];
  employeeId: string;
  selectedCandidate: AdvanceRecoveryReportEmployeeCandidate | undefined;
  advanceType: AdvanceType | '';
  status: AdvanceStatus | '';
  hasOutstandingBalance: TriState;
  sortBy: AdvanceRecoveryReportSortField;
  sortDir: AdvanceRecoveryReportSortDirection;
  page: number;
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

function summaryCardValue(id: SummaryCardFieldId, totals: AdvanceRecoveryReportTotals): string {
  switch (id) {
    case 'matchingAdvanceCount':
      return String(totals.matchingAdvanceCount);
    case 'employeesWithAdvanceCount':
      return String(totals.employeesWithAdvanceCount);
    case 'loanOriginalAmount':
      return formatMoney(totals.loan.originalAmountTotal);
    case 'loanRecoveredToDate':
      return formatMoney(totals.loan.recoveredToDateTotal);
    case 'loanOutstandingBalance':
      return formatMoney(totals.loan.currentOutstandingBalanceTotal);
    case 'eidOriginalAmount':
      return formatMoney(totals.eidAdvance.originalAmountTotal);
    case 'eidRecoveredToDate':
      return formatMoney(totals.eidAdvance.recoveredToDateTotal);
    case 'eidOutstandingBalance':
      return formatMoney(totals.eidAdvance.currentOutstandingBalanceTotal);
    case 'activeCount':
      return String(totals.activeCount);
    case 'reservedCount':
      return String(totals.reservedCount);
    case 'paidOffCount':
      return String(totals.paidOffCount);
    case 'cancelledCount':
      return String(totals.cancelledCount);
    case 'recoveredThisCycleTotal':
      return totals.recoveredThisCycleTotal !== null ? formatMoney(totals.recoveredThisCycleTotal) : 'Not selected';
  }
}

function printColumnValue(id: TableColumnFieldId, row: AdvanceRecoveryReportRow): string {
  switch (id) {
    case 'employeeCode':
      return row.employeeCode ?? '—';
    case 'employeeName':
      return row.employeeName;
    case 'siteName':
      return row.siteName;
    case 'advanceType':
      return advanceTypeLabel(row.advanceType);
    case 'originalAmount':
      return formatMoney(row.originalAmount);
    case 'recoveredToDate':
      return formatMoney(row.recoveredToDate);
    case 'currentOutstandingBalance':
      return formatMoney(row.currentOutstandingBalance);
    case 'status':
      return advanceStatusLabel(row.status);
    case 'repaymentType':
      return repaymentTypeLabel(row.repaymentType);
    case 'dateGiven':
      return formatDate(row.dateGiven) || '—';
    case 'recoveredThisCycle':
      return row.recoveredThisCycle !== null ? formatMoney(row.recoveredThisCycle) : 'Not selected';
  }
}

/**
 * Phase 7 Reports, Advance Recovery Report Checkpoint 1B — the frontend for the frozen Checkpoint 1A
 * backend (`GET /api/v1/reports/advance-recovery` and its `employees`/`export`/`:advanceId` siblings,
 * `docs/architecture/workflows/reports.md` §19). Gated on `reports:view`, the same permission every
 * other operational report in this module uses.
 *
 * **Cycle is OPTIONAL** — deliberately unlike every sibling report's own required-single-cycle shape.
 * This page therefore does not use `useSelectedPayrollCycle` (which force-redirects a flat route to a
 * resolved default cycle) — the `:cycleId` route param is read directly and never defaulted, so the
 * flat `/reports/advance-recovery` route always renders the no-cycle roster until a user explicitly
 * picks one from the Cycle selector. Every row's own Original Amount / Recovered To Date / Current
 * Outstanding Balance / Status / Repayment Type is always the LIVE CURRENT `Advance` figure —
 * selecting a Cycle only ever adds `recoveredThisCycle` context on top, never redefines those current
 * fields (frozen backend decision, §19.1).
 *
 * **Clear Filters behavior (Step 5 decision, documented per the checkpoint brief):** Cycle is treated
 * as a navigation control, not a filter — matching `docs/design-system.md` §2.6 and every sibling
 * report's identical treatment of its own Cycle selector. Clear Filters resets Site/Employee/Advance
 * Type/Status/Has Outstanding Balance to their defaults and resets the page to 1, but leaves the
 * current Cycle selection (in the URL) and the current sort untouched.
 */
export function ReportsAdvanceRecoveryReportPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.REPORTS_VIEW);
  const navigate = useNavigate();
  const location = useLocation();
  const { cycleId: routeCycleId } = useParams<{ cycleId?: string }>();
  const restoredListState = (location.state as { listState?: AdvanceRecoveryReportListNavigationState } | null)
    ?.listState;

  const cyclesQuery = usePayrollCycles();
  const cycles = useMemo(() => cyclesQuery.data ?? [], [cyclesQuery.data]);
  const cycle = routeCycleId ? cycles.find((c) => c.id === routeCycleId) : undefined;
  const hasAnyCycle = cycles.length > 0;

  const sites = useAccessibleProjectSites(user);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>(restoredListState?.selectedSiteIds ?? []);
  const [employeeId, setEmployeeId] = useState(restoredListState?.employeeId ?? '');
  const [selectedCandidate, setSelectedCandidate] = useState<AdvanceRecoveryReportEmployeeCandidate | undefined>(
    restoredListState?.selectedCandidate,
  );
  const [advanceType, setAdvanceType] = useState<AdvanceType | ''>(restoredListState?.advanceType ?? '');
  const [status, setStatus] = useState<AdvanceStatus | ''>(restoredListState?.status ?? '');
  const [hasOutstandingBalance, setHasOutstandingBalance] = useState<TriState>(
    restoredListState?.hasOutstandingBalance ?? 'ALL',
  );
  const [sortBy, setSortBy] = useState<AdvanceRecoveryReportSortField>(restoredListState?.sortBy ?? 'employeeName');
  const [sortDir, setSortDir] = useState<AdvanceRecoveryReportSortDirection>(restoredListState?.sortDir ?? 'asc');
  const [page, setPage] = useState(restoredListState?.page ?? 1);
  const [skipNextPageReset, setSkipNextPageReset] = useState(Boolean(restoredListState));
  const [skipNextEmployeeClear, setSkipNextEmployeeClear] = useState(Boolean(restoredListState));
  const [activeExport, setActiveExport] = useState<ExportFormat | null>(null);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState<AdvanceRecoveryReportPrintSelection>(DEFAULT_PRINT_SELECTION);
  const triggerPrint = useTriggerPrint('landscape');

  const singleSiteId = selectedSiteIds.length === 1 ? selectedSiteIds[0] : undefined;
  const selectedSiteIdsKey = selectedSiteIds.join(',');

  // The Employee lookup is scoped by current Site — if the Site filter narrows to a set that no
  // longer includes the already-selected employee's own current site, the selection is cleared
  // rather than silently kept pointing at an employee now outside the visible scope (Step 11). The
  // very first run after restoring a previous list's navigation state is skipped once, so a validly
  // restored Employee+Site pair is never wiped on mount.
  useEffect(() => {
    if (skipNextEmployeeClear) {
      setSkipNextEmployeeClear(false);
      return;
    }
    if (selectedCandidate && selectedSiteIds.length > 0 && !selectedSiteIds.includes(selectedCandidate.siteId)) {
      setEmployeeId('');
      setSelectedCandidate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteIdsKey]);

  // A filter, sort, or Cycle change invalidates whichever page was previously being viewed — never
  // silently keep showing "page 3" of a now-different filtered/sorted result. The very first run
  // after restoring a previous list's navigation state is skipped once, so a validly restored page
  // number is never immediately reset back to 1.
  useEffect(() => {
    if (skipNextPageReset) {
      setSkipNextPageReset(false);
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCycleId, selectedSiteIdsKey, employeeId, advanceType, status, hasOutstandingBalance, sortBy, sortDir]);

  const filters: AdvanceRecoveryReportFilters = {
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    employeeId: employeeId || undefined,
    advanceType: advanceType || undefined,
    status: status || undefined,
    hasOutstandingBalance: triStateToBoolean(hasOutstandingBalance),
    cycleId: routeCycleId || undefined,
  };

  const report = useAdvanceRecoveryReportList({
    ...filters,
    page,
    pageSize: ADVANCE_RECOVERY_REPORT_PAGE_SIZE,
    sortBy,
    sortDir,
  });

  // Narrow safeguard, independent of the filter/sort/Cycle page-reset effect above: clamp down to
  // the new last valid page if the backend total for the currently requested page shrinks below the
  // page being viewed. Keyed on `report.data` only, since this hook has no `placeholderData`
  // configured — `report.data` is only ever defined once a response for the exact current query key
  // (including `page`) has actually resolved.
  useEffect(() => {
    if (!report.data) return;
    const lastValidPage = Math.max(1, Math.ceil(report.data.total / report.data.pageSize));
    if (page > 1 && page > lastValidPage) {
      setPage(lastValidPage);
    }
  }, [report.data, page]);

  const siteOptions = useMemo(() => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })), [sites.data]);

  const currentListState: AdvanceRecoveryReportListNavigationState = {
    cycleId: routeCycleId,
    selectedSiteIds,
    employeeId,
    selectedCandidate,
    advanceType,
    status,
    hasOutstandingBalance,
    sortBy,
    sortDir,
    page,
  };

  function handleEmployeeChange(id: string, candidate: AdvanceRecoveryReportEmployeeCandidate | undefined) {
    setEmployeeId(id);
    setSelectedCandidate(candidate);
  }

  function handleClearFilters() {
    // Clear Filters restores the approved filter defaults but never touches the currently selected
    // Cycle — the Cycle selector is a navigation control, not a filter (see this page's own doc
    // comment above for the full documented decision).
    setSelectedSiteIds([]);
    setEmployeeId('');
    setSelectedCandidate(undefined);
    setAdvanceType('');
    setStatus('');
    setHasOutstandingBalance('ALL');
  }

  function handleCycleSelect(nextCycleId: string) {
    navigate(nextCycleId ? `/payroll-cycles/${nextCycleId}/reports/advance-recovery` : '/reports/advance-recovery');
  }

  function handleSort(field: AdvanceRecoveryReportSortField) {
    if (field === sortBy) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  }

  async function handleExport(format: ExportFormat) {
    if (activeExport) return;
    setActiveExport(format);
    try {
      await downloadAdvanceRecoveryReportExport(filters, sortBy, sortDir, format);
    } catch (error) {
      if (error instanceof AdvanceRecoveryReportExportRowLimitExceededError) {
        toast.error(error.message);
      } else {
        toast.error(error instanceof ApiError ? error.message : `Advance Recovery Report ${format.toUpperCase()} export failed`);
      }
    } finally {
      setActiveExport(null);
    }
  }

  function handlePrintConfirm(selection: AdvanceRecoveryReportPrintSelection) {
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
        title="Advance Recovery Report"
        subtitle="Track current Advance balances and payroll-cycle recovery history."
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
  const totals = report.data?.totals;
  const filtersActive = Boolean(
    selectedSiteIds.length || employeeId || advanceType || status || hasOutstandingBalance !== 'ALL',
  );

  const disclosureMessage = cycle
    ? `Outstanding Balance and Recovered To Date are current values as of now. Recovered This Cycle reflects only ${formatCycleLabel(cycle)}.`
    : 'Outstanding Balance and Recovered To Date are current values as of now. Select a Payroll Cycle above to see Recovered This Cycle for that cycle — this roster shows every matching Advance regardless.';

  return (
    <AppShell
      user={user}
      title="Advance Recovery Report"
      subtitle="Track current Advance balances and payroll-cycle recovery history."
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <PayrollPageToolbar
              title="Advance Recovery Report"
              badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
              filters={
                <>
                  {hasAnyCycle && (
                    <FilterField id="arr-cycle" label="Cycle">
                      <select
                        id="arr-cycle"
                        className={selectClassName}
                        value={routeCycleId ?? ''}
                        onChange={(e) => handleCycleSelect(e.target.value)}
                        disabled={report.isFetching}
                      >
                        <option value="">All Cycles / No Cycle Context</option>
                        {cycles.map((c) => (
                          <option key={c.id} value={c.id}>
                            {formatCycleOptionLabel(c)}
                          </option>
                        ))}
                      </select>
                    </FilterField>
                  )}

                  <div className="flex min-w-[240px] flex-col gap-1.5">
                    <Label htmlFor="arr-employee">Employee</Label>
                    <AdvanceRecoveryReportEmployeeLookup
                      id="arr-employee"
                      value={employeeId}
                      selectedCandidate={selectedCandidate}
                      onChange={handleEmployeeChange}
                      siteId={singleSiteId}
                      disabled={report.isFetching}
                    />
                  </div>

                  <MultiSelectFilter
                    id="arr-site-filter"
                    label="Site"
                    options={siteOptions}
                    selectedIds={selectedSiteIds}
                    onChange={setSelectedSiteIds}
                    disabled={report.isFetching}
                  />

                  <FilterField id="arr-advance-type" label="Advance Type">
                    <select
                      id="arr-advance-type"
                      className={selectClassName}
                      value={advanceType}
                      onChange={(e) => setAdvanceType(e.target.value as AdvanceType | '')}
                      disabled={report.isFetching}
                    >
                      <option value="">All</option>
                      {ADVANCE_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {advanceTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField id="arr-status" label="Status">
                    <select
                      id="arr-status"
                      className={selectClassName}
                      value={status}
                      onChange={(e) => setStatus(e.target.value as AdvanceStatus | '')}
                      disabled={report.isFetching}
                    >
                      <option value="">All</option>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {advanceStatusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField id="arr-has-outstanding-balance" label="Has Outstanding Balance">
                    <select
                      id="arr-has-outstanding-balance"
                      className={selectClassName}
                      value={hasOutstandingBalance}
                      onChange={(e) => setHasOutstandingBalance(e.target.value as TriState)}
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
                  <Button variant="secondary" onClick={() => setPrintOptionsOpen(true)} disabled={activeExport !== null}>
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
            <div className="px-[18px] pt-[18px]">
              <PrintContextHeader
                title="Advance Recovery Report"
                context={[
                  cycle ? formatCycleLabel(cycle) : 'No Cycle selected — current roster',
                  `Site: ${selectedSiteIds.length ? `${selectedSiteIds.length} selected` : 'All'}`,
                  `Employee: ${selectedCandidate ? selectedCandidate.name : 'All'}`,
                  `Advance Type: ${advanceType ? advanceTypeLabel(advanceType) : 'All'}`,
                  `Status: ${status ? advanceStatusLabel(status) : 'All'}`,
                  `Has Outstanding Balance: ${triStateSummaryLabel(hasOutstandingBalance)}`,
                  'Current page only',
                ].join(' — ')}
                showLogo
              />
            </div>

            <div className="flex items-start gap-2 px-[18px] pt-3 text-xs text-text-muted print:px-0">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
              <p data-testid="arr-current-vs-historical-note">{disclosureMessage}</p>
            </div>

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

            {!isLoading && !cyclesQuery.error && report.error && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load the Advance Recovery Report</p>
                <p className="text-xs text-text-muted">
                  {report.error instanceof ApiError ? report.error.message : 'Something went wrong'}
                </p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => report.refetch()}>
                  Try Again
                </Button>
              </div>
            )}

            {!isLoading && !cyclesQuery.error && !report.error && report.isLoading && (
              <div className="flex flex-col gap-2 p-[18px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}

            {!isLoading && !cyclesQuery.error && !report.error && !report.isLoading && report.data && (
              <div className="flex flex-col gap-4 p-[18px] print:p-0">
                {report.data.total === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-14 text-center">
                    <p className="text-xs font-medium text-text">
                      {filtersActive ? 'No Advances match these filters' : 'No Advances exist yet'}
                    </p>
                    <p className="max-w-sm text-xs text-text-muted">
                      {filtersActive
                        ? 'Try a different filter combination, or use Clear Filters to start over.'
                        : 'Advances appear here once one has been recorded under Advances.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {totals && (
                      <div data-testid="on-screen-cards" className="flex flex-col gap-3 print:hidden">
                        <div>
                          <StatGroupLabel>Summary</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatFigure label="Matching Advances" value={String(totals.matchingAdvanceCount)} testId="arr-stat-matching-advances" />
                            <StatFigure label="Employees With Advances" value={String(totals.employeesWithAdvanceCount)} testId="arr-stat-employees-with-advances" />
                          </div>
                        </div>

                        <div>
                          <StatGroupLabel>Advance</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <StatFigure label="Original Amount" value={formatMoney(totals.loan.originalAmountTotal)} />
                            <StatFigure label="Recovered To Date" value={formatMoney(totals.loan.recoveredToDateTotal)} />
                            <StatFigure label="Current Outstanding Balance" value={formatMoney(totals.loan.currentOutstandingBalanceTotal)} testId="arr-stat-loan-outstanding" />
                          </div>
                        </div>

                        <div>
                          <StatGroupLabel>Eid Advance</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <StatFigure label="Original Amount" value={formatMoney(totals.eidAdvance.originalAmountTotal)} />
                            <StatFigure label="Recovered To Date" value={formatMoney(totals.eidAdvance.recoveredToDateTotal)} />
                            <StatFigure label="Current Outstanding Balance" value={formatMoney(totals.eidAdvance.currentOutstandingBalanceTotal)} testId="arr-stat-eid-outstanding" />
                          </div>
                        </div>

                        <div>
                          <StatGroupLabel>Status</StatGroupLabel>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatFigure label="Active" value={String(totals.activeCount)} />
                            <StatFigure label="Reserved" value={String(totals.reservedCount)} />
                            <StatFigure label="Paid Off" value={String(totals.paidOffCount)} />
                            <StatFigure label="Cancelled" value={String(totals.cancelledCount)} />
                          </div>
                        </div>

                        {totals.recoveredThisCycleTotal !== null && (
                          <div>
                            <StatGroupLabel>Recovered This Cycle</StatGroupLabel>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                              <StatFigure label="Total" value={formatMoney(totals.recoveredThisCycleTotal)} testId="arr-stat-recovered-this-cycle-total" />
                              {totals.recoveredThisCycleTotalByType && (
                                <>
                                  <StatFigure label="Advance" value={formatMoney(totals.recoveredThisCycleTotalByType.loan)} />
                                  <StatFigure label="Eid Advance" value={formatMoney(totals.recoveredThisCycleTotalByType.eidAdvance)} />
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div data-testid="on-screen-table" className="print-flow overflow-x-auto rounded border border-border print:hidden">
                      <Table density="compact" className="min-w-full">
                        <TableHeader>
                          <TableRow>
                            <SortableHead field="employeeCode" label="Employee Code" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="employeeName" label="Employee Name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="site" label="Current Site" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="advanceType" label="Advance Type" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="originalAmount" label="Original Amount" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                            <TableHead className="whitespace-nowrap text-right">Recovered To Date</TableHead>
                            <SortableHead field="currentOutstandingBalance" label="Current Outstanding Balance" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                            <SortableHead field="status" label="Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <TableHead className="whitespace-nowrap">Repayment Type</TableHead>
                            <SortableHead field="dateGiven" label="Date Given" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <TableHead className="whitespace-nowrap text-right">Recovered This Cycle</TableHead>
                            <TableHead className="whitespace-nowrap">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.rows.map((row) => (
                            <TableRow key={row.advanceId}>
                              <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                              <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.siteName}</TableCell>
                              <TableCell className="whitespace-nowrap">{advanceTypeLabel(row.advanceType)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.originalAmount)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.recoveredToDate)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(row.currentOutstandingBalance)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone={advanceStatusTone(row.status)}>{advanceStatusLabel(row.status)}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{repaymentTypeLabel(row.repaymentType)}</TableCell>
                              <TableCell className="whitespace-nowrap">{formatDate(row.dateGiven) || '—'}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums" data-testid={`arr-recovered-this-cycle-${row.advanceId}`}>
                                {row.recoveredThisCycle !== null ? formatMoney(row.recoveredThisCycle) : 'Not selected'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  aria-label={`View Details for ${row.employeeName}`}
                                  onClick={() =>
                                    navigate(`/reports/advance-recovery/${row.advanceId}`, {
                                      state: { listState: currentListState },
                                    })
                                  }
                                >
                                  View Details
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
                            <TableRow key={row.advanceId}>
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
      <AdvanceRecoveryReportPrintOptionsDialog open={printOptionsOpen} onOpenChange={setPrintOptionsOpen} onConfirm={handlePrintConfirm} />
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
  field: AdvanceRecoveryReportSortField;
  label: string;
  sortBy: AdvanceRecoveryReportSortField;
  sortDir: AdvanceRecoveryReportSortDirection;
  onSort: (field: AdvanceRecoveryReportSortField) => void;
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
