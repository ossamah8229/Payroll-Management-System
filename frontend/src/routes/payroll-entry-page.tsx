import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileEdit, Lock, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { calcNet, formatMoney, PERMISSIONS } from '@payroll/shared';
import { buildCalcInput } from '@/components/payroll-entry/calc-input';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { canRequestCorrection } from '@/lib/permissions';
import { useBanks } from '@/hooks/use-banks';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { formatCycleLabel, useReconcileDraftCycleRoster } from '@/hooks/use-payroll-cycles';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import {
  downloadPayrollEntryExport,
  downloadPayrollEntryImportTemplate,
  usePayrollEntries,
  useImportPayrollEntries,
  type PayrollEntry,
  type PayrollEntryImportResult,
} from '@/hooks/use-payroll-entries';
import { PayrollEntryGrid } from '@/components/payroll-entry/payroll-entry-grid';
import { NewCycleModal } from '@/components/payroll-entry/new-cycle-modal';
import { CopyToAllToolbar } from '@/components/payroll-entry/copy-to-all-toolbar';
import { RequestCorrectionModal } from '@/components/corrections/request-correction-modal';
import { CorrectionHistoryModal } from '@/components/corrections/correction-history-modal';

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
      This cycle is Archived and permanently read-only — editing, holds, work-line changes, bulk
      apply, and import are all disabled. Filtering and export remain available.
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

/** Mirrors Employee Registry's own `ImportResultModal` (`employees-page.tsx`) — no "created" count
 * here, since Payroll Entry import is update-only by design (Phase 3 Checkpoint 5): every row
 * either matches an existing entry in this cycle and is updated, or is skipped and reported. */
function ImportResultModal({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PayrollEntryImportResult;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title="Import Results" widthClassName="max-w-[520px] max-h-[75vh]">
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex gap-4">
            <Badge tone="blue">{result.updated} updated</Badge>
            {result.skipped.length > 0 && <Badge tone="red">{result.skipped.length} skipped</Badge>}
          </div>
          {result.skipped.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-text">Skipped rows</p>
              {result.skipped.map((skip) => (
                <div key={skip.row} className="rounded border border-border bg-bg px-2.5 py-1.5">
                  Row {skip.row}: {skip.reason}
                </div>
              ))}
            </div>
          )}
        </div>
        <ModalFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function PayrollEntryPage({ user }: { user: SessionUser }) {
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
  const [correctingEntryId, setCorrectingEntryId] = useState<string | undefined>(undefined);
  const [historyEntry, setHistoryEntry] = useState<PayrollEntry | undefined>(undefined);
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
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<PayrollEntryImportResult | undefined>(undefined);
  const importPayrollEntries = useImportPayrollEntries(cycleId ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleCreateCorrection = useCallback((entry: PayrollEntry) => {
    setCorrectingEntryId(entry.id);
    setRequestCorrectionOpen(true);
  }, []);

  const handleViewCorrectionHistory = useCallback((entry: PayrollEntry) => {
    setHistoryEntry(entry);
  }, []);

  // Communicates Option C's approved limitation (Phase 3 Checkpoint 5): the flat import/export
  // format represents only an entry's primary work line, so a currently-filtered split employee's
  // additional lines aren't in the file — surfaced as UI copy rather than a format change,
  // per the approved architecture.
  const splitEntryCount = useMemo(
    () => filteredEntries.filter((entry) => entry.workLines.length > 1).length,
    [filteredEntries],
  );

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  async function handleImportFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const result = await importPayrollEntries.mutateAsync(file);
      setImportResult(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Import failed');
    }
  }

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
                  <PrintButton />
                  <Button variant="secondary" onClick={() => downloadPayrollEntryExport(cycleId, 'csv', selectedSiteIds)}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Export CSV
                  </Button>
                  <Button variant="secondary" onClick={() => downloadPayrollEntryExport(cycleId, 'xlsx', selectedSiteIds)}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Export Excel
                  </Button>
                  {hasReleasedEntries && canRequestCorrection(user) && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCorrectingEntryId(undefined);
                        setRequestCorrectionOpen(true);
                      }}
                    >
                      <FileEdit className="h-3.5 w-3.5" aria-hidden />
                      Request Correction
                    </Button>
                  )}
                  {!isArchived && (
                    <>
                      <Button variant="secondary" onClick={() => downloadPayrollEntryImportTemplate()}>
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        Download Import Template
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importPayrollEntries.isPending}
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden />
                        {importPayrollEntries.isPending ? 'Importing…' : 'Import'}
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.xlsx"
                        className="hidden"
                        onChange={handleImportFileSelected}
                      />
                    </>
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
                  split across more than one location this cycle — CSV/Excel import and export only cover each
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
                      canCorrect={canRequestCorrection(user)}
                      onCreateCorrection={handleCreateCorrection}
                      onViewCorrectionHistory={handleViewCorrectionHistory}
                    />
                  </div>
                  <div className="hidden print:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Employee</TableHead>
                          <TableHead>Site</TableHead>
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
                          const deductions =
                            Number(entry.eobiAmount) +
                            Number(entry.advanceDeduction) +
                            Number(entry.eidAdvanceDeduction) +
                            Number(entry.fine);
                          const netSalary = calcNet(buildCalcInput(entry)).netSalary;
                          return (
                            <TableRow key={entry.id}>
                              <TableCell>{entry.employee.employeeCode ?? '—'}</TableCell>
                              <TableCell>{entry.employee.name}</TableCell>
                              <TableCell>{entry.site.name}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatMoney(entry.grossPay)}</TableCell>
                              <TableCell className="text-right tabular-nums">{entry.workLines[0]?.days ?? '—'}</TableCell>
                              <TableCell className="text-right tabular-nums">{entry.workLines[0]?.otHours ?? '—'}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatMoney(entry.allowance)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatMoney(deductions.toFixed(2))}</TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">
                                {formatMoney(netSalary)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <NewCycleModal open={newCycleOpen} onOpenChange={setNewCycleOpen} />
      {importResult && (
        <ImportResultModal
          open={Boolean(importResult)}
          onOpenChange={(open) => !open && setImportResult(undefined)}
          result={importResult}
        />
      )}
      {hasReleasedEntries && (
        <RequestCorrectionModal
          open={requestCorrectionOpen}
          onOpenChange={(next) => {
            setRequestCorrectionOpen(next);
            if (!next) setCorrectingEntryId(undefined);
          }}
          entries={correctableEntries}
          initialEntryId={correctingEntryId}
        />
      )}
      <CorrectionHistoryModal
        open={Boolean(historyEntry)}
        onOpenChange={(next) => !next && setHistoryEntry(undefined)}
        entry={historyEntry}
      />
    </AppShell>
  );
}
