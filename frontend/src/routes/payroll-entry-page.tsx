import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { SessionUser } from '@payroll/shared';
import { PERMISSIONS } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { useBanks } from '@/hooks/use-banks';
import { useProjectSites } from '@/hooks/use-project-sites';
import { formatCycleLabel, useCurrentPayrollCycle } from '@/hooks/use-payroll-cycles';
import { usePayrollEntries, type PayrollEntry } from '@/hooks/use-payroll-entries';
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

  const canManageCycles = user.permissions.includes(PERMISSIONS.PAYROLL_CYCLE_MANAGE);
  const isLoading = cycleLoading || (Boolean(cycle) && (entriesLoading || banks.isLoading));

  const filteredEntries = useMemo(
    () => filterEntriesBySite(entries ?? [], selectedSiteIds),
    [entries, selectedSiteIds],
  );

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  return (
    <AppShell user={user} title="Payroll Entry" subtitle="This cycle's editable payroll figures">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <CardTitle>Payroll Entry</CardTitle>
            {cycle && <Badge tone={cycle.status === 'DRAFT' ? 'green' : 'gray'}>{formatCycleLabel(cycle)}</Badge>}
          </div>
          {cycle && canManageCycles && (
            <Button size="sm" variant="secondary" onClick={() => setNewCycleOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New Payroll Cycle
            </Button>
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
    </AppShell>
  );
}
