import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { PERMISSIONS } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FilterField } from '@/components/ui/filter-field';
import { ApiError } from '@/lib/api-client';
import { useProjectSites } from '@/hooks/use-project-sites';
import {
  formatCycleLabel,
  useFinalizePayrollCycle,
  useRolloverPayrollCycle,
  type PayrollCycle,
} from '@/hooks/use-payroll-cycles';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
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

function FinalizeConfirmModal({
  open,
  onOpenChange,
  cycleLabel,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleLabel: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent title={`Finalize ${cycleLabel}`} widthClassName="max-w-[520px]">
        <div className="flex flex-col gap-3.5 text-xs">
          <p className="text-text-muted">
            Every payroll entry must be either released or held before finalization.
          </p>
          <p className="text-text-muted">
            Finalization is a <span className="font-medium text-text">one-way</span> lifecycle
            action — once finalized, this cycle moves from Draft to Released and per-Unit release
            actions are disabled. Held employees are <span className="font-medium text-text">not
            paid</span> by finalization; it does not release them, generate a backup, or start the
            next payroll cycle. Archiving and starting the next cycle happen later, as their own
            separate steps.
          </p>
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Finalizing…' : 'Finalize Cycle'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/** Purely a display computation, mirroring the backend's own derived-period arithmetic
 * (`archiveAndCreateNextPayrollCycle`) — never sent to the server; the backend derives the real
 * next period itself and this label is only ever used to preview it before confirming. */
function nextCycleLabel(cycle: Pick<PayrollCycle, 'year' | 'month'>): string {
  const nextMonth = cycle.month === 12 ? 1 : cycle.month + 1;
  const nextYear = cycle.month === 12 ? cycle.year + 1 : cycle.year;
  return formatCycleLabel({ year: nextYear, month: nextMonth });
}

function RolloverConfirmModal({
  open,
  onOpenChange,
  cycleLabel,
  nextLabel,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleLabel: string;
  nextLabel: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent title="Start New Payroll Cycle" widthClassName="max-w-[520px]">
        <div className="flex flex-col gap-3.5 text-xs">
          <p className="text-text-muted">
            This starts <span className="font-medium text-text">{nextLabel}</span> as the next Draft
            payroll cycle.
          </p>
          <div className="flex flex-col gap-1.5 rounded border border-border bg-bg px-3 py-2.5">
            <p className="text-text-muted">
              <span className="font-medium text-text">{cycleLabel}</span> will be archived — it becomes
              permanently read-only. This is a <span className="font-medium text-text">one-way</span>{' '}
              lifecycle action.
            </p>
            <p className="text-text-muted">
              A fresh Backup Package will be generated for {cycleLabel} immediately before it archives.
            </p>
            <p className="text-text-muted">
              {nextLabel} is created automatically — the next calendar month after {cycleLabel}.
            </p>
          </div>
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Starting…' : 'Start New Payroll Cycle'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function SalaryReleasePage({ user }: { user: SessionUser }) {
  // Phase 5 Checkpoint 4 — the shared Historical Payroll Cycle Selector. Action-taking (Release,
  // Finalize, Rollover) only ever targets `cycle` (the resolved row), gated by its live `status`
  // from the server — never an implicit "latest" cycle, and never reachable against a historical
  // selection this page's own status gates below don't explicitly allow.
  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('release');
  const hasAnyCycle = cycles.length > 0;
  const navigate = useNavigate();
  const sites = useProjectSites();
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<UnitReleaseStatus | undefined>(undefined);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const [confirmingRollover, setConfirmingRollover] = useState(false);

  useEffect(() => {
    if (!siteId && sites.data && sites.data.length > 0) {
      setSiteId(sites.data[0]!.id);
    }
  }, [siteId, sites.data]);

  // Frontend action safety (Phase 5 Checkpoint 4 architecture review, §11) — a confirmation modal
  // open for one selected cycle must never silently carry over to a different one navigated to
  // underneath it (e.g. via browser back/forward while a modal is open).
  useEffect(() => {
    setConfirming(undefined);
    setConfirmingFinalize(false);
    setConfirmingRollover(false);
  }, [cycleId]);

  const unitStatus = useUnitReleaseStatus(cycle?.id, siteId);
  const releaseUnit = useReleaseProjectUnit(cycle?.id ?? '', siteId ?? '');
  const finalizeCycle = useFinalizePayrollCycle();
  const rolloverCycle = useRolloverPayrollCycle();

  const canRelease = user.permissions.includes(PERMISSIONS.PAYROLL_RELEASE);
  const canFinalize = user.permissions.includes(PERMISSIONS.PAYROLL_CYCLE_MANAGE);
  const cycleLabel = cycle ? formatCycleLabel(cycle) : '';
  const isArchived = cycle?.status === 'ARCHIVED';

  async function handleConfirmRelease() {
    if (!confirming || !cycle) return;
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

  async function handleConfirmFinalize() {
    if (!cycle) return;
    try {
      await finalizeCycle.mutateAsync(cycle.id);
      toast.success(`${cycleLabel} finalized — the cycle is now Released`);
      setConfirmingFinalize(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Finalization failed');
    }
  }

  async function handleConfirmRollover() {
    if (!cycle) return;
    try {
      const result = await rolloverCycle.mutateAsync(cycle.id);
      toast.success(`${formatCycleLabel(result.newCycle)} started — ${cycleLabel} archived`);
      setConfirmingRollover(false);
      // Navigate straight to the new Draft's own Release page — never rely on the default-
      // selection rule alone, since the cycle list refetch that would drive it is asynchronous and
      // the user should land on the cycle they just created, not wherever the default happens to
      // resolve to in the meantime (Phase 5 Checkpoint 4 architecture review, §11).
      navigate(`/payroll-cycles/${result.newCycle.id}/release`, { replace: true });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Starting the new payroll cycle failed');
    }
  }

  return (
    <AppShell user={user} title="Salary Release" subtitle="Release payroll by Project Unit">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <CardTitle>Salary Release</CardTitle>
              {cycle && <PayrollCycleStatusBadge cycle={cycle} />}
            </div>
            {cycle && canFinalize && cycle.status === 'DRAFT' && (
              <Button size="sm" variant="secondary" onClick={() => setConfirmingFinalize(true)}>
                Finalize Cycle
              </Button>
            )}
            {cycle && canFinalize && cycle.status === 'RELEASED' && (
              <Button size="sm" variant="secondary" onClick={() => setConfirmingRollover(true)}>
                Start New Payroll Cycle
              </Button>
            )}
          </div>
          {hasAnyCycle && (
            <div className="flex flex-wrap items-end gap-3">
              <PayrollCycleSelectField
                id="salary-release-cycle"
                cycles={cycles}
                selectedCycleId={cycleId}
                onSelect={selectCycle}
              />
              {(sites.data ?? []).length > 0 && (
                <FilterField id="salary-release-site" label="Site">
                  <select
                    id="salary-release-site"
                    className={selectClassName}
                    value={siteId ?? ''}
                    onChange={(e) => setSiteId(e.target.value)}
                  >
                    {(sites.data ?? []).map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </FilterField>
              )}
            </div>
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
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!cycleError && !cycleLoading && !cycleId && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No payroll cycle exists yet</p>
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
              {isArchived && (
                <div className="mx-[18px] mt-[18px] flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                  This cycle is Archived — the release summary below is historical and read-only. No
                  further release, Finalize, or rollover action can be taken against it.
                </div>
              )}
              {unitStatus.error && (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-danger">Could not load release status</p>
                  <p className="text-xs text-text-muted">{unitStatus.error.message}</p>
                </div>
              )}

              {!unitStatus.error && unitStatus.isLoading && (
                <div className="flex flex-col gap-2 p-[18px]">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
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

      {cycle && (
        <FinalizeConfirmModal
          open={confirmingFinalize}
          onOpenChange={(open) => !finalizeCycle.isPending && setConfirmingFinalize(open)}
          cycleLabel={cycleLabel}
          onConfirm={handleConfirmFinalize}
          isPending={finalizeCycle.isPending}
        />
      )}

      {cycle && (
        <RolloverConfirmModal
          open={confirmingRollover}
          onOpenChange={(open) => !rolloverCycle.isPending && setConfirmingRollover(open)}
          cycleLabel={cycleLabel}
          nextLabel={nextCycleLabel(cycle)}
          onConfirm={handleConfirmRollover}
          isPending={rolloverCycle.isPending}
        />
      )}
    </AppShell>
  );
}
