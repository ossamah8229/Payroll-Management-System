import { useMemo, useRef, useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { PERMISSIONS } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { ApiError } from '@/lib/api-client';
import { useBanks } from '@/hooks/use-banks';
import { useProjectSites } from '@/hooks/use-project-sites';
import { formatCycleLabel, useCurrentPayrollCycle } from '@/hooks/use-payroll-cycles';
import {
  downloadPayrollEntryExport,
  usePayrollEntries,
  useImportPayrollEntries,
  type PayrollEntry,
  type PayrollEntryImportResult,
} from '@/hooks/use-payroll-entries';
import { PayrollEntryGrid } from '@/components/payroll-entry/payroll-entry-grid';
import { NewCycleModal } from '@/components/payroll-entry/new-cycle-modal';
import { CopyToAllToolbar } from '@/components/payroll-entry/copy-to-all-toolbar';

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

function NoCycleEmptyState({ canManageCycles, onCreate }: { canManageCycles: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <p className="text-xs font-medium text-text">No Draft payroll cycle exists yet</p>
      <p className="max-w-sm text-xs text-text-muted">
        {canManageCycles
          ? 'Start a new payroll cycle to begin entering this month’s figures.'
          : 'Ask a Master User to start a new payroll cycle before Payroll Entry can be used.'}
      </p>
      {canManageCycles && (
        <Button size="sm" className="mt-2" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Start New Payroll Cycle
        </Button>
      )}
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
      <ModalContent title="Import Results" widthClassName="max-w-[520px] max-h-[75vh] overflow-y-auto">
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
  const { cycle, isLoading: cycleLoading, error: cycleError } = useCurrentPayrollCycle();
  const {
    data: entries,
    isLoading: entriesLoading,
    error: entriesError,
  } = usePayrollEntries(cycle?.id);
  const banks = useBanks();
  const sites = useProjectSites();
  const [newCycleOpen, setNewCycleOpen] = useState(false);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<PayrollEntryImportResult | undefined>(undefined);
  const importPayrollEntries = useImportPayrollEntries(cycle?.id ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canManageCycles = user.permissions.includes(PERMISSIONS.PAYROLL_CYCLE_MANAGE);
  const isLoading = cycleLoading || (Boolean(cycle) && (entriesLoading || banks.isLoading));

  const filteredEntries = useMemo(
    () => filterEntriesBySite(entries ?? [], selectedSiteIds),
    [entries, selectedSiteIds],
  );

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
          <div className="flex items-center gap-2.5">
            <CardTitle>Payroll Entry</CardTitle>
            {cycle && <Badge tone={cycle.status === 'DRAFT' ? 'green' : 'gray'}>{formatCycleLabel(cycle)}</Badge>}
          </div>
          {cycle && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => downloadPayrollEntryExport(cycle.id, 'csv', selectedSiteIds)}>
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export CSV
              </Button>
              <Button size="sm" variant="secondary" onClick={() => downloadPayrollEntryExport(cycle.id, 'xlsx', selectedSiteIds)}>
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export Excel
              </Button>
              {cycle.status === 'DRAFT' && (
                <>
                  <Button
                    size="sm"
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
              {canManageCycles && (
                <Button size="sm" variant="secondary" onClick={() => setNewCycleOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New Payroll Cycle
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {cycleError && <GridErrorState message={cycleError.message} />}
          {!cycleError && isLoading && <GridLoadingState />}
          {!cycleError && !isLoading && !cycle && (
            <NoCycleEmptyState canManageCycles={canManageCycles} onCreate={() => setNewCycleOpen(true)} />
          )}
          {!cycleError && !isLoading && cycle && entriesError && (
            <GridErrorState message={entriesError.message} />
          )}
          {!cycleError && !isLoading && cycle && !entriesError && entries && entries.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No payroll entries in this cycle</p>
              <p className="text-xs text-text-muted">
                No active employees were found to seed this cycle with.
              </p>
            </div>
          )}
          {!cycleError && !isLoading && cycle && !entriesError && entries && entries.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <MultiSelectFilter
                  id="payroll-entry-site-filter"
                  label="Site"
                  options={siteOptions}
                  selectedIds={selectedSiteIds}
                  onChange={setSelectedSiteIds}
                />
              </div>
              {splitEntryCount > 0 && (
                <p className="text-xs text-text-muted">
                  {splitEntryCount} employee{splitEntryCount === 1 ? '' : 's'} {splitEntryCount === 1 ? 'has' : 'have'} attendance
                  split across more than one location this cycle — CSV/Excel import and export only cover each
                  employee's primary line. Review or edit the full split directly in the grid via each row's Split
                  action.
                </p>
              )}
              {cycle.status === 'DRAFT' && (
                <CopyToAllToolbar cycleId={cycle.id} siteIds={selectedSiteIds} />
              )}
              {filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-text">No employees match the current site filter</p>
                  <p className="text-xs text-text-muted">Clear the filter to see every employee in this cycle.</p>
                </div>
              ) : (
                <PayrollEntryGrid cycle={cycle} entries={filteredEntries} banks={banks.data ?? []} />
              )}
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
    </AppShell>
  );
}
