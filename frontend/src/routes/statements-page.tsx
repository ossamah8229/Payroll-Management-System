import { useEffect, useMemo, useState } from 'react';
import { Download, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney, PERMISSIONS, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterField } from '@/components/ui/filter-field';
import { StatementEmployeeLookup } from '@/components/statements/statement-employee-lookup';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useProjectUnits } from '@/hooks/use-project-units';
import type { StatementEmployeeCandidate } from '@/hooks/use-statement-employees';
import { usePayrollCycles, formatCycleOptionLabel } from '@/hooks/use-payroll-cycles';
import {
  downloadEmployeeStatementExport,
  useEmployeeStatement,
  type EmployeeStatementRangeParams,
  type StatementBalances,
  type StatementExportFormat,
  type StatementLedgerEntry,
} from '@/hooks/use-employee-statement';
import {
  classifyStatementError,
  statementBalanceShortLabel,
  statementCategoryLabel,
  statementEntryDateLabel,
  statementPeriodLabel,
} from '@/components/statements/statement-labels';

const EXPORT_BUTTON_LABEL: Record<StatementExportFormat, string> = {
  pdf: 'Export PDF',
  xlsx: 'Export Excel',
  csv: 'Export CSV',
};

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-50';

function rangeToggleClassName(active: boolean): string {
  return `h-9 rounded border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    active ? 'border-accent-mid bg-accent-light text-accent' : 'border-border bg-surface text-text-muted hover:text-text'
  }`;
}

/** `year * 12 + month` — plain chronological comparison of two cycles for selector sanity-
 * checking only (never a financial calculation, never sent to the backend — the backend
 * independently re-validates `fromCycleId`/`toCycleId` ordering itself,
 * `statements.service.ts`'s `resolveStatementRange`). */
function cyclePeriodKey(cycle: { year: number; month: number }): number {
  return cycle.year * 12 + cycle.month;
}

function IdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="break-words text-xs font-medium text-text">{value}</span>
    </div>
  );
}

function BalanceFigure({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-surface px-3.5 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-text">{formatMoney(amount)}</span>
    </div>
  );
}

function BalancesSummaryCard({
  title,
  description,
  balances,
}: {
  title: string;
  description: string;
  balances: StatementBalances;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BalanceFigure label="Payable Outstanding" amount={balances.payableOutstanding} />
        <BalanceFigure label="Recovery Outstanding" amount={balances.recoveryOutstanding} />
        <BalanceFigure label="Advance Outstanding" amount={balances.advanceOutstanding} />
      </CardContent>
      <p className="border-t border-border px-[18px] py-2.5 text-[11px] text-text-muted">{description}</p>
    </Card>
  );
}

/**
 * Advance-history restriction notice (Phase 7A Checkpoint 1's `scope.advanceHistoryIncluded`/
 * `.advanceHistoryRestriction`) — communicates *restricted visibility*, never "no advances": it
 * must not imply the employee has no Advance history, and it must never disclose a hidden count
 * or amount (the backend itself withholds that detail, `StatementScope`'s own doc comment) — this
 * component only ever has the boolean flag to work with, so it cannot leak more than that even by
 * accident.
 */
function AdvanceRestrictionNotice({ employeeName }: { employeeName: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-accent-light bg-accent-light px-4 py-3 text-xs text-text">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p>
        <span className="font-semibold">Advance history restricted.</span> {employeeName}&apos;s current Site is
        outside your assigned Site access, so their Advance history is not included in this Statement. Salary and
        Correction entries you have access to are shown in full below.
      </p>
    </div>
  );
}

function LedgerRowMovement({ entry }: { entry: StatementLedgerEntry }) {
  if (!entry.movement) {
    return <span className="text-[11px] italic text-text-faint">Informational</span>;
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-medium tabular-nums text-text">
        {entry.movement.direction === 'INCREASE' ? '+ ' : '− '}
        {formatMoney(entry.movement.amount)}
      </span>
      <span className="text-[10px] text-text-muted">{statementBalanceShortLabel(entry.movement.balance)}</span>
    </div>
  );
}

