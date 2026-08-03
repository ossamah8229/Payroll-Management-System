import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Download, Info, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney, PERMISSIONS, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import { ReportPagination } from '@/components/reports/report-pagination';
import { useTriggerPrint } from '@/components/print/use-print';
import { PayrollSummaryPrintOptionsDialog } from '@/components/reports/payroll-summary-print-options-dialog';
import {
  DEFAULT_PRINT_SELECTION,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  isCountField,
  type PayrollSummaryPrintSelection,
  type TableColumnFieldId,
} from '@/components/reports/payroll-summary-print-fields';
import {
  downloadPayrollSummaryExport,
  usePayrollSummaryReport,
  type PayrollSummaryExportFormat,
  type PayrollSummaryFigures,
} from '@/hooks/use-reports';

const REPORT_PAGE_SIZE = 25;

function StatFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-surface px-3.5 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-text">{value}</span>
    </div>
  );
}

/** Cycle-state guidance (Checkpoint 1 brief: "the UI must make cycle state clear... do not silently
 * combine fundamentally different states in a way that makes totals misleading"). This report is
 * always scoped to exactly one cycle, so there is never a mixed-state total to worry about — this
 * banner exists only to tell the reader what the single selected state *means*. */
function CycleStateNotice({ status }: { status: 'DRAFT' | 'RELEASED' | 'ARCHIVED' }) {
  const text =
    status === 'DRAFT'
      ? 'This cycle is still in Draft — every figure below reflects the current, editable Payroll Entry state and can change until this cycle is released.'
      : status === 'RELEASED'
        ? 'This cycle has been released. Figures reflect the payroll as released, including any post-release corrections already applied to it.'
        : 'This cycle is Archived — figures reflect the permanently locked, historical payroll for this period.';
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-accent-light bg-accent-light px-4 py-3 text-xs text-text">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p>{text}</p>
    </div>
  );
}

const EXPORT_BUTTON_LABEL: Record<PayrollSummaryExportFormat, string> = { csv: 'Export CSV', xlsx: 'Export Excel' };

/** The one place a summary card's own displayed value is derived — `advancesIncludingEid` is the
 * only card whose value isn't a direct `PayrollSummaryFigures` field (it combines
 * `advanceDeductions` + `eidAdvanceDeductions`, mirroring the on-screen "Advances (incl. Eid)" card
 * already above this print refinement). No figure is recomputed — both inputs come from the same
 * already-loaded `totals`/`row` the on-screen report already renders. */
function summaryCardValue(id: (typeof SUMMARY_CARD_FIELDS)[number]['id'], figures: PayrollSummaryFigures): string {
  if (id === 'employeeCount') return String(figures.employeeCount);
  if (id === 'advancesIncludingEid') {
    return formatMoney((Number(figures.advanceDeductions) + Number(figures.eidAdvanceDeductions)).toFixed(2));
  }
  return formatMoney(figures[id]);
}

/** The one place a table column's own displayed value is derived for the print-only table — reused
 * for both a site row and the `cycleTotals` row, since both share the `PayrollSummaryFigures` shape.
 * `siteName` is handled by the caller directly (a string, not part of `PayrollSummaryFigures`). */
function tableColumnValue(id: Exclude<TableColumnFieldId, 'siteName'>, figures: PayrollSummaryFigures): string {
  return isCountField(id) ? String(figures[id]) : formatMoney(figures[id] as string);
}

/**
 * Phase 8B Checkpoint 1 — Payroll Summary Report, the first production report of the Reports module.
 * Grouped Payroll Cycle → Project Site → totals (Phase 8A investigation report §4A), always scoped to
 * exactly one `PayrollCycle` at a time via the shared Historical Payroll Cycle Selector
 * (`useSelectedPayrollCycle`), mirroring Bank Sheet's/Cash Receiving's own page structure.
 *
 * This page performs no financial calculation of its own — every figure is rendered exactly as the
 * backend's `GET /api/v1/reports/payroll-summary` returns it (`getPayrollSummaryReport`, the single
 * canonical `calcNet`-based aggregation). `cycleTotals` always reflects the complete filtered site
 * scope, never just the current pagination page — see `use-reports.ts`'s own doc comment.
 */
export function ReportsPayrollSummaryPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.REPORTS_VIEW);

  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('reports/payroll-summary');
  const hasAnyCycle = cycles.length > 0;

  const sites = useAccessibleProjectSites(user);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [activeExport, setActiveExport] = useState<PayrollSummaryExportFormat | null>(null);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  // The last-confirmed field selection — drives the print-only cards/table below. Starts at the
  // same Full Report default the dialog itself opens with (Final Print UX Refinement — the
  // application must never silently hide report data); only ever changes when the user actually
  // confirms the dialog, never mid-editing.
  const [printSelection, setPrintSelection] = useState<PayrollSummaryPrintSelection>(DEFAULT_PRINT_SELECTION);
  const triggerPrint = useTriggerPrint('landscape');

  function handlePrintConfirm(selection: PayrollSummaryPrintSelection) {
    // Production Print Defect fix, same sequencing `PrintButton` already established: `window.print()`
    // (inside `triggerPrint`) captures the DOM at the exact synchronous instant it's called, so both
    // the dialog's own removal *and* the print-only table below picking up the new `printSelection`
    // must already be committed — not just scheduled — before that call. A plain pair of `setState`
    // calls here would only queue React 18's batched update; `flushSync` forces both to actually apply
    // first. Fixed landscape/fit-to-page (Checkpoint brief: "use landscape orientation") — deliberately
    // never `.print-fit`'s shared `table-layout: fixed`/8.5px shrink, see the print-only table below's
    // own comment for why natural column widths are what this refinement actually needed.
    flushSync(() => {
      setPrintSelection(selection);
      setPrintOptionsOpen(false);
    });
    triggerPrint({ orientation: 'landscape', fit: 'normal' });
  }

  // A filter change invalidates whichever page was previously being viewed — never silently keep
  // showing "page 3" of a now-different filtered result.
  useEffect(() => {
    setPage(1);
  }, [cycleId, selectedSiteIds]);

  const report = usePayrollSummaryReport(cycleId, { siteIds: selectedSiteIds, page, pageSize: REPORT_PAGE_SIZE });

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  async function handleExport(format: PayrollSummaryExportFormat) {
    if (!cycle || activeExport) return;
    setActiveExport(format);
    try {
      await downloadPayrollSummaryExport(cycle, selectedSiteIds.length ? selectedSiteIds : undefined, format);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `Payroll Summary ${format.toUpperCase()} export failed`);
    } finally {
      setActiveExport(null);
    }
  }

  if (!canView) {
    return (
      <AppShell user={user} title="Payroll Summary" subtitle="Reports">
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
  const totals: PayrollSummaryFigures | undefined = report.data?.cycleTotals;

  return (
    <AppShell user={user} title="Payroll Summary" subtitle="Reports — payroll totals by Project Site">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <PayrollPageToolbar
              title="Payroll Summary"
              badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
              filters={
                <>
                  {hasAnyCycle && (
                    <PayrollCycleSelectField
                      id="reports-payroll-summary-cycle"
                      cycles={cycles}
                      selectedCycleId={cycleId}
                      onSelect={selectCycle}
                    />
                  )}
                  <MultiSelectFilter
                    id="reports-payroll-summary-site-filter"
                    label="Site"
                    options={siteOptions}
                    selectedIds={selectedSiteIds}
                    onChange={setSelectedSiteIds}
                  />
                </>
              }
              actions={
                <>
                  {/* Post-deployment Print Usability Refinement — 19 columns of mostly-financial
                      figures is too wide to print legibly at once (production UAT finding); Print
                      now opens a field-selection dialog first instead of going straight to the
                      shared orientation/fit dialog (still reused once the user confirms, via
                      `handlePrintConfirm` → `useTriggerPrint`, fixed to landscape). The on-screen
                      table below is completely unaffected — it always shows every column. */}
                  <Button variant="secondary" onClick={() => setPrintOptionsOpen(true)} disabled={activeExport !== null}>
                    <Printer className="h-3.5 w-3.5" aria-hidden />
                    Print
                  </Button>
                  {(['csv', 'xlsx'] as const).map((format) => (
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
                <PrintContextHeader title="Payroll Summary" context={formatCycleLabel(cycle)} showLogo />
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
                <p className="text-xs text-text-muted">A Payroll Summary can only be generated once a cycle exists.</p>
              </div>
            )}

            {!isLoading && !cycleError && hasAnyCycle && report.error && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-danger">Could not load the Payroll Summary</p>
                <p className="text-xs text-text-muted">
                  {report.error instanceof ApiError ? report.error.message : 'Something went wrong'}
                </p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => report.refetch()}>
                  Try Again
                </Button>
              </div>
            )}

            {!isLoading && !report.error && report.isLoading && (
              <div className="flex flex-col gap-2 p-[18px]">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}

            {!isLoading && !report.error && !report.isLoading && report.data && cycle && (
              <div className="flex flex-col gap-4 p-[18px] print:p-0">
                <CycleStateNotice status={cycle.status} />

                {report.data.total === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-14 text-center">
                    <p className="text-xs font-medium text-text">No payroll entries for this selection</p>
                    <p className="max-w-sm text-xs text-text-muted">
                      This cycle has no Payroll Entries yet for the selected Site(s) — try a different Site filter,
                      or add entries under Payroll Entry first.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Post-deployment Print Usability Refinement — this on-screen card grid never
                        prints (`print:hidden`); a separate, field-selectable card block below it
                        (`hidden print:block`) is what actually prints, mirroring Payroll Entry's own
                        established "dedicated print-only markup, on-screen version print:hidden"
                        pattern rather than reusing one element for both. Every value below is
                        unchanged and unaffected by print field selection. */}
                    {totals && (
                      <div data-testid="on-screen-cards" className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
                        <StatFigure label="Employees" value={String(totals.employeeCount)} />
                        <StatFigure label="Gross Pay" value={formatMoney(totals.grossPay)} />
                        <StatFigure label="Net Salary" value={formatMoney(totals.netSalary)} />
                        <StatFigure label="Released Amount" value={formatMoney(totals.releasedAmount)} />
                        <StatFigure label="Pending Release Amount" value={formatMoney(totals.pendingReleaseAmount)} />
                        <StatFigure label="EOBI" value={formatMoney(totals.eobi)} />
                        <StatFigure
                          label="Advances (incl. Eid)"
                          value={formatMoney(
                            (Number(totals.advanceDeductions) + Number(totals.eidAdvanceDeductions)).toFixed(2),
                          )}
                        />
                        <StatFigure label="Fines" value={formatMoney(totals.fines)} />
                      </div>
                    )}

                    {/* On-screen only (`print:hidden`) — always every column, unaffected by print
                        field selection. The print-only table below reuses these exact same
                        `report.data.siteRows`/`totals`, just drawing a subset of their columns. */}
                    <div
                      data-testid="on-screen-table"
                      className="print-flow overflow-x-auto rounded border border-border print:hidden"
                    >
                      <Table density="compact" className="min-w-full">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Project Site</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Employees</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Held</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Released</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Pending</TableHead>
                            <TableHead className="whitespace-nowrap text-right">No Pay Due</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Recovery Due</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Gross Pay</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Overtime</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Allowances</TableHead>
                            <TableHead className="whitespace-nowrap text-right">EOBI</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Advances</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Eid Advances</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Fines</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Bal. Payable</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Recovery Ded.</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Net Salary</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Released Amt</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Pending Amt</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.siteRows.map((row) => (
                            <TableRow key={row.siteId}>
                              <TableCell className="whitespace-nowrap font-medium">{row.siteName}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{row.employeeCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {row.heldCount > 0 ? <Badge tone="hold">{row.heldCount}</Badge> : 0}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{row.releasedCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{row.pendingReleaseCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{row.noPayDueCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{row.recoveryDueCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.grossPay)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.overtimeAmount)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.allowances)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.eobi)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.advanceDeductions)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.eidAdvanceDeductions)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.fines)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.balancePayableIncluded)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.recoveryDeducted)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(row.netSalary)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.releasedAmount)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.pendingReleaseAmount)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        {totals && (
                          <tfoot className="border-t-2 border-border bg-surface-2">
                            <TableRow>
                              <TableCell className="whitespace-nowrap text-right font-semibold">Total (this selection)</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{totals.employeeCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{totals.heldCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{totals.releasedCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{totals.pendingReleaseCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{totals.noPayDueCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{totals.recoveryDueCount}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.grossPay)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.overtimeAmount)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.allowances)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.eobi)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.advanceDeductions)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.eidAdvanceDeductions)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.fines)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.balancePayableIncluded)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.recoveryDeducted)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.netSalary)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.releasedAmount)}</TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(totals.pendingReleaseAmount)}</TableCell>
                            </TableRow>
                          </tfoot>
                        )}
                      </Table>
                    </div>

                    {/* Post-deployment Print Usability Refinement — print-only (`hidden print:block`,
                        same pattern Payroll Entry's own dedicated print table already established).
                        Renders only the user's selected cards/columns from the exact same `totals`/
                        `report.data.siteRows` the on-screen version above already loaded — no new
                        fetch, no recalculated figure. Deliberately outside `.print-fit` (this page
                        never applies that class — see `handlePrintConfirm`): a fixed `table-layout`
                        and 8.5px font is what made the *full* 19-column table illegible in the first
                        place; a user-narrowed column set is meant to size naturally instead. */}
                    {totals && (
                      <div
                        data-testid="print-only-cards"
                        className="hidden print:mb-3 print:grid print:grid-cols-4 print:gap-3"
                      >
                        {SUMMARY_CARD_FIELDS.filter((field) => printSelection.cards.includes(field.id)).map((field) => (
                          <StatFigure key={field.id} label={field.label} value={summaryCardValue(field.id, totals)} />
                        ))}
                      </div>
                    )}

                    <div data-testid="print-only-table" className="hidden print:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {TABLE_COLUMN_FIELDS.filter((field) => printSelection.columns.includes(field.id)).map(
                              (field) => (
                                <TableHead key={field.id} className={field.id === 'siteName' ? undefined : 'text-right'}>
                                  {field.label}
                                </TableHead>
                              ),
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.data.siteRows.map((row) => (
                            <TableRow key={row.siteId}>
                              {TABLE_COLUMN_FIELDS.filter((field) => printSelection.columns.includes(field.id)).map(
                                (field) =>
                                  field.id === 'siteName' ? (
                                    <TableCell key={field.id} className="font-medium">
                                      {row.siteName}
                                    </TableCell>
                                  ) : (
                                    <TableCell key={field.id} className="text-right tabular-nums">
                                      {tableColumnValue(field.id, row)}
                                    </TableCell>
                                  ),
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                        {totals && (
                          <tfoot>
                            <TableRow className="border-t-2 border-border-strong font-semibold">
                              {TABLE_COLUMN_FIELDS.filter((field) => printSelection.columns.includes(field.id)).map(
                                (field, index) =>
                                  field.id === 'siteName' ? (
                                    <TableCell key={field.id}>{index === 0 ? 'Total (this selection)' : null}</TableCell>
                                  ) : (
                                    <TableCell key={field.id} className="text-right tabular-nums">
                                      {tableColumnValue(field.id, totals)}
                                    </TableCell>
                                  ),
                              )}
                            </TableRow>
                          </tfoot>
                        )}
                      </Table>
                    </div>

                    <p className="text-[11px] text-text-muted">
                      &ldquo;Pending Amt&rdquo; is this cycle&apos;s computed net salary not yet released (Draft-editable
                      or awaiting release action) — it is not the same as a cross-cycle outstanding Balance Adjustment.
                      &ldquo;Bal. Payable&rdquo;/&ldquo;Recovery Ded.&rdquo; are the amounts this cycle already includes from a
                      prior correction settlement.
                    </p>

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
      <PayrollSummaryPrintOptionsDialog
        open={printOptionsOpen}
        onOpenChange={setPrintOptionsOpen}
        onConfirm={handlePrintConfirm}
      />
    </AppShell>
  );
}
