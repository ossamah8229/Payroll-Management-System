import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatDate,
  formatMoney,
  PERMISSIONS,
  type EmployeePayrollHistoryEmployeeOption,
  type EmployeePayrollHistoryRosterStatus,
  type EmployeePayrollHistoryRow,
  type EmployeePayrollHistoryRowStatus,
  type EmployeePayrollHistorySortField,
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
import { useProjectUnits } from '@/hooks/use-project-units';
import { usePayrollCycles, formatCycleLabel, formatCycleOptionLabel } from '@/hooks/use-payroll-cycles';
import { ReportPagination } from '@/components/reports/report-pagination';
import { useTriggerPrint } from '@/components/print/use-print';
import { EmployeePayrollHistoryEmployeeLookup } from '@/components/reports/employee-payroll-history-employee-lookup';
import { EmployeePayrollHistoryPrintOptionsDialog } from '@/components/reports/employee-payroll-history-print-options-dialog';
import {
  DEFAULT_PRINT_SELECTION,
  TABLE_COLUMN_FIELDS,
  SUMMARY_CARD_FIELDS,
  type EmployeePayrollHistoryPrintSelection,
  type SummaryCardFieldId,
  type TableColumnFieldId,
} from '@/components/reports/employee-payroll-history-print-fields';
import { primaryUnitLabel, rowStatusLabel, rowStatusTone } from '@/components/reports/employee-payroll-history-labels';
import {
  ExportRowLimitExceededError,
  downloadEmployeePayrollHistoryExport,
  useEmployeePayrollHistoryList,
  EMPLOYEE_PAYROLL_HISTORY_PAGE_SIZE,
  type EmployeePayrollHistoryFilters,
} from '@/hooks/use-employee-payroll-history';

type TriState = 'ALL' | 'YES' | 'NO';

/**
 * The filter/sort/page selection carried via `useNavigate`'s own `state` option when opening a row's
 * detail page (Step 9: "preserve filter state when returning where practical... route location state
 * or URL query serialization... do not invent a custom global state store"). React Router's built-in
 * `location.state` is used rather than a new store or URL query params — no other page in this
 * codebase persists filters into the URL, so query serialization would be a new convention this
 * checkpoint's own scope doesn't call for; `location.state` stays entirely within the router.
 * `EmployeePayrollHistoryDetailPage`'s own "Back to Report" action simply forwards this same object
 * back, and this page seeds its initial filter state from it on mount.
 */
export interface EmployeePayrollHistoryListNavigationState {
  employeeId: string;
  selectedCandidate: EmployeePayrollHistoryEmployeeOption | undefined;
  selectedSiteIds: string[];
  unitId: string;
  fromCycleId: string;
  toCycleId: string;
  rowStatus: EmployeePayrollHistoryRowStatus | '';
  hasCorrection: TriState;
  hasOutstandingOriginBalance: TriState;
  currentEmployeeRosterStatus: EmployeePayrollHistoryRosterStatus | '';
  sortBy: EmployeePayrollHistorySortField;
  sortDir: 'asc' | 'desc';
  page: number;
}

const ROW_STATUS_OPTIONS: EmployeePayrollHistoryRowStatus[] = ['RELEASED', 'HELD', 'NO_PAY_DUE', 'RECOVERY_DUE', 'PENDING'];
const ROSTER_STATUS_OPTIONS: EmployeePayrollHistoryRosterStatus[] = ['ACTIVE', 'DEPARTED'];
const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORT_BUTTON_LABEL: Record<ExportFormat, string> = { csv: 'Export CSV', xlsx: 'Export Excel' };