function LedgerTable({ entries }: { entries: StatementLedgerEntry[] }) {
  return (
    // print-flow (Phase 7B Checkpoint 3, Print Readiness) — the same Fit-to-page unclamping
    // utility every other print-enabled data table already carries (Bank Sheet, Payslips); without
    // it, `PrintButton`'s "Fit to page" option has no `table-layout: fixed` container to apply to
    // here, and Landscape alone would not guarantee this 7-column table stays within page width.
    <div className="print-flow overflow-x-auto">
      <Table density="compact" className="min-w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Date / Period</TableHead>
            <TableHead className="whitespace-nowrap">Category</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="whitespace-nowrap text-right">Movement</TableHead>
            <TableHead className="whitespace-nowrap text-right">Running Payable</TableHead>
            <TableHead className="whitespace-nowrap text-right">Running Recovery</TableHead>
            <TableHead className="whitespace-nowrap text-right">Running Advance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="whitespace-nowrap">{statementEntryDateLabel(entry)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge tone="gray">{statementCategoryLabel(entry.category)}</Badge>
              </TableCell>
              <TableCell className="max-w-[360px] whitespace-normal break-words">{entry.description}</TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <LedgerRowMovement entry={entry} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {formatMoney(entry.runningBalances.payableOutstanding)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {formatMoney(entry.runningBalances.recoveryOutstanding)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {formatMoney(entry.runningBalances.advanceOutstanding)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type RangeMode = 'DEFAULT' | 'CUSTOM';

/**
 * Statements (Phase 7A Checkpoint 2, corrected) — the dedicated Employee Statement of Account page
 * over the canonical, read-only ledger `GET /api/v1/employees/:employeeId/statement` already
 * builds (Checkpoint 1, `docs/architecture/workflows/statements-ledger.md`). This page performs no
 * financial calculation of its own: opening/closing/running balances are rendered exactly as the
 * backend returns them, never recomputed or re-derived from the visible rows.
 *
 * **Employee-first selection, corrected from this checkpoint's own original Site → Unit → Employee
 * design** (an architectural review found that hierarchy made a transferred employee permanently
 * undiscoverable to the very user who administered their history — see
 * `docs/architecture/workflows/statements-ledger.md §15` for the full finding). The Employee field
 * (`StatementEmployeeLookup`, backed by `GET /api/v1/statements/employees`) is always enabled and
 * discovers candidates by *historical* `PayrollEntry.siteId`/`PayrollEntryWorkLine.unitId`
 * attribution, never by an employee's *current* site — the same historical-scoping principle
 * `getEmployeeStatement` itself already enforces at the row level. Site/Unit are **optional
 * narrowing filters only**: they narrow the search candidates, and changing either after an
 * employee is already selected clears that selection outright (never silently re-validates it
 * against a filter it may no longer match) — they never gate whether the Employee field itself can
 * be used, and selecting an employee here is never a claim that every one of their records is
 * visible: the Statement endpoint's own row-level filtering remains the sole authority for that
 * (the Advance-history restriction notice below is the one case this page surfaces explicitly).
 * This is a deliberately separate picker from `EmployeeLookup` (Advances/Corrections' own,
 * current-site-scoped component) — see `statement-employee-lookup.tsx`'s own doc comment for why.
 *
 * **Statement Period** is always a `PayrollCycle` range, never an arbitrary date range (the
 * backend's own `fromCycleId`/`toCycleId` contract) — "Latest 12 Cycles" (the same default the
 * backend itself falls back to when neither is supplied) or an explicit From/To Cycle pair, with
 * inline validation mirroring the backend's own "From must not be later than To" rule so a
 * doomed request is never sent in the first place. Employee discovery is deliberately
 * range-independent (an employee never disappears from the picker merely because the *currently
 * selected* Statement Period has no rows for them) — see the architecture doc's own §15 for why.
 *
 * The Statement query only fires once a complete, valid selection exists (`canLoad`), and its
 * query key is `[employeeId, fromCycleId, toCycleId]` only — changing Site/Unit selection without
 * changing the resolved employee or range can never trigger a refetch.
 */
export function StatementsPage({ user }: { user: SessionUser }) {
  const canView = user.permissions.includes(PERMISSIONS.STATEMENTS_VIEW);

  const sites = useAccessibleProjectSites(user);
  const cycles = usePayrollCycles();

  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<StatementEmployeeCandidate | undefined>(undefined);
  const [rangeMode, setRangeMode] = useState<RangeMode>('DEFAULT');
  const [fromCycleId, setFromCycleId] = useState('');
  const [toCycleId, setToCycleId] = useState('');

  const units = useProjectUnits(selectedSiteId || undefined);

  function handleEmployeeChange(id: string, candidate: StatementEmployeeCandidate | undefined) {
    setEmployeeId(id);
    setSelectedCandidate(candidate);
  }

  // A Unit only ever means something relative to a Site (`ProjectUnit` is itself site-scoped) —
  // changing Site clears whichever Unit was chosen for the *previous* Site.
  useEffect(() => {
    setSelectedUnitId('');
  }, [selectedSiteId]);

  // Site/Unit are optional *narrowing* filters on the Employee search, never a prerequisite for
  // it (module doc comment) — but once an employee is already selected, changing either filter
  // clears that selection outright rather than silently re-validating whether it still matches
  // (the same "any filter change clears selection" discipline Payslips already established), so a
  // stale selection can never quietly persist against a filter it may no longer satisfy.
  useEffect(() => {
    setEmployeeId('');
    setSelectedCandidate(undefined);
  }, [selectedSiteId, selectedUnitId]);

  const cyclesAscending = useMemo(() => [...(cycles.data ?? [])].reverse(), [cycles.data]);
  const hasAnyCycle = cyclesAscending.length > 0;
  const fromCycle = cyclesAscending.find((c) => c.id === fromCycleId);
  const toCycle = cyclesAscending.find((c) => c.id === toCycleId);
  const rangeSelectionInvalid = Boolean(fromCycle && toCycle && cyclePeriodKey(fromCycle) > cyclePeriodKey(toCycle));

  const rangeReady = rangeMode === 'DEFAULT' || (Boolean(fromCycleId) && Boolean(toCycleId) && !rangeSelectionInvalid);
  const canLoad = Boolean(employeeId) && rangeReady;

  // A partial/invalid Custom Range selection must never leak into the request, even though the
  // query itself is already independently disabled by `canLoad ? employeeId : undefined` below —
  // keeping both arguments consistent avoids a misleading intermediate call shape while the user
  // is still mid-selection. Shared verbatim with `handleExport` below (Phase 7B Checkpoint 3) so
  // an export can never silently request a different range than the Statement currently on screen.
  const statementRangeParams: EmployeeStatementRangeParams = {
    fromCycleId: canLoad && rangeMode === 'CUSTOM' ? fromCycleId : undefined,
    toCycleId: canLoad && rangeMode === 'CUSTOM' ? toCycleId : undefined,
  };
  const statement = useEmployeeStatement(canLoad ? employeeId : undefined, statementRangeParams);

  const selectedSite = sites.data?.find((site) => site.id === selectedSiteId);
  const unitLabel = selectedSite?.unitLabel ?? 'Unit';
  const controlsDisabled = statement.isFetching;

  // Phase 7B Checkpoint 3 — one page-level export state, never per-button: Print and all three
  // Export actions are mutually exclusive while any one of them is in flight (below, each button's
  // own `disabled={activeExport !== null}`), and only the button whose own format is active shows
  // a spinner in place of its icon.
  const [activeExport, setActiveExport] = useState<StatementExportFormat | null>(null);

  async function handleExport(format: StatementExportFormat) {
    if (!canLoad || activeExport) return;
    setActiveExport(format);
    try {
      await downloadEmployeeStatementExport(employeeId, statementRangeParams, format);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `Statement ${format.toUpperCase()} export failed`);
    } finally {
      setActiveExport(null);
    }
  }

  if (!canView) {
    return (
      <AppShell user={user} title="Statements" subtitle="Employee Statement of Account">
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
            <p className="text-xs font-medium text-text">You don&apos;t have access to Statements</p>
            <p className="text-xs text-text-muted">Contact a Master User if you believe this is a mistake.</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const errorPresentation = statement.error ? classifyStatementError(statement.error) : null;

  return (
    <AppShell user={user} title="Statements" subtitle="Salary, Correction, and Advance history for one employee">
      <div className="flex flex-col gap-4">
        {/* print:hidden (Phase 7B Checkpoint 3, Print Readiness) — selection/search controls
            describe how the on-screen view was found, not something a printed Statement needs to
            show alongside its data; matches `PayrollPageToolbar`'s own identical treatment of
            filters on every other print-enabled page. */}
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Select Statement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[260px] flex-col gap-1.5">
              <Label htmlFor="statement-employee">Employee</Label>
              <StatementEmployeeLookup
                id="statement-employee"
                value={employeeId}
                selectedCandidate={selectedCandidate}
                onChange={handleEmployeeChange}
                siteId={selectedSiteId || undefined}
                unitId={selectedUnitId || undefined}
                disabled={controlsDisabled}
                placeholder="Search by code, CNIC, or name…"
              />
            </div>

            <FilterField id="statement-site" label={`Site (optional — narrows search)`}>
              <select
                id="statement-site"
                className={selectClassName}
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
                disabled={controlsDisabled}
              >
                <option value="">Any Site</option>
                {(sites.data ?? []).map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField id="statement-unit" label={`${unitLabel} (optional)`}>
              <select
                id="statement-unit"
                className={selectClassName}
                value={selectedUnitId}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                disabled={controlsDisabled || !selectedSiteId}
              >
                <option value="">Any {unitLabel}</option>
                {(units.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <div className="flex flex-col gap-1.5">
              <Label>Statement Period</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={controlsDisabled || !hasAnyCycle}
                  onClick={() => setRangeMode('DEFAULT')}
                  className={rangeToggleClassName(rangeMode === 'DEFAULT')}
                >
                  Latest 12 Cycles
                </button>
                <button
                  type="button"
                  disabled={controlsDisabled || !hasAnyCycle}
                  onClick={() => setRangeMode('CUSTOM')}
                  className={rangeToggleClassName(rangeMode === 'CUSTOM')}
                >
                  Custom Range
                </button>
              </div>
            </div>

            {rangeMode === 'CUSTOM' && (
              <>
                <FilterField id="statement-from-cycle" label="From Cycle">
                  <select
                    id="statement-from-cycle"
                    className={selectClassName}
                    value={fromCycleId}
                    onChange={(e) => setFromCycleId(e.target.value)}
                    disabled={controlsDisabled}
                  >
                    <option value="">Select…</option>
                    {cyclesAscending.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {formatCycleOptionLabel(cycle)}
                      </option>
                    ))}
                  </select>
                </FilterField>
                <FilterField id="statement-to-cycle" label="To Cycle">
                  <select
                    id="statement-to-cycle"
                    className={selectClassName}
                    value={toCycleId}
                    onChange={(e) => setToCycleId(e.target.value)}
                    disabled={controlsDisabled}
                  >
                    <option value="">Select…</option>
                    {cyclesAscending.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {formatCycleOptionLabel(cycle)}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </>
            )}
          </CardContent>
          {rangeMode === 'CUSTOM' && rangeSelectionInvalid && (
            <p className="border-t border-border px-[18px] py-2.5 text-[11px] text-danger">
              From Cycle must not be later than To Cycle.
            </p>
          )}
          {!hasAnyCycle && !cycles.isLoading && (
            <p className="border-t border-border px-[18px] py-2.5 text-[11px] text-text-muted">
              No payroll cycles exist yet — a Statement Period can only be selected once at least one exists.
            </p>
          )}
          <p className="border-t border-border px-[18px] py-2.5 text-[11px] text-text-muted">
            Site and {unitLabel} only narrow the Employee search above — they are never required, and selecting an
            employee never grants visibility into their full history. What you can actually see is decided
            independently once the Statement loads.
          </p>
        </Card>

        {!canLoad && (
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">Search for an Employee to view a Statement</p>
              <p className="text-xs text-text-muted">
                {rangeMode === 'CUSTOM' && employeeId && !rangeReady
                  ? 'Choose both a From Cycle and a To Cycle, or switch back to Latest 12 Cycles.'
                  : 'A Statement Period defaults to the latest 12 payroll cycles unless you choose a custom range.'}
              </p>
            </CardContent>
          </Card>
        )}

        {canLoad && statement.isLoading && (
          <Card>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        )}

        {canLoad && !statement.isLoading && errorPresentation && (
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">{errorPresentation.headline}</p>
              <p className="max-w-md text-xs text-text-muted">{errorPresentation.detail}</p>
              {errorPresentation.retryable && (
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => statement.refetch()}>
                  Try Again
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {canLoad && !statement.isLoading && !errorPresentation && statement.data && (
          <>
            {/* Print-only heading (Phase 7B Checkpoint 3) — placed once, ahead of every card this
                Statement renders, so it appears first on the printed page; `hidden print:block`
                (`print-context-header.tsx`) keeps it invisible on screen. Context carries the
                employee identity *and* period, since — unlike every other `PrintContextHeader`
                caller, which is a filtered list — this page is already about one specific employee
                by the time anything is printable. */}
            <PrintContextHeader
              title="Statements"
              context={`${statement.data.employee.name} — ${statementPeriodLabel(statement.data.range)}`}
            />
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2.5">
                  <CardTitle>{statement.data.employee.name}</CardTitle>
                  <Badge tone="blue">Employee Statement of Account</Badge>
                </div>
                {/* Print/Export actions (Phase 7B Checkpoint 3) — rendered only once a Statement has
                    actually loaded, never as a disabled placeholder while the page is still on the
                    selection form (module doc comment). One page-level `activeExport` state governs
                    all four: mutually exclusive, and only the active button shows a spinner. Ledger
                    is 7 columns of mostly financial figures plus a description column — the same
                    "wide report" shape Advances/Bank Sheet/Corrections already recommend Landscape
                    for, so Statements follows that same precedent here rather than the narrower-
                    report Portrait default. */}
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <PrintButton recommendedOrientation="landscape" disabled={activeExport !== null} />
                  {(['pdf', 'xlsx', 'csv'] as const).map((format) => (
                    <Button
                      key={format}
                      variant="secondary"
                      onClick={() => handleExport(format)}
                      disabled={activeExport !== null}
                    >
                      {activeExport === format ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Download className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {EXPORT_BUTTON_LABEL[format]}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <IdentityField label="Employee Code" value={statement.data.employee.employeeCode ?? '—'} />
                <IdentityField label="CNIC" value={statement.data.employee.cnic ?? '—'} />
                <IdentityField label="Current Site" value={statement.data.employee.currentSiteName} />
                <IdentityField label="Statement Period" value={statementPeriodLabel(statement.data.range)} />
              </CardContent>
            </Card>

            {!statement.data.scope.advanceHistoryIncluded &&
              statement.data.scope.advanceHistoryRestriction === 'CURRENT_SITE_OUT_OF_SCOPE' && (
                <AdvanceRestrictionNotice employeeName={statement.data.employee.name} />
              )}

            <BalancesSummaryCard
              title="Opening Balances"
              description="Balances brought forward at the start of the selected Statement Period."
              balances={statement.data.openingBalances}
            />

            <Card>
              <CardHeader>
                <CardTitle>Ledger</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {statement.data.entries.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-14 text-center">
                    <p className="text-xs font-medium text-text">No ledger entries for this Statement Period</p>
                    <p className="max-w-sm text-xs text-text-muted">
                      The Opening and Closing Balances above still reflect this employee&apos;s full history up
                      to this point — try a wider Statement Period to see the entries that produced them.
                    </p>
                  </div>
                ) : (
                  <LedgerTable entries={statement.data.entries} />
                )}
              </CardContent>
            </Card>

            <BalancesSummaryCard
              title="Closing Balances"
              description="Balances at the end of the selected Statement Period, after every entry above."
              balances={statement.data.closingBalances}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
