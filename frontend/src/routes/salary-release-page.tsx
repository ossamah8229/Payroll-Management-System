import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { PERMISSIONS } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useProjectSites } from '@/hooks/use-project-sites';
import { formatCycleLabel, useCurrentPayrollCycle } from '@/hooks/use-payroll-cycles';
import { useReleaseProjectUnit, useUnitReleaseStatus, type UnitReleaseStatus } from '@/hooks/use-payroll-release';

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReleaseConfirmModal({
  open,
  onOpenChange,
  status,
  cycleLabel,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UnitReleaseStatus;
  cycleLabel: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const remainingCount = status.entryCount - status.willReleaseCount;

  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent title={`Release ${status.unit.name}`} widthClassName="max-w-[520px]">
        <div className="flex flex-col gap-3.5 text-xs">
          <p className="text-text-muted">
            You are about to release <span className="font-medium text-text">{status.unit.name}</span> for{' '}
            <span className="font-medium text-text">{cycleLabel}</span>. This action is permanent — a
            released Project Unit can never be un-released, and every payroll entry it finalizes becomes
            immutable (Principle 9).
          </p>
          <div className="flex flex-col gap-1.5 rounded border border-border bg-bg px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Employees at this Unit</span>
              <span className="font-medium text-text">{status.entryCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Will release now</span>
              <Badge tone="green">{status.willReleaseCount}</Badge>
            </div>
            {remainingCount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Remain pending (split across other Units)</span>
                <Badge tone="amber">{remainingCount}</Badge>
              </div>
            )}
          </div>
          {remainingCount > 0 && (
            <p className="text-text-muted">
              {remainingCount} employee{remainingCount === 1 ? '' : 's'} at this Unit also{' '}
              {remainingCount === 1 ? 'has' : 'have'} attendance split across another Project Unit this
              cycle — {remainingCount === 1 ? 'it' : 'they'} will only release once every Unit
              {remainingCount === 1 ? ' it touches has' : ' they touch have'} released.
            </p>
          )}
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Releasing…' : 'Release Unit'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function SalaryReleasePage({ user }: { user: SessionUser }) {
  const { cycle, isLoading: cycleLoading, error: cycleError } = useCurrentPayrollCycle();
  const sites = useProjectSites();
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<UnitReleaseStatus | undefined>(undefined);

  useEffect(() => {
    if (!siteId && sites.data && sites.data.length > 0) {
      setSiteId(sites.data[0]!.id);
    }
  }, [siteId, sites.data]);

  const unitStatus = useUnitReleaseStatus(cycle?.id, siteId);
  const releaseUnit = useReleaseProjectUnit(cycle?.id ?? '', siteId ?? '');

  const canRelease = user.permissions.includes(PERMISSIONS.PAYROLL_RELEASE);
  const cycleLabel = cycle ? formatCycleLabel(cycle) : '';

  async function handleConfirmRelease() {
    if (!confirming) return;
    try {
      const result = await releaseUnit.mutateAsync(confirming.unit.id);
      toast.success(
        result.releasedEntryCount > 0
          ? `${confirming.unit.name} released — ${result.releasedEntryCount} payroll ${
              result.releasedEntryCount === 1 ? 'entry' : 'entries'
            } finalized`
          : `${confirming.unit.name} released`,
      );
      setConfirming(undefined);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Release failed');
    }
  }

  return (
    <AppShell user={user} title="Salary Release" subtitle="Release payroll by Project Unit">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <CardTitle>Salary Release</CardTitle>
            {cycle && <Badge tone={cycle.status === 'DRAFT' ? 'green' : 'gray'}>{cycleLabel}</Badge>}
          </div>
          {(sites.data ?? []).length > 0 && (
            <select
              className={selectClassName}
              value={siteId ?? ''}
              onChange={(e) => setSiteId(e.target.value)}
              aria-label="Project Site"
            >
              {(sites.data ?? []).map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {cycleError && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load the payroll cycle</p>
              <p className="text-xs text-text-muted">{cycleError.message}</p>
            </div>
          )}

          {!cycleError && cycleLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {!cycleError && !cycleLoading && !cycle && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No Draft payroll cycle exists yet</p>
              <p className="max-w-sm text-xs text-text-muted">
                Payroll must be prepared in a Draft cycle before any Project Unit can be released.
              </p>
            </div>
          )}

          {!cycleError && !cycleLoading && cycle && (sites.data ?? []).length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No Project Sites are assigned to you yet</p>
              <p className="text-xs text-text-muted">
                Ask a Master User to assign a Project Site before Salary Release can be used.
              </p>
            </div>
          )}

          {!cycleError && !cycleLoading && cycle && siteId && (
            <>
              {unitStatus.error && (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-danger">Could not load release status</p>
                  <p className="text-xs text-text-muted">{unitStatus.error.message}</p>
                </div>
              )}

              {!unitStatus.error && unitStatus.isLoading && (
                <div className="flex flex-col gap-2 p-[18px]">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}

              {!unitStatus.error && !unitStatus.isLoading && (unitStatus.data ?? []).length === 0 && (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-text">No Project Units at this Site</p>
                  <p className="text-xs text-text-muted">
                    Ask a Master User to add a Project Unit before payroll can be released here.
                  </p>
                </div>
              )}

              {!unitStatus.error && !unitStatus.isLoading && (unitStatus.data ?? []).length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Employees</TableHead>
                      <TableHead>Released</TableHead>
                      <TableHead className="w-40" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(unitStatus.data ?? []).map((status) => (
                      <TableRow key={status.unit.id}>
                        <TableCell className="font-medium">
                          {status.unit.name}
                          {status.unit.code && (
                            <span className="ml-1.5 text-text-faint">({status.unit.code})</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge tone={status.released ? 'green' : 'amber'}>
                            {status.released ? 'Released' : 'Pending'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{status.entryCount}</TableCell>
                        <TableCell className="text-text-muted">
                          {status.released && status.releasedAt && status.releasedBy
                            ? `${formatDateTime(status.releasedAt)} · ${status.releasedBy.name}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {!status.released && canRelease && cycle.status === 'DRAFT' && (
                            <Button size="sm" onClick={() => setConfirming(status)}>
                              Release
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {confirming && (
        <ReleaseConfirmModal
          open={Boolean(confirming)}
          onOpenChange={(open) => !open && setConfirming(undefined)}
          status={confirming}
          cycleLabel={cycleLabel}
          onConfirm={handleConfirmRelease}
          isPending={releaseUnit.isPending}
        />
      )}
    </AppShell>
  );
}
