import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  PERMISSIONS,
  type AssignmentMismatchReadinessRow,
  type AssignmentMismatchReadinessSortDirection,
  type AssignmentMismatchReadinessSortField,
  type AssignmentMismatchShape,
  type SessionUser,
} from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterField } from '@/components/ui/filter-field';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useProjectUnits } from '@/hooks/use-project-units';
import { useCurrentPayrollCycle, formatCycleLabel } from '@/hooks/use-payroll-cycles';
import { PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import { ReportPagination } from '@/components/reports/report-pagination';
import {
  downloadAssignmentMismatchReadinessExport,
  AssignmentMismatchReadinessExportRowLimitExceededError,
  useAssignmentMismatchReadinessList,
  ASSIGNMENT_MISMATCH_READINESS_PAGE_SIZE,
  type AssignmentMismatchReadinessFilters,
} from '@/hooks/use-assignment-mismatch-readiness';

type TriState = 'ALL' | 'YES' | 'NO';

function triStateToBoolean(state: TriState): boolean | undefined {
  return state === 'ALL' ? undefined : state === 'YES';
}

const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];
const EXPORT_BUTTON_LABEL: Record<ExportFormat, string> = { csv: 'Export CSV', xlsx: 'Export Excel' };

const SHAPE_LABEL: Record<AssignmentMismatchShape, string> = { SINGLE_LINE: 'Single Line', SPLIT: 'Split' };

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-50';

interface ReportTotals {
  matchingCount: number;
  siteMismatchCount: number;
  unitOnlyMismatchCount: number;
  splitCount: number;
  heldCount: number;
  safeOneClickShapeCount: number;
}

