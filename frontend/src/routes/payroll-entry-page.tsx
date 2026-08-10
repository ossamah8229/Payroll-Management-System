import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker } from 'react-router-dom';
import { Download, FileEdit, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { calcNet, formatMoney, PERMISSIONS } from '@payroll/shared';
import { buildCalcInput } from '@/components/payroll-entry/calc-input';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { canRequestCorrection, hasPermission } from '@/lib/permissions';
import { EmployeeFormModal } from '@/components/employees/employee-form-modal';
import { payrollEntrySaveStatusStore } from '@/lib/payroll-entry-save-status-store';
import { useBanks } from '@/hooks/use-banks';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { formatCycleLabel, useReconcileDraftCycleRoster } from '@/hooks/use-payroll-cycles';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import {
  downloadPayrollEntryExport,
  payrollEntriesQueryKey,
  usePayrollEntries,
  type PayrollEntry,
} from '@/hooks/use-payroll-entries';
import { PayrollEntryGrid } from '@/components/payroll-entry/payroll-entry-grid';
import { PayrollEntrySaveStatusBanner } from '@/components/payroll-entry/save-status-banner';
import { NewCycleModal } from '@/components/payroll-entry/new-cycle-modal';
import { CopyToAllToolbar } from '@/components/payroll-entry/copy-to-all-toolbar';
import { RequestCorrectionModal } from '@/components/corrections/request-correction-modal';

function GridLoadingState() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function GridErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-14 text-center">
      <p className="text-xs font-medium text-danger">Could not load Payroll Entry</p>
      <p className="text-xs text-text-muted">{message}</p>
    </div>
  );
}

/** No `PayrollCycle` row exists yet, anywhere — the true first-run/cold-start case. This is the
 * one scenario `POST /api/v1/payroll-cycles` (restricted, Phase 5 Checkpoint 3) still handles, so
 * this is the only empty state on this page that still offers a create action. Every other case
 * (a cycle exists but none is Draft) no longer has a distinct empty state as of Phase 5 Checkpoint
 * 4 — the Historical Payroll Cycle Selector's own default-selection rule always resolves to *some*
 * cycle (Draft, else newest Released, else newest Archived) once at least one exists. */
function NoCycleEmptyState({ canManageCycles, onCreate }: { canManageCycles: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <p className="text-xs font-medium text-text">No payroll cycle exists yet</p>
      <p className="max-w-sm text-xs text-text-muted">
        {canManageCycles
          ? 'Start the very first payroll cycle to begin entering this month’s figures.'
          : 'Ask a Master User to start the first payroll cycle before Payroll Entry can be used.'}
      </p>
      {canManageCycles && (
        <Button size="sm" className="mt-2" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Start First Payroll Cycle
        </Button>
      )}
    </div>
  );
}

/** The clear read-only indicator an Archived cycle's grid must show (Phase 5 Checkpoint 4
 * architecture review — "Archive locks all ordinary editing" is the approved decision). */
function ArchivedReadOnlyBanner() {
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      This cycle is Archived and permanently read-only — editing, holds, work-line changes, and bulk
      apply are all disabled. Filtering and export remain available.
    </div>
  );
}

/** Pure in-memory filter over the already-fully-fetched `entries` array — no new backend request,
 * since `usePayrollEntries` already loads every entry the current user can see for the cycle
 * (Phase 3 Checkpoint 4 design decision). An empty `siteIds` means "no filter" — matches the
 * backend's own existing convention for an omitted site filter. */
function filterEntriesBySite(entries: PayrollEntry[], siteIds: string[]): PayrollEntry[] {
  if (siteIds.length === 0) return entries;
  const siteIdSet = new Set(siteIds);
  return entries.filter((entry) => siteIdSet.has(entry.siteId));
}