const SORTABLE_COLUMNS: { field: EmployeePayrollHistorySortField; label: string }[] = [
  { field: 'cycle', label: 'Payroll Month' },
  { field: 'employeeCode', label: 'Employee Code' },
  { field: 'employeeName', label: 'Employee Name' },
  { field: 'site', label: 'Project Site' },
  { field: 'netSalary', label: 'Net Salary' },
  { field: 'rowStatus', label: 'Row Status' },
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

/** `year * 12 + month` — plain chronological comparison for selector sanity-checking only (never
 * sent to the backend; the backend independently re-validates `fromCycleId`/`toCycleId` ordering
 * itself), mirroring `statements-page.tsx`'s own identical helper. */
function cyclePeriodKey(cycle: { year: number; month: number }): number {
  return cycle.year * 12 + cycle.month;
}

function summaryCardValue(
  id: SummaryCardFieldId,
  totals: { matchingCount: number; totalEarnings: string | null; totalDeductions: string | null; netSalaryTotal: string | null; releasedCount: number; heldCount: number; noPayDueCount: number; recoveryDueCount: number; pendingCount: number; correctedEntryCount: number },
): string {
  switch (id) {
    case 'matchingCount':
      return String(totals.matchingCount);
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

/**
 * Employee Payroll History Checkpoint 1B — the frontend for the Checkpoint 1A backend
 * (`GET /api/v1/reports/employee-payroll-history` and its three sibling endpoints,
 * `docs/architecture/workflows/reports.md` §15). Gated on `statements:view`, never `reports:view`
 * (approved decision 1) — this report discloses one employee's cross-cycle payroll history, the
 * same sensitivity class Statements itself already established a dedicated permission for.
 *
 * Every row is always the entry's own *original*, as-released figures — this page never computes
 * `calcNet` itself and never shows a "Corrected Net Salary" (approved decision 3); corrections,
 * balance adjustments, materializations, and settlements are exclusively the detail page's concern.
 * Historical authorization is `PayrollEntry.siteId`, never the employee's current site — selecting
 * an employee via the lookup below is never a claim their complete history is visible, only that a
 * candidate exists; the list endpoint's own row-level authorization decides what actually renders.
 */
export function ReportsEmployeePayrollHistoryPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.STATEMENTS_VIEW);
  const navigate = useNavigate();
  const location = useLocation();
  const restoredListState = (location.state as { listState?: EmployeePayrollHistoryListNavigationState } | null)
    ?.listState;

  const sites = useAccessibleProjectSites(user);
  const cycles = usePayrollCycles();
  const cyclesAscending = useMemo(() => [...(cycles.data ?? [])].reverse(), [cycles.data]);

  const [employeeId, setEmployeeId] = useState(restoredListState?.employeeId ?? '');
  const [selectedCandidate, setSelectedCandidate] = useState<EmployeePayrollHistoryEmployeeOption | undefined>(
    restoredListState?.selectedCandidate,
  );
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>(restoredListState?.selectedSiteIds ?? []);
  const [unitId, setUnitId] = useState(restoredListState?.unitId ?? '');
  const [fromCycleId, setFromCycleId] = useState(restoredListState?.fromCycleId ?? '');
  const [toCycleId, setToCycleId] = useState(restoredListState?.toCycleId ?? '');
  const [rowStatus, setRowStatus] = useState<EmployeePayrollHistoryRowStatus | ''>(restoredListState?.rowStatus ?? '');
  const [hasCorrection, setHasCorrection] = useState<TriState>(restoredListState?.hasCorrection ?? 'ALL');
  const [hasOutstandingOriginBalance, setHasOutstandingOriginBalance] = useState<TriState>(
    restoredListState?.hasOutstandingOriginBalance ?? 'ALL',
  );
  const [currentEmployeeRosterStatus, setCurrentEmployeeRosterStatus] = useState<EmployeePayrollHistoryRosterStatus | ''>(
    restoredListState?.currentEmployeeRosterStatus ?? '',
  );
  const [sortBy, setSortBy] = useState<EmployeePayrollHistorySortField>(restoredListState?.sortBy ?? 'cycle');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(restoredListState?.sortDir ?? 'desc');
  const [page, setPage] = useState(restoredListState?.page ?? 1);
  const [skipNextPageReset, setSkipNextPageReset] = useState(Boolean(restoredListState));
  const [skipNextUnitClear, setSkipNextUnitClear] = useState(Boolean(restoredListState));
  const [activeExport, setActiveExport] = useState<ExportFormat | null>(null);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState<EmployeePayrollHistoryPrintSelection>(DEFAULT_PRINT_SELECTION);
  const triggerPrint = useTriggerPrint('landscape');

  // A Unit only ever means something relative to exactly one Site — Site is a multi-select here
  // (Step 5), so Unit narrowing is only ever meaningful when precisely one Site is currently
  // selected; any other Site-scope change (0 or 2+ sites) clears whichever Unit was chosen.
  const singleSiteId = selectedSiteIds.length === 1 ? selectedSiteIds[0] : undefined;
  const units = useProjectUnits(singleSiteId);
  const selectedSingleSite = sites.data?.find((site) => site.id === singleSiteId);
  const unitLabel = selectedSingleSite?.unitLabel ?? 'Unit';

  // The very first run after restoring a previous list's navigation state is skipped once —
  // otherwise this effect's own mount-time run would immediately wipe a Unit that was validly
  // restored alongside its own matching single-Site selection (mirrors the page-reset effect's
  // own `skipNextPageReset` guard below).
  useEffect(() => {
    if (skipNextUnitClear) {
      setSkipNextUnitClear(false);
      return;
    }
    setUnitId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleSiteId]);

  const fromCycle = cyclesAscending.find((c) => c.id === fromCycleId);
  const toCycle = cyclesAscending.find((c) => c.id === toCycleId);
  const rangeSelectionInvalid = Boolean(fromCycle && toCycle && cyclePeriodKey(fromCycle) > cyclePeriodKey(toCycle));

  const selectedSiteIdsKey = selectedSiteIds.join(',');

  // A filter or sort change invalidates whichever page was previously being viewed — never
  // silently keep showing "page 3" of a now-different filtered/sorted result (Step 3/Step 7). The
  // very first run after restoring a previous list's navigation state is skipped once — otherwise
  // this effect's own mount-time run would immediately reset the just-restored page back to 1.
  useEffect(() => {
    if (skipNextPageReset) {
      setSkipNextPageReset(false);
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    employeeId,
    selectedSiteIdsKey,
    unitId,
    fromCycleId,
    toCycleId,
    rowStatus,
    hasCorrection,
    hasOutstandingOriginBalance,
    currentEmployeeRosterStatus,
    sortBy,
    sortDir,
  ]);

  const filters: EmployeePayrollHistoryFilters = {
    employeeId: employeeId || undefined,
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    unitId: unitId || undefined,
    fromCycleId: fromCycleId || undefined,
    toCycleId: toCycleId || undefined,
    rowStatus: rowStatus || undefined,
    hasCorrection: hasCorrection === 'ALL' ? undefined : hasCorrection === 'YES',
    hasOutstandingOriginBalance: hasOutstandingOriginBalance === 'ALL' ? undefined : hasOutstandingOriginBalance === 'YES',
    currentEmployeeRosterStatus: currentEmployeeRosterStatus || undefined,
  };

  const report = useEmployeePayrollHistoryList(
    { ...filters, page, pageSize: EMPLOYEE_PAYROLL_HISTORY_PAGE_SIZE, sortBy, sortDir },
    !rangeSelectionInvalid,
  );

  const currentListState: EmployeePayrollHistoryListNavigationState = {
    employeeId,
    selectedCandidate,
    selectedSiteIds,
    unitId,
    fromCycleId,
    toCycleId,
    rowStatus,
    hasCorrection,
    hasOutstandingOriginBalance,
    currentEmployeeRosterStatus,
    sortBy,
    sortDir,
    page,
  };

  const siteOptions = useMemo(() => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })), [sites.data]);

  function handleEmployeeChange(id: string, candidate: EmployeePayrollHistoryEmployeeOption | undefined) {
    setEmployeeId(id);
    setSelectedCandidate(candidate);
  }

  function handleClearFilters() {
    setEmployeeId('');
    setSelectedCandidate(undefined);
    setSelectedSiteIds([]);
    setUnitId('');
    setFromCycleId('');
    setToCycleId('');
    setRowStatus('');
    setHasCorrection('ALL');
    setHasOutstandingOriginBalance('ALL');
    setCurrentEmployeeRosterStatus('');
  }

  function handleSort(field: EmployeePayrollHistorySortField) {
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
      await downloadEmployeePayrollHistoryExport(filters, sortBy, sortDir, format);
    } catch (error) {
      if (error instanceof ExportRowLimitExceededError) {
        toast.error(error.message);
      } else {
        toast.error(error instanceof ApiError ? error.message : `Employee Payroll History ${format.toUpperCase()} export failed`);
      }
    } finally {
      setActiveExport(null);
    }
  }

  function handlePrintConfirm(selection: EmployeePayrollHistoryPrintSelection) {
    flushSync(() => {
      setPrintSelection(selection);
      setPrintOptionsOpen(false);
    });
    triggerPrint({ orientation: 'landscape', fit: 'normal' });
  }

  if (!canView) {
    return (
      <AppShell user={user} title="Employee Payroll History" subtitle="Reports">
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
            <p className="text-xs font-medium text-text">You don&apos;t have access to Employee Payroll History</p>
            <p className="text-xs text-text-muted">Contact a Master User if you believe this is a mistake.</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const totals = report.data?.totals;

  return (
    <AppShell
      user={user}
      title="Employee Payroll History"
      subtitle="One employee's cross-cycle original payroll results — corrections and settlements live in the detail view"
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <PayrollPageToolbar
              title="Employee Payroll History"
              filters={
                <>
                  <div className="flex min-w-[240px] flex-col gap-1.5">
                    <Label htmlFor="eph-employee">Employee</Label>
                    <EmployeePayrollHistoryEmployeeLookup
                      id="eph-employee"
                      value={employeeId}
                      selectedCandidate={selectedCandidate}
                      onChange={handleEmployeeChange}
                      siteId={singleSiteId}
                      unitId={unitId || undefined}
                      disabled={report.isFetching}
                    />
                  </div>

                  <MultiSelectFilter
                    id="eph-site-filter"
                    label="Site"
                    options={siteOptions}
                    selectedIds={selectedSiteIds}
                    onChange={setSelectedSiteIds}
                    disabled={report.isFetching}
                  />

                  <FilterField id="eph-unit-filter" label={unitLabel}>
                    <select
                      id="eph-unit-filter"
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

                  <FilterField id="eph-from-cycle" label="Cycle From">
                    <select
                      id="eph-from-cycle"
                      className={selectClassName}
                      value={fromCycleId}
                      onChange={(e) => setFromCycleId(e.target.value)}
                      disabled={report.isFetching}
                    >
                      <option value="">Any</option>
                      {cyclesAscending.map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>
                          {formatCycleOptionLabel(cycle)}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField id="eph-to-cycle" label="Cycle To">
                    <select
                      id="eph-to-cycle"
                      className={selectClassName}
                      value={toCycleId}
                      onChange={(e) => setToCycleId(e.target.value)}
                      disabled={report.isFetching}
                    >
                      <option value="">Any</option>
                      {cyclesAscending.map((cycle) => (
                        <option key={cycle.id} value={cycle.id}>
                          {formatCycleOptionLabel(cycle)}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField id="eph-row-status" label="Row Status">
                    <select
                      id="eph-row-status"
                      className={selectClassName}
                      value={rowStatus}
                      onChange={(e) => setRowStatus(e.target.value as EmployeePayrollHistoryRowStatus | '')}
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

                  <FilterField id="eph-has-correction" label="Has Correction">
                    <select
                      id="eph-has-correction"
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

                  <FilterField id="eph-has-outstanding" label="Has Outstanding Origin Balance">
                    <select
                      id="eph-has-outstanding"
                      className={selectClassName}
                      value={hasOutstandingOriginBalance}
                      onChange={(e) => setHasOutstandingOriginBalance(e.target.value as TriState)}
                      disabled={report.isFetching}
                    >
                      <option value="ALL">All</option>
                      <option value="YES">Yes</option>
                      <option value="NO">No</option>
                    </select>
                  </FilterField>

                  <FilterField id="eph-roster-status" label="Current Roster Status">
                    <select
                      id="eph-roster-status"
                      className={selectClassName}
                      value={currentEmployeeRosterStatus}
                      onChange={(e) => setCurrentEmployeeRosterStatus(e.target.value as EmployeePayrollHistoryRosterStatus | '')}
                      disabled={report.isFetching}
                    >
                      <option value="">All</option>
                      {ROSTER_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status === 'ACTIVE' ? 'Active' : 'Departed'}
                        </option>
                      ))}
                    </select>
                  </FilterField>

                  <div className="flex flex-col gap-1.5">
                    <Label aria-hidden className="invisible select-none">
                      spacer
                    </Label>
                    <Button variant="secondary" size="default" onClick={handleClearFilters}>
                      Clear Filters
                    </Button>
                  </div>
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
              <PrintContextHeader title="Employee Payroll History" context="Filtered payroll history — see filter summary above the table" />
            </div>

            {rangeSelectionInvalid && (
              <div className="px-[18px] pb-2">
                <p className="text-[11px] text-danger">Cycle From must not be later than Cycle To.</p>
              </div>
            )}

            {(sites.isLoading || cycles.isLoading) && (
              <div className="flex flex-col gap-2 p-[18px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}

            {!sites.isLoading && !cycles.isLoading && !rangeSelectionInvalid && report.isLoading && (
              <div className="flex flex-col gap-2 p-[18px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}

            {!sites.isLoading && !cycles.isLoading && !rangeSelectionInvalid && !report.isLoading && report.error && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load Employee Payroll History</p>
                <p className="max-w-md text-xs text-text-muted">
                  {report.error instanceof ApiError ? report.error.message : 'Something went wrong'}
                </p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => report.refetch()}>
                  Try Again
                </Button>
              </div>
            )}

            {!sites.isLoading &&
              !cycles.isLoading &&
              !rangeSelectionInvalid &&
              !report.isLoading &&
              !report.error &&
              report.data && (
                <div className="flex flex-col gap-4 p-[18px] print:p-0">
                  {report.data.total === 0 ? (
                    <div className="flex flex-col items-center gap-1 py-14 text-center">
                      <p className="text-xs font-medium text-text">
                        {employeeId || selectedSiteIds.length || unitId || fromCycleId || toCycleId || rowStatus || currentEmployeeRosterStatus || hasCorrection !== 'ALL' || hasOutstandingOriginBalance !== 'ALL'
                          ? 'No payroll history matches these filters'
                          : 'No payroll history exists yet'}
                      </p>
                      <p className="max-w-sm text-xs text-text-muted">
                        {employeeId || selectedSiteIds.length || unitId || fromCycleId || toCycleId || rowStatus || currentEmployeeRosterStatus || hasCorrection !== 'ALL' || hasOutstandingOriginBalance !== 'ALL'
                          ? 'Try a different filter combination, or use Clear Filters to start over.'
                          : 'Payroll history appears here once payroll cycles have been created and released.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {totals && (
                        <div data-testid="on-screen-cards" className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
                          <StatFigure
                            label="Matching Entries"
                            value={String(totals.matchingCount)}
                            testId="eph-stat-matching-entries"
                          />
                          {totals.totalsComputed ? (
                            <>
                              <StatFigure label="Total Earnings" value={formatMoney(totals.totalEarnings ?? '0')} />
                              <StatFigure label="Total Deductions" value={formatMoney(totals.totalDeductions ?? '0')} />
                              <StatFigure label="Net Salary" value={formatMoney(totals.netSalaryTotal ?? '0')} />
                            </>
                          ) : (
                            <div className="col-span-2 flex flex-col justify-center rounded border border-border bg-surface px-3.5 py-3 sm:col-span-3">
                              <span className="text-xs text-text-muted">
                                Totals are unavailable for this result size. Narrow the filters to calculate totals.
                              </span>
                            </div>
                          )}
                          <StatFigure label="Released" value={String(totals.releasedCount)} testId="eph-stat-released" />
                          <StatFigure label="Held" value={String(totals.heldCount)} testId="eph-stat-held" />
                          <StatFigure label="No Pay Due" value={String(totals.noPayDueCount)} testId="eph-stat-no-pay-due" />
                          <StatFigure label="Recovery Due" value={String(totals.recoveryDueCount)} testId="eph-stat-recovery-due" />
                          <StatFigure label="Pending" value={String(totals.pendingCount)} testId="eph-stat-pending" />
                          <StatFigure
                            label="Corrected Entries"
                            value={String(totals.correctedEntryCount)}
                            testId="eph-stat-corrected-entries"
                          />
                        </div>
                      )}

                      <div data-testid="on-screen-table" className="print-flow overflow-x-auto rounded border border-border print:hidden">
                        <Table density="compact" className="min-w-full">
                          <TableHeader>
                            <TableRow>
                              {SORTABLE_COLUMNS.slice(0, 4).map((col) => (
                                <SortableHead key={col.field} field={col.field} label={col.label} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                              ))}
                              <TableHead className="whitespace-nowrap">Primary Unit</TableHead>
                              <TableHead className="whitespace-nowrap">Designation</TableHead>
                              <TableHead className="whitespace-nowrap text-right">Total Earnings</TableHead>
                              <TableHead className="whitespace-nowrap text-right">Total Deductions</TableHead>
                              <SortableHead field="netSalary" label="Net Salary" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                              <SortableHead field="rowStatus" label="Row Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                              <TableHead className="whitespace-nowrap text-right">Corrections</TableHead>
                              <TableHead className="whitespace-nowrap">Outstanding Origin Balance</TableHead>
                              <TableHead className="whitespace-nowrap">Released Date</TableHead>
                              <TableHead className="whitespace-nowrap">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.data.rows.map((row) => (
                              <TableRow key={row.payrollEntryId}>
                                <TableCell className="whitespace-nowrap">{formatCycleLabel(row.cycle)}</TableCell>
                                <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                                <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                                <TableCell className="whitespace-nowrap">{row.siteName}</TableCell>
                                <TableCell className="whitespace-nowrap">{primaryUnitLabel(row)}</TableCell>
                                <TableCell className="whitespace-nowrap">{row.designation}</TableCell>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.totalEarnings)}</TableCell>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.totalDeductions)}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(row.netSalary)}</TableCell>
                                <TableCell className="whitespace-nowrap">
                                  <Badge tone={rowStatusTone(row.rowStatus)}>{rowStatusLabel(row.rowStatus)}</Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">
                                  {row.correctionCount > 0 ? <Badge tone="amber">{row.correctionCount}</Badge> : 0}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {row.hasOutstandingOriginBalance ? <Badge tone="amber">Outstanding</Badge> : '—'}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">{formatDate(row.releasedAt) || '—'}</TableCell>
                                <TableCell className="whitespace-nowrap">
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      navigate(`/reports/employee-payroll-history/${row.payrollEntryId}`, {
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

                      {/* Print-only — Version 1 scope (Step 11): the current paginated page only,
                          never an unbounded fetch. Draws from the exact same already-loaded
                          `report.data` the on-screen table above already shows. */}
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
                                <TableHead key={field.id} className={field.id === 'employeeName' ? undefined : undefined}>
                                  {field.label}
                                </TableHead>
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
      <EmployeePayrollHistoryPrintOptionsDialog open={printOptionsOpen} onOpenChange={setPrintOptionsOpen} onConfirm={handlePrintConfirm} />
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
  field: EmployeePayrollHistorySortField;
  label: string;
  sortBy: EmployeePayrollHistorySortField;
  sortDir: 'asc' | 'desc';
  onSort: (field: EmployeePayrollHistorySortField) => void;
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

function printColumnValue(id: TableColumnFieldId, row: EmployeePayrollHistoryRow): string {
  switch (id) {
    case 'cycle':
      return formatCycleLabel(row.cycle);
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
    case 'outstandingOriginBalance':
      return row.hasOutstandingOriginBalance ? 'Outstanding' : '—';
    case 'releasedAt':
      return formatDate(row.releasedAt) || '—';
  }
}
