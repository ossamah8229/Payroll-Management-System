import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { SessionUser } from '@payroll/shared';
import { PERMISSIONS } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBanks } from '@/hooks/use-banks';
import { formatCycleLabel, useCurrentPayrollCycle } from '@/hooks/use-payroll-cycles';
import { usePayrollEntries } from '@/hooks/use-payroll-entries';
import { PayrollEntryGrid } from '@/components/payroll-entry/payroll-entry-grid';
import { NewCycleModal } from '@/components/payroll-entry/new-cycle-modal';

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

export function PayrollEntryPage({ user }: { user: SessionUser }) {
  const { cycle, isLoading: cycleLoading, error: cycleError } = useCurrentPayrollCycle();
  const {
    data: entries,
    isLoading: entriesLoading,
    error: entriesError,
  } = usePayrollEntries(cycle?.id);
  const banks = useBanks();
  const [newCycleOpen, setNewCycleOpen] = useState(false);

  const canManageCycles = user.permissions.includes(PERMISSIONS.PAYROLL_CYCLE_MANAGE);
  const isLoading = cycleLoading || (Boolean(cycle) && (entriesLoading || banks.isLoading));

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
          {!cycleError &&
            !isLoading &&
            cycle &&
            !entriesError &&
            entries &&
            entries.length > 0 && <PayrollEntryGrid cycle={cycle} entries={entries} banks={banks.data ?? []} />}
        </CardContent>
      </Card>

      <NewCycleModal open={newCycleOpen} onOpenChange={setNewCycleOpen} />
    </AppShell>
  );
}