export function PayrollEntryPage({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  // Phase 5 Checkpoint 4 — the shared Historical Payroll Cycle Selector. `cycleId` is the raw,
  // URL-sourced identifier (used for every data fetch below, so an invalid/nonexistent explicit
  // id still reaches the backend and surfaces its own error, per the approved architecture — never
  // silently redirected away from); `cycle` is the resolved row from the list, used for display
  // and status-gated UI only.
  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('payroll-entry');
  const hasAnyCycle = cycles.length > 0;
  const isArchived = cycle?.status === 'ARCHIVED';
  const [requestCorrectionOpen, setRequestCorrectionOpen] = useState(false);

  // Phase 7E durability checkpoint (A3) — the in-app navigation counterpart to the global
  // `beforeunload` guard (A2): blocks a `Link`/`navigate()`/back-forward transition to a
  // *different route* while this cycle still has anything not yet server-confirmed saved,
  // re-using `payrollEntrySaveStatusStore` exactly like the banner above it (never a second,
  // independent "is this dirty" check). Deliberately keyed on the path changing, not the search
  // string/hash, so switching the on-page site filter or cycle selector (same route, same
  // component instance) is never blocked — only actually *leaving* Payroll Entry is. Requires the
  // data router (`createBrowserRouter`/`RouterProvider`, `App.tsx`) — `useBlocker` throws under the
  // declarative `<Routes>` mode this app used before this checkpoint.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && payrollEntrySaveStatusStore.hasPendingForCycle(cycleId),
  );
  const {
    data: entries,
    isLoading: entriesLoading,
    error: entriesError,
  } = usePayrollEntries(cycleId);
  const banks = useBanks();
  // Scoped to this user's own accessible sites (System-Wide RBAC Consistency remediation) — Payroll
  // Entry stays a strictly site-scoped operational domain; holding sites:manage does not widen it.
  const sites = useAccessibleProjectSites(user);
  const [newCycleOpen, setNewCycleOpen] = useState(false);
  const [createEmployeeOpen, setCreateEmployeeOpen] = useState(false);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);

  // UAT 2026-08-10 — the same "+ New Employee" action and create modal as Employee Registry
  // (EmployeeFormModal, extracted so both callers share one implementation), never a second
  // employee-create form or a permission bypass: gated by the exact same EMPLOYEES_CREATE
  // permission Employee Registry itself checks, independently re-enforced by the backend route.
  const canCreateEmployee = hasPermission(user, PERMISSIONS.EMPLOYEES_CREATE);
  const canManageCycles = user.permissions.includes(PERMISSIONS.PAYROLL_CYCLE_MANAGE);
  const isLoading = cycleLoading || (Boolean(cycleId) && (entriesLoading || banks.isLoading));

  // Draft Payroll Roster Reconciliation (2026-07-24) — fires once per Draft cycle actually opened
  // by a session that already holds payroll-cycle:manage (the same permission this action's own
  // backend route requires), so opening the current Draft is self-healing for the sessions that can
  // act on it, without the entries GET above ever performing a write itself: this is its own
  // explicit, separately-audited mutation the page happens to trigger automatically, not a side
  // effect of the read. Silent when there was nothing to reconcile; a brief toast only when it
  // actually added someone, since that's a real, useful fact for whoever's looking at this page.
  const reconcileRoster = useReconcileDraftCycleRoster();
  const reconciledCycleIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!cycleId || !canManageCycles || cycle?.status !== 'DRAFT') return;
    if (reconciledCycleIdRef.current === cycleId) return;
    reconciledCycleIdRef.current = cycleId;
    reconcileRoster.mutate(cycleId, {
      onSuccess: (result) => {
        if (result.reconciledCount > 0) {
          toast.success(
            `${result.reconciledCount} ${result.reconciledCount === 1 ? 'employee' : 'employees'} added to this Draft cycle`,
          );
        }
      },
      // Best-effort only — a failure here (e.g. a permission edge case, or the cycle having moved
      // on between page load and this call) must never block or error the page itself.
      onError: () => {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId, canManageCycles, cycle?.status]);

  // `employees.service.ts` already calls `syncEmployeeIntoCurrentDraftCycle` synchronously inside
  // employee creation itself (not just this page's own roster-reconciliation effect above) — a new
  // employee is already a PayrollEntry row in whichever cycle is currently DRAFT, server-side, by
  // the time this fires. That is *not necessarily the cycle this page is currently viewing* — the
  // Historical Payroll Cycle Selector lets this same page show a read-only Released/Archived
  // cycle, and `usePayrollEntries`'s own `staleTime: Infinity` (this file's own comment above: data
  // is refetched only explicitly, "cycle switch" included) means a cycle whose query was never
  // invalidated stays showing pre-creation data indefinitely within one session, even after
  // switching to it. Invalidating the *Draft* cycle's own key specifically — never just whatever
  // `cycleId` happens to be in the URL right now — is what actually guarantees the new employee
  // shows up once the user is looking at the cycle it was synced into, without a full browser
  // refresh, regardless of which cycle they were viewing when they created it. No new linkage
  // invented here: only invalidating an already-existing query key for the cycle the backend
  // itself already wrote to.
  function handleEmployeeCreated() {
    const draftCycleId = cycles.find((c) => c.status === 'DRAFT')?.id;
    if (!draftCycleId) return;
    queryClient.invalidateQueries({ queryKey: payrollEntriesQueryKey(draftCycleId) });
  }

  const filteredEntries = useMemo(
    () => filterEntriesBySite(entries ?? [], selectedSiteIds),
    [entries, selectedSiteIds],
  );

  // Release status of the *individual* Payroll Entry determines correction eligibility — never the
  // cycle's own status alone (Corrections workflow completion). A cycle can still be nominally
  // DRAFT/RELEASED while some of its entries are already released (a per-Unit "Late Entry" release,
  // docs/architecture/database/release.md §12b) — those entries are just as correctable as any
  // entry in a fully RELEASED/ARCHIVED cycle, and the reverse also holds: an ARCHIVED cycle whose
  // entries somehow aren't released (shouldn't happen in practice, but the entry's own flag is the
  // only thing this page trusts) offers no correction action. Matches the backend's own
  // `assertEntryIsReleased`/`assertEntryEditable` model (`payroll-entry.service.ts`) exactly.
  const correctableEntries = useMemo(() => filteredEntries.filter((entry) => entry.released), [filteredEntries]);
  const hasReleasedEntries = correctableEntries.length > 0;

  // Communicates Option C's approved limitation (Phase 3 Checkpoint 5): the flat export format
  // represents only an entry's primary work line, so a currently-filtered split employee's
  // additional lines aren't in the file — surfaced as UI copy rather than a format change,
  // per the approved architecture.
  const splitEntryCount = useMemo(
    () => filteredEntries.filter((entry) => entry.workLines.length > 1).length,
    [filteredEntries],
  );

  // Print-only totals (Professional Printing checkpoint) — the printed table below is a separate,
  // fully non-virtualized rendering of `filteredEntries` (see its own comment), so its totals row
  // is computed independently here rather than reusing the on-screen grid's `LiveTotalsStore`
  // (which only tracks the interactive grid's own live-edited draft state).
  const printTotals = useMemo(() => {
    return filteredEntries.reduce(
      (acc, entry) => {
        // `calc.totalDeduction` (eobiDeduction + advanceDeduction + eidAdvanceDeduction + fine) is
        // the canonical figure — never a raw `entry.eobiAmount` sum, which would ignore
        // `eobiApplicable` and overstate a disabled row's deduction.
        const calc = calcNet(buildCalcInput(entry));
        acc.grossPay += Number(entry.grossPay);
        acc.allowance += Number(entry.allowance);
        acc.deductions += Number(calc.totalDeduction);
        acc.netSalary += Number(calc.netSalary);
        return acc;
      },
      { grossPay: 0, allowance: 0, deductions: 0, netSalary: 0 },
    );
  }, [filteredEntries]);

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  return (
    <AppShell user={user} title="Payroll Entry" subtitle="This cycle's editable payroll figures">
      <Card>
        <CardHeader>
          <PayrollPageToolbar
            title="Payroll Entry"
            badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
            filters={
              hasAnyCycle && (
                <PayrollCycleSelectField
                  id="payroll-entry-cycle"
                  cycles={cycles}
                  selectedCycleId={cycleId}
                  onSelect={selectCycle}
                />
              )
            }
            actions={
              hasAnyCycle &&
              cycleId && (
                <>
                  {canCreateEmployee && (
                    <Button size="sm" onClick={() => setCreateEmployeeOpen(true)}>
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      New Employee
                    </Button>
                  )}
                  <PrintButton recommendedOrientation="landscape" />
                  <Button variant="secondary" onClick={() => downloadPayrollEntryExport(cycleId, 'csv', selectedSiteIds)}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Export CSV
                  </Button>
                  <Button variant="secondary" onClick={() => downloadPayrollEntryExport(cycleId, 'xlsx', selectedSiteIds)}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Export Excel
                  </Button>
                  {hasReleasedEntries && canRequestCorrection(user) && (
                    <Button variant="secondary" onClick={() => setRequestCorrectionOpen(true)}>
                      <FileEdit className="h-3.5 w-3.5" aria-hidden />
                      Request Correction
                    </Button>
                  )}
                </>
              )
            }
          />
        </CardHeader>
        <CardContent>
          {cycle && (
            <PrintContextHeader title="Payroll Entry" context={`${formatCycleLabel(cycle)} · ${cycle.status}`} />
          )}
          {cycleError && <GridErrorState message={cycleError.message} />}
          {!cycleError && isLoading && <GridLoadingState />}
          {!cycleError && !isLoading && !cycleId && !hasAnyCycle && (
            <NoCycleEmptyState canManageCycles={canManageCycles} onCreate={() => setNewCycleOpen(true)} />
          )}
          {!cycleError && !isLoading && cycleId && entriesError && (
            <GridErrorState message={entriesError.message} />
          )}
          {!cycleError && !isLoading && cycleId && !entriesError && entries && entries.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No payroll entries in this cycle</p>
              <p className="text-xs text-text-muted">
                No active employees were found to seed this cycle with.
              </p>
            </div>
          )}
          {!cycleError && !isLoading && cycleId && !entriesError && entries && entries.length > 0 && (
            <div className="flex flex-col gap-3">
              {isArchived && <ArchivedReadOnlyBanner />}
              {!isArchived && <PayrollEntrySaveStatusBanner cycleId={cycleId} />}
              <div className="flex flex-wrap items-end gap-3 print:hidden">
                <MultiSelectFilter
                  id="payroll-entry-site-filter"
                  label="Site"
                  options={siteOptions}
                  selectedIds={selectedSiteIds}
                  onChange={setSelectedSiteIds}
                />
              </div>
              {splitEntryCount > 0 && (
                <p className="text-xs text-text-muted print:hidden">
                  {splitEntryCount} employee{splitEntryCount === 1 ? '' : 's'} {splitEntryCount === 1 ? 'has' : 'have'} attendance
                  split across more than one location this cycle — CSV/Excel export only covers each
                  employee's primary line. Review or edit the full split directly in the grid via each row's Split
                  action.
                </p>
              )}
              {!isArchived && cycle && (
                <div className="print:hidden">
                  <CopyToAllToolbar cycleId={cycle.id} siteIds={selectedSiteIds} />
                </div>
              )}
              {filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-text">No employees match the current site filter</p>
                  <p className="text-xs text-text-muted">Clear the filter to see every employee in this cycle.</p>
                </div>
              ) : cycle ? (
                <>
                  {/* The interactive grid is virtualized (@tanstack/react-virtual) — only the rows
                      currently scrolled into view exist in the DOM at any moment, so it can never
                      print correctly on its own (whatever happened to be on screen when Print was
                      clicked, silently missing the rest). Hidden from print entirely; the plain,
                      fully-rendered table below (every row, always) is what actually prints. */}
                  <div className="print:hidden">
                    <PayrollEntryGrid
                      cycle={cycle}
                      entries={filteredEntries}
                      banks={banks.data ?? []}
                    />
                  </div>
                  {/*
                   * The print column set is a deliberate subset of the on-screen grid's ~25
                   * columns (Professional Printing checkpoint), not every `PAYROLL_COLUMNS`
                   * entry shrunk to illegibility: identity (Code/Employee/Site/Deputed Branch),
                   * pay components, and Net Salary are what a printed distribution/payout sheet
                   * is actually used for. Omitted as not operationally useful on paper: Bank
                   * Details (Bank/Branch Code/Account/IBAN — already the Bank Sheet's own
                   * dedicated print), Designation/Units/OT Rate/Cycle Days/Leave Days/Leave
                   * Rate/EOBI Applicable/Remarks (reference detail, not payout figures), and
                   * Status/Hold (screen-only workflow state, meaningless on a static document).
                   */}
                  <div className="hidden print:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Employee</TableHead>
                          <TableHead>Site</TableHead>
                          <TableHead>Deputed Branch</TableHead>
                          <TableHead className="text-right">Gross Pay</TableHead>
                          <TableHead className="text-right">Days</TableHead>
                          <TableHead className="text-right">OT Hours</TableHead>
                          <TableHead className="text-right">Allowance</TableHead>
                          <TableHead className="text-right">Deductions</TableHead>
                          <TableHead className="text-right">Net Salary</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredEntries.map((entry) => {
                          // Canonical `calcNet` deduction total — never a raw `entry.eobiAmount`
                          // sum, which would ignore `eobiApplicable`.
                          const calc = calcNet(buildCalcInput(entry));
                          const deductions = Number(calc.totalDeduction);
                          const netSalary = calc.netSalary;
                          return (
                            <TableRow key={entry.id}>
                              <TableCell>{entry.employee.employeeCode ?? '—'}</TableCell>
                              <TableCell>{entry.employee.name}</TableCell>
                              <TableCell>{entry.site.name}</TableCell>
                              <TableCell>{entry.workLines[0]?.unit.code ?? '—'}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatMoney(entry.grossPay)}</TableCell>
                              <TableCell className="text-right tabular-nums">{entry.workLines[0]?.days ?? '—'}</TableCell>
                              <TableCell className="text-right tabular-nums">{entry.workLines[0]?.otHours ?? '—'}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatMoney(entry.allowance)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(deductions.toFixed(2))}
                                {/* Compact, single-line balance note (never a second row/wrap,
                                    which is what previously risked overflow) — same source
                                    (`entry.advance`/`entry.eidAdvance`) as the on-screen grid's
                                    `BalanceLabel`, just print-typography-scaled here. */}
                                {(entry.advance || entry.eidAdvance) && (
                                  <div className="whitespace-nowrap text-[7.5px] font-normal text-text-faint">
                                    {entry.advance && `Adv Bal: ${formatMoney(entry.advance.outstandingBalance)}`}
                                    {entry.advance && entry.eidAdvance && ' · '}
                                    {entry.eidAdvance && `Eid Bal: ${formatMoney(entry.eidAdvance.outstandingBalance)}`}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">
                                {formatMoney(netSalary)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                      <tfoot>
                        {/* One cell per header column, in the same order — the employee count sits
                            under "Employee" specifically (not merged with "Code"), matching the
                            on-screen grid's own totals row convention (`PayrollEntryTotalsRow`)
                            after its 2026-07-25 "count detached from its own column" fix. */}
                        <TableRow className="border-t-2 border-border-strong font-semibold">
                          <TableCell />
                          <TableCell>
                            {filteredEntries.length} {filteredEntries.length === 1 ? 'employee' : 'employees'}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right tabular-nums">{formatMoney(printTotals.grossPay.toFixed(2))}</TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell className="text-right tabular-nums">{formatMoney(printTotals.allowance.toFixed(2))}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(printTotals.deductions.toFixed(2))}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(printTotals.netSalary.toFixed(2))}</TableCell>
                        </TableRow>
                      </tfoot>
                    </Table>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <NewCycleModal open={newCycleOpen} onOpenChange={setNewCycleOpen} />
      {canCreateEmployee && (
        <EmployeeFormModal
          open={createEmployeeOpen}
          onOpenChange={setCreateEmployeeOpen}
          onCreated={handleEmployeeCreated}
          user={user}
        />
      )}
      {hasReleasedEntries && (
        <RequestCorrectionModal
          open={requestCorrectionOpen}
          onOpenChange={setRequestCorrectionOpen}
          entries={correctableEntries}
        />
      )}

      {blocker.state === 'blocked' && (
        <Modal open onOpenChange={(open) => !open && blocker.reset()}>
          <ModalContent title="Unsaved changes">
            <p className="text-xs text-text-muted">
              This cycle still has rows that are unsaved, saving, retrying, or in conflict. Leaving
              now risks losing whatever hasn't reached the server yet — you can stay and wait for
              them to finish (or resolve the conflict/failure shown in the grid), or leave anyway.
            </p>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => blocker.reset()}>
                Stay on this page
              </Button>
              <Button type="button" variant="amber" onClick={() => blocker.proceed()}>
                Leave anyway
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </AppShell>
  );
}