function StatFigure({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-surface px-3.5 py-3" data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

function unitCellLabel(unit: { name: string; code: string | null }): string {
  return unit.code ?? unit.name;
}

/** Every mismatched Unit gets its own amber-dot marker (the same informational convention the
 * Payroll Entry grid's own per-row indicator already uses) — a matching line renders plain text.
 * Purely display; this page renders no control alongside it. */
function PayrollUnitsCell({ row }: { row: AssignmentMismatchReadinessRow }) {
  return (
    <span className="flex flex-col gap-0.5">
      {row.workLines.map((line) => (
        <span key={line.workLineId} className="flex items-center gap-1 whitespace-nowrap">
          {line.unitMismatch && (
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          )}
          <span>{unitCellLabel(line.unit)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Bulk Assignment-Mismatch Readiness Audit (approved 2026-09-28 architecture review) — a strictly
 * read-only list of Draft `PayrollEntry` rows whose payroll-period Site/Unit attribution no longer
 * matches the employee's current Employee Registry assignment. Gated on `payroll:entry` OR
 * `payroll:view`, the same audience already shown this same mismatch as a per-row amber indicator
 * on the Payroll Entry grid.
 *
 * **This page renders no mutation control of any kind** — no Apply button, no bulk action, no
 * classification/review-state field. `safeOneClickShape` is shown purely as an informational badge
 * ("this specific row happens to be the shape the existing Payroll Entry grid's own 'Apply current
 * assignment' action could fix") — a payroll staff user who wants to act on it still does so from
 * that existing grid, unchanged by this page.
 *
 * Always scoped to the single current Draft cycle (`useCurrentPayrollCycle` — there is only ever at
 * most one Draft cycle system-wide, `docs/architecture/workflows/payroll-lifecycle.md` §4), never a
 * historical-cycle picker: released/archived cycles are frozen history and are never shown here,
 * enforced both by this page (no selector offered) and by the backend itself (400 on a non-Draft
 * `cycleId`).
 */
export function ReportsAssignmentMismatchReadinessPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.PAYROLL_ENTRY) || user.permissions.includes(PERMISSIONS.PAYROLL_VIEW);

  const { cycle, isLoading: cycleLoading, error: cycleError } = useCurrentPayrollCycle();
  const cycleId = cycle?.id;

  const sites = useAccessibleProjectSites(user);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [unitId, setUnitId] = useState('');
  const [shape, setShape] = useState<AssignmentMismatchShape | ''>('');
  const [held, setHeld] = useState<TriState>('ALL');
  const [safeShapeOnly, setSafeShapeOnly] = useState(false);
  const [sortBy, setSortBy] = useState<AssignmentMismatchReadinessSortField>('employeeName');
  const [sortDir, setSortDir] = useState<AssignmentMismatchReadinessSortDirection>('asc');
  const [page, setPage] = useState(1);
  const [activeExport, setActiveExport] = useState<ExportFormat | null>(null);

  // A Unit only ever means something relative to exactly one Site — Site is a multi-select here,
  // so Unit narrowing is only ever meaningful when precisely one Site is currently selected; any
  // other Site-scope change (0 or 2+ sites) clears whichever Unit was chosen.
  const singleSiteId = selectedSiteIds.length === 1 ? selectedSiteIds[0] : undefined;
  const units = useProjectUnits(singleSiteId);
  const selectedSingleSite = sites.data?.find((site) => site.id === singleSiteId);
  const unitLabel = selectedSingleSite?.unitLabel ?? 'Unit';

  useEffect(() => {
    setUnitId('');
  }, [singleSiteId]);

  const selectedSiteIdsKey = selectedSiteIds.join(',');

  // A filter or sort change invalidates whichever page was previously being viewed — never
  // silently keep showing "page 3" of a now-different filtered/sorted result.
  useEffect(() => {
    setPage(1);
  }, [cycleId, selectedSiteIdsKey, unitId, shape, held, safeShapeOnly, sortBy, sortDir]);

  const filters: AssignmentMismatchReadinessFilters = {
    cycleId: cycleId ?? '',
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    unitId: unitId || undefined,
    shape: shape || undefined,
    held: triStateToBoolean(held),
    safeShapeOnly: safeShapeOnly || undefined,
  };

  // No report request is ever made without a Draft cycle — `useAssignmentMismatchReadinessList`
  // is disabled internally whenever `cycleId` is empty.
  const report = useAssignmentMismatchReadinessList({
    ...filters,
    page,
    pageSize: ASSIGNMENT_MISMATCH_READINESS_PAGE_SIZE,
    sortBy,
    sortDir,
  });

  // Narrow safeguard, independent of the filter/sort/cycle page-reset effect above: if the backend
  // total for the currently requested page shrinks below the page being viewed (e.g. someone
  // Applies a fix or releases a Unit while this page sits on page 3), clamp down to the new last
  // valid page rather than silently showing a stale, empty page as if it were current data.
  useEffect(() => {
    if (!report.data) return;
    const lastValidPage = Math.max(1, Math.ceil(report.data.total / report.data.pageSize));
    if (page > 1 && page > lastValidPage) {
      setPage(lastValidPage);
    }
  }, [report.data, page]);

  const siteOptions = useMemo(() => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })), [sites.data]);

  function handleClearFilters() {
    setSelectedSiteIds([]);
    setUnitId('');
    setShape('');
    setHeld('ALL');
    setSafeShapeOnly(false);
  }

  function handleSort(field: AssignmentMismatchReadinessSortField) {
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
      await downloadAssignmentMismatchReadinessExport(cycle, filters, sortBy, sortDir, format);
    } catch (error) {
      if (error instanceof AssignmentMismatchReadinessExportRowLimitExceededError) {
        toast.error(error.message);
      } else {
        toast.error(error instanceof ApiError ? error.message : `Assignment Mismatch Readiness ${format.toUpperCase()} export failed`);
      }
    } finally {
      setActiveExport(null);
    }
  }

  if (!canView) {
    return (
      <AppShell
        user={user}
        title="Assignment Mismatch Readiness"
        subtitle="Draft payroll entries whose Site/Unit attribution no longer matches the employee's current Employee Registry assignment."
      >
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
            <p className="text-xs font-medium text-text">You don&apos;t have access to this report</p>
            <p className="text-xs text-text-muted">Contact a Master User if you believe this is a mistake.</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const isLoading = cycleLoading || sites.isLoading;
  const totals: ReportTotals | undefined = report.data?.totals;
  const filtersActive = Boolean(selectedSiteIds.length || unitId || shape || held !== 'ALL' || safeShapeOnly);

  return (
    <AppShell
      user={user}
      title="Assignment Mismatch Readiness"
      subtitle="Draft payroll entries whose Site/Unit attribution no longer matches the employee's current Employee Registry assignment — read-only."
    >
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-col items-stretch gap-3">
            <PayrollPageToolbar
              title="Assignment Mismatch Readiness"
              badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
              filters={
                <>
                  <MultiSelectFilter
                    id="amr-site-filter"
                    label="Site"
                    options={siteOptions}
                    selectedIds={selectedSiteIds}
                    onChange={setSelectedSiteIds}
                    disabled={report.isFetching}
                  />

                  <FilterField id="amr-unit-filter" label={unitLabel}>
                    <select
                      id="amr-unit-filter"
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

                  <FilterField id="amr-shape-filter" label="Shape">
                    <select
                      id="amr-shape-filter"
                      className={selectClassName}
                      value={shape}
                      onChange={(e) => setShape(e.target.value as AssignmentMismatchShape | '')}
                      disabled={report.isFetching}
                    >
                      <option value="">All</option>
                      <option value="SINGLE_LINE">Single Line</option>
                      <option value="SPLIT">Split</option>
                    </select>
                  </FilterField>

                  <FilterField id="amr-held-filter" label="Held">
                    <select
                      id="amr-held-filter"
                      className={selectClassName}
                      value={held}
                      onChange={(e) => setHeld(e.target.value as TriState)}
                      disabled={report.isFetching}
                    >
                      <option value="ALL">All</option>
                      <option value="YES">Held</option>
                      <option value="NO">Not Held</option>
                    </select>
                  </FilterField>

                  <label className="flex h-9 items-center gap-2 text-xs text-text-muted">
                    <Checkbox
                      checked={safeShapeOnly}
                      onCheckedChange={(checked) => setSafeShapeOnly(checked === true)}
                      disabled={report.isFetching}
                    />
                    Safe one-click shape only
                  </label>

                  <Button variant="secondary" size="default" onClick={handleClearFilters} disabled={report.isFetching}>
                    Clear Filters
                  </Button>
                </>
              }
              actions={
                <>
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
            {/* Informational only — a mismatch is not necessarily an error, and this page offers no
                action to change it (approved pre-PR copy, 2026-09-28 review). */}
            <p className="text-xs text-text-muted" data-testid="amr-explanation">
              Current employee assignment differs from payroll assignment. A mismatch may be intentional, for
              example a payroll deputation or recorded attendance allocation.
            </p>
          </CardHeader>
          <CardContent className="p-0">
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

            {!isLoading && !cycleError && !cycleId && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-text">No Draft payroll cycle right now</p>
                <p className="max-w-sm text-xs text-text-muted">
                  This audit only ever reviews the current Draft cycle — released and archived cycles are frozen
                  history. Check back once a new Draft cycle exists.
                </p>
              </div>
            )}

            {!isLoading && !cycleError && cycleId && report.error && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load Assignment Mismatch Readiness</p>
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
              <div className="flex flex-col gap-4 p-[18px]">
                {report.data.total === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-14 text-center">
                    <p className="text-xs font-medium text-text">
                      {filtersActive ? 'No mismatches match these filters' : 'No assignment mismatches in this cycle'}
                    </p>
                    <p className="max-w-sm text-xs text-text-muted">
                      {filtersActive
                        ? 'Try a different filter combination, or use Clear Filters to start over.'
                        : `Every Draft entry in ${formatCycleLabel(cycle)} already matches its employee's current Site/Unit assignment.`}
                    </p>
                  </div>
                ) : (
                  <>
                    {totals && (
                      <div data-testid="amr-stat-cards" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <StatFigure label="Matching Entries" value={String(totals.matchingCount)} testId="amr-stat-matching" />
                        <StatFigure label="Site Mismatches" value={String(totals.siteMismatchCount)} testId="amr-stat-site" />
                        <StatFigure label="Unit-Only Mismatches" value={String(totals.unitOnlyMismatchCount)} testId="amr-stat-unit" />
                        <StatFigure label="Split Entries" value={String(totals.splitCount)} testId="amr-stat-split" />
                        <StatFigure label="Held" value={String(totals.heldCount)} testId="amr-stat-held" />
                        <StatFigure label="Safe One-Click Shape" value={String(totals.safeOneClickShapeCount)} testId="amr-stat-safe-shape" />
                      </div>
                    )}

                    <div data-testid="amr-table" className="overflow-x-auto rounded border border-border">
                      <Table density="compact" className="min-w-full">
                        <TableHeader>
                          <TableRow>
                            <SortableHead field="employeeCode" label="Employee Code" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="employeeName" label="Employee Name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <SortableHead field="payrollSite" label="Payroll Site" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            <TableHead className="whitespace-nowrap">Payroll Unit(s)</TableHead>
                            <SortableHead
                              field="currentEmployeeSite"
                              label="Current Employee Site"
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                            <TableHead className="whitespace-nowrap">Current Employee Unit</TableHead>
                            <TableHead className="whitespace-nowrap">Shape</TableHead>
                            <TableHead className="whitespace-nowrap">Held</TableHead>
                            <TableHead className="whitespace-nowrap">Attendance/OT</TableHead>
                            <TableHead className="whitespace-nowrap">Safe One-Click Shape</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.rows.map((row) => (
                            <TableRow key={row.payrollEntryId}>
                              <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                              <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <span className="flex items-center gap-1">
                                  {row.siteMismatch && (
                                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                                  )}
                                  {row.payrollSiteName}
                                </span>
                              </TableCell>
                              <TableCell>
                                <PayrollUnitsCell row={row} />
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{row.currentEmployeeSiteName}</TableCell>
                              <TableCell className="whitespace-nowrap">{unitCellLabel(row.currentEmployeeUnit)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone={row.shape === 'SPLIT' ? 'blue' : 'gray'}>{SHAPE_LABEL[row.shape]}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{row.held ? <Badge tone="hold">Held</Badge> : '—'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.hasAttendanceOrOt ? 'Yes' : 'No'}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {row.safeOneClickShape ? <Badge tone="green">Yes</Badge> : <Badge tone="gray">No</Badge>}
                              </TableCell>
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
                      itemLabelPlural="entries"
                    />
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function SortableHead({
  field,
  label,
  sortBy,
  sortDir,
  onSort,
}: {
  field: AssignmentMismatchReadinessSortField;
  label: string;
  sortBy: AssignmentMismatchReadinessSortField;
  sortDir: AssignmentMismatchReadinessSortDirection;
  onSort: (field: AssignmentMismatchReadinessSortField) => void;
}) {
  const isActive = sortBy === field;
  return (
    <TableHead className="whitespace-nowrap" aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors hover:text-text ${
          isActive ? 'text-text' : 'text-text-muted'
        }`}
      >
        {label}
        {isActive &&
          (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />)}
      </button>
    </TableHead>
  );
}
