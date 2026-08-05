import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { PERMISSIONS } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FilterField } from '@/components/ui/filter-field';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import {
  formatCycleLabel,
  useFinalizePayrollCycle,
  useRolloverPayrollCycle,
  type PayrollCycle,
} from '@/hooks/use-payroll-cycles';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { usePayrollEntries } from '@/hooks/use-payroll-entries';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import {
  useReleaseAll,
  useReleaseProjectUnit,
  useUnitReleaseStatus,
  type ReleaseAllResult,
  type ReleaseUnitResult,
  type UnitReleaseStatus,
} from '@/hooks/use-payroll-release';
import { usePayrollEntryCycleSaveSummary } from '@/lib/payroll-entry-save-status-store';

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

/** Release All (Phase 7F, 2026-08-04) — the site filter's own "All Sites" option, an empty string
 * (the natural "nothing more specific selected" value for a native `<select>`) rather than a
 * synthetic sentinel string, so `siteId ?? undefined`-style checks throughout this page keep
 * working unchanged; `siteId === undefined` already means "All Sites" everywhere below. */
const ALL_SITES_VALUE = '';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Partial Release Status (Hold Workflow Verification, Phase 7F, 2026-08-04) — a derived, per-Site
 * summary badge purely computed client-side from the already-fetched per-Unit `unitStatus` list
 * (no new backend endpoint; Principle 5 — nothing here is stored). Investigation found no
 * site-level status existed anywhere before this checkpoint, only the per-Unit Released/Pending
 * table rows below — this closes that specific gap the checkpoint's own audit asked about, without
 * replacing the per-Unit table (which still shows the authoritative detail this badge summarizes).
 *
 * **Every label is prefixed "Site:"** (Phase 7F Refinement, 2026-08-04) — deliberately never a bare
 * "Released"/"Pending" that could exact-text-match the per-Unit table's own identically-worded
 * per-row badges below it on the same page (a real ambiguity risk for anything asserting on exact
 * visible text, e.g. this project's own Playwright specs — a single-Unit Site would otherwise show
 * "Released" twice simultaneously, once at Site level and once for that Unit, with no way to tell
 * them apart by text alone).
 */
function SiteReleaseStatusBadge({ units }: { units: UnitReleaseStatus[] }) {
  const releasedCount = units.filter((unit) => unit.released).length;
  const totalWillRelease = units.reduce((sum, unit) => sum + unit.willReleaseCount, 0);
  const totalHeld = units.reduce((sum, unit) => sum + unit.heldCount, 0);

  if (releasedCount === units.length) {
    return <Badge tone="green">Site: Released</Badge>;
  }
  if (totalWillRelease === 0 && totalHeld > 0) {
    return (
      <Badge tone="hold">{releasedCount > 0 ? 'Site: Partially Released — Held Remaining' : 'Site: Held Remaining'}</Badge>
    );
  }
  if (releasedCount > 0) {
    return <Badge tone="amber">Site: Partially Released</Badge>;
  }
  return <Badge tone="gray">Site: Draft</Badge>;
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
  // Hold Workflow Verification (Phase 7F, 2026-08-04) — `entryCount - willReleaseCount` used to be
  // presented as entirely "split across other Units," but a Held employee also lands in that gap
  // for a completely different reason. Split out explicitly so the operator sees *why* an employee
  // isn't releasing right now, not just a bare, potentially-misleading count.
  const splitPendingCount = status.entryCount - status.willReleaseCount - status.heldCount;

  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent title={`Release ${status.released ? 'Remaining — ' : ''}${status.unit.name}`} widthClassName="max-w-[520px]">
        <div className="flex flex-col gap-3.5 text-xs">
          {status.released ? (
            <p className="text-text-muted">
              <span className="font-medium text-text">{status.unit.name}</span> already released for{' '}
              <span className="font-medium text-text">{cycleLabel}</span>. This sweeps only the employee
              {status.willReleaseCount === 1 ? '' : 's'} below who became eligible since then (typically: a
              Hold was removed) — it does not re-release, or otherwise touch, anyone already resolved.
            </p>
          ) : (
            <p className="text-text-muted">
              You are about to release <span className="font-medium text-text">{status.unit.name}</span> for{' '}
              <span className="font-medium text-text">{cycleLabel}</span>. This action is permanent — a
              released Project Unit can never be un-released, and every payroll entry it finalizes becomes
              immutable (Principle 9).
            </p>
          )}
          <div className="flex flex-col gap-1.5 rounded border border-border bg-bg px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Employees at this Unit</span>
              <span className="font-medium text-text">{status.entryCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Will release now</span>
              <Badge tone="green">{status.willReleaseCount}</Badge>
            </div>
            {status.heldCount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Held</span>
                <Badge tone="hold">{status.heldCount}</Badge>
              </div>
            )}
            {splitPendingCount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Remain pending (split across other Units)</span>
                <Badge tone="amber">{splitPendingCount}</Badge>
              </div>
            )}
          </div>
          {status.heldCount > 0 && (
            <p className="text-text-muted">
              {status.heldCount} employee{status.heldCount === 1 ? '' : 's'} at this Unit{' '}
              {status.heldCount === 1 ? 'is' : 'are'} on Hold and will not release — remove the Hold in
              Payroll Entry first if {status.heldCount === 1 ? 'this employee' : 'they'} should be paid now.
            </p>
          )}
          {splitPendingCount > 0 && (
            <p className="text-text-muted">
              {splitPendingCount} employee{splitPendingCount === 1 ? '' : 's'} at this Unit also{' '}
              {splitPendingCount === 1 ? 'has' : 'have'} attendance split across another Project Unit this
              cycle — {splitPendingCount === 1 ? 'it' : 'they'} will only release once every Unit
              {splitPendingCount === 1 ? ' it touches has' : ' they touch have'} released.
            </p>
          )}
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Releasing…' : status.released ? 'Release Remaining' : 'Release Unit'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Release All (Phase 7F, 2026-08-04) — confirms scope (one Site or every accessible Site) before
 * calling the bulk release. Mirrors `ReleaseConfirmModal`'s own permanence warning; does not
 * attempt to preview a count beforehand (unlike the single-Unit modal's `willReleaseCount`) since
 * that would mean evaluating the full eligibility sweep twice — once for the preview, once for the
 * real call — for a scope that can span many Units/Sites. The actual outcome is reported afterward
 * by `ReleaseAllSummaryModal`.
 */
function ReleaseAllConfirmModal({
  open,
  onOpenChange,
  scopeLabel,
  cycleLabel,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeLabel: string;
  cycleLabel: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent title="Release All" widthClassName="max-w-[520px]">
        <div className="flex flex-col gap-3.5 text-xs">
          <p className="text-text-muted">
            You are about to release every eligible employee at{' '}
            <span className="font-medium text-text">{scopeLabel}</span> for{' '}
            <span className="font-medium text-text">{cycleLabel}</span>. This action is permanent — a
            released Project Unit can never be un-released, and every payroll entry it finalizes becomes
            immutable (Principle 9).
          </p>
          <p className="text-text-muted">
            Already-released, Held, and Recovery Due/No Payout-resolved employees are automatically
            skipped — this never fails because one employee can&apos;t be released; it reports what
            happened afterward.
          </p>
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Releasing…' : 'Release All'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Release All's own result summary (Phase 7F, 2026-08-04) — the "58 Released, 3 Held, 2 Recovery
 * Due, 1 No Payout, 0 Failed"-style breakdown, plus drill-down detail for anything that needs the
 * operator's attention (blocked entries, failed Units) — mirroring `BlockedEmployeesModal`'s own
 * "never just a bare count" convention, extended to also cover a genuine per-Unit technical failure.
 */
function ReleaseAllSummaryModal({ result, onOpenChange }: { result: ReleaseAllResult; onOpenChange: (open: boolean) => void }) {
  const rows: Array<{ label: string; value: number; tone: 'green' | 'hold' | 'red' | 'amber' | 'gray' }> = [
    { label: 'Released', value: result.releasedEntryCount, tone: 'green' },
    { label: 'Held', value: result.heldEntryCount, tone: 'hold' },
    { label: 'Recovery Due', value: result.recoveryDueCount, tone: 'red' },
    { label: 'No Payout', value: result.noPayDueCount, tone: 'gray' },
    { label: 'Needs Attention', value: result.blockedCount, tone: 'amber' },
    { label: 'Failed', value: result.unitsFailed, tone: 'red' },
  ];

  return (
    <Modal open onOpenChange={onOpenChange}>
      <ModalContent title="Release All — Summary" widthClassName="max-w-[560px]">
        <div className="flex flex-col gap-3.5 text-xs">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col gap-1 rounded border border-border bg-bg px-3 py-2.5">
                <span className="text-text-muted">{row.label}</span>
                <Badge tone={row.tone}>{row.value}</Badge>
              </div>
            ))}
          </div>
          <p className="text-text-muted">
            {result.unitsReleased} Project Unit{result.unitsReleased === 1 ? '' : 's'} released
            {result.unitsAlreadyReleased > 0 &&
              ` (${result.unitsAlreadyReleased} already released, skipped)`}
            .
          </p>

          {result.blockedEntries.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-medium text-text">Needs Attention — master data must be corrected first</p>
              {result.blockedEntries.map((entry) => (
                <div key={entry.id} className="rounded border border-border bg-bg px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text">
                      {entry.employeeName} <span className="text-text-faint">— {entry.unitName}</span>
                    </span>
                    <Badge tone="amber">Needs Attention</Badge>
                  </div>
                  <ul className="mt-1.5 list-disc pl-4 text-text-muted">
                    {entry.blockReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {result.failedUnits.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-medium text-text">Failed — a technical error, not a business-rule block</p>
              {result.failedUnits.map((unit) => (
                <div key={unit.unitId} className="rounded border border-danger bg-danger-light/40 px-3 py-2.5">
                  <span className="font-medium text-text">{unit.unitName}</span>
                  <p className="mt-1 text-text-muted">{unit.error}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <ModalFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Salary Release visibility (2026-07-27 refinement) — a Unit release must never silently exclude
 * a blocked employee with no way to inspect why. Opens automatically right after a release whose
 * `blockedCount > 0`, listing exactly the same `blockReasons` the Payroll Entry grid's own "Needs
 * Attention" badge shows for that employee (`payroll-release-eligibility.ts` is the one canonical
 * source for both). Purely informational — blocked entries remain unresolved and still block
 * Finalize until fixed or manually held; this modal has no action of its own beyond closing.
 */
function BlockedEmployeesModal({
  unitName,
  entries,
  onOpenChange,
}: {
  unitName: string;
  entries: ReleaseUnitResult['blockedEntries'];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal open onOpenChange={onOpenChange}>
      <ModalContent title={`${unitName} — Needs Attention`} widthClassName="max-w-[520px]">
        <div className="flex flex-col gap-3.5 text-xs">
          <p className="text-text-muted">
            {entries.length} employee{entries.length === 1 ? '' : 's'} at this Unit could not be released —
            their master data needs correcting before they can be paid. Every other employee at this Unit
            released normally.
          </p>
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded border border-border bg-bg px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{entry.employeeName}</span>
                  <Badge tone="amber">Needs Attention</Badge>
                </div>
                <ul className="mt-1.5 list-disc pl-4 text-text-muted">
                  {entry.blockReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <ModalFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
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
  // Scoped to this user's own accessible sites (System-Wide RBAC Consistency remediation) — never
  // the raw, sites:manage-aware unrestricted useProjectSites() list. Salary Release stays a
  // strictly site-scoped operational domain; holding sites:manage does not widen it.
  const sites = useAccessibleProjectSites(user);
  // `undefined` means "All Sites" (Release All, Phase 7F, 2026-08-04) — the initial-default effect
  // below still seeds the first accessible Site, keeping the pre-existing single-site default
  // browsing experience; the operator can explicitly pick "All Sites" from the filter afterward.
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [siteExplicitlyChosen, setSiteExplicitlyChosen] = useState(false);
  const [confirming, setConfirming] = useState<UnitReleaseStatus | undefined>(undefined);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const [confirmingRollover, setConfirmingRollover] = useState(false);
  const [confirmingReleaseAll, setConfirmingReleaseAll] = useState(false);
  const [blockedResult, setBlockedResult] = useState<
    { unitName: string; entries: ReleaseUnitResult['blockedEntries'] } | undefined
  >(undefined);
  const [releaseAllResult, setReleaseAllResult] = useState<ReleaseAllResult | undefined>(undefined);

  useEffect(() => {
    if (!siteExplicitlyChosen && !siteId && sites.data && sites.data.length > 0) {
      setSiteId(sites.data[0]!.id);
    }
  }, [siteId, siteExplicitlyChosen, sites.data]);

  // Frontend action safety (Phase 5 Checkpoint 4 architecture review, §11) — a confirmation modal
  // open for one selected cycle must never silently carry over to a different one navigated to
  // underneath it (e.g. via browser back/forward while a modal is open).
  useEffect(() => {
    setConfirming(undefined);
    setConfirmingFinalize(false);
    setConfirmingRollover(false);
    setConfirmingReleaseAll(false);
    setBlockedResult(undefined);
    setReleaseAllResult(undefined);
  }, [cycleId]);

  const unitStatus = useUnitReleaseStatus(cycle?.id, siteId);
  const releaseUnit = useReleaseProjectUnit(cycle?.id ?? '', siteId ?? '');
  const releaseAll = useReleaseAll(cycle?.id ?? '');
  const finalizeCycle = useFinalizePayrollCycle();
  const rolloverCycle = useRolloverPayrollCycle();

  // Phase 7E durability checkpoint (A4) — the frontend half of the release interlock. Reuses the
  // exact same per-row `SaveStatus` truth the Payroll Entry grid's own banner reads
  // (`payrollEntrySaveStatusStore`), never a second, independently-tracked "is this dirty" check.
  // This is a same-tab/same-session signal only — it cannot see another tab's or another user's
  // in-flight edit (documented limitation, `payroll-entry-save-status-store.ts`'s own doc comment)
  // — the backend's `expectedVersions` check below is what actually guarantees correctness across
  // sessions; this is purely a "don't even let the operator try" convenience on top of that.
  const saveSummary = usePayrollEntryCycleSaveSummary(cycle?.id);
  const hasPendingEntryWork = saveSummary.pendingCount > 0;

  // Fetched only to extract each currently-releasable entry's own `{id, version}` — the
  // `expectedVersions` preflight below reuses this same already-existing query (Payroll Entry's
  // own), rather than introducing a second read endpoint just for this Unit-scoped slice.
  const entriesForVersionCheck = usePayrollEntries(cycle?.id);

  function expectedVersionsForUnit(unitId: string): { entryId: string; version: number }[] {
    return (entriesForVersionCheck.data ?? [])
      .filter(
        (entry) =>
          !entry.released && entry.payoutOutcome === null && entry.workLines.some((line) => line.unitId === unitId),
      )
      .map((entry) => ({ entryId: entry.id, version: entry.version }));
  }

  const canRelease = user.permissions.includes(PERMISSIONS.PAYROLL_RELEASE);
  const canFinalize = user.permissions.includes(PERMISSIONS.PAYROLL_CYCLE_MANAGE);
  const cycleLabel = cycle ? formatCycleLabel(cycle) : '';
  const isArchived = cycle?.status === 'ARCHIVED';
  const releaseAllScopeLabel = siteId ? (sites.data ?? []).find((site) => site.id === siteId)?.name ?? 'this Site' : 'All Sites';

  async function handleConfirmRelease() {
    if (!confirming || !cycle) return;
    try {
      const result = await releaseUnit.mutateAsync({
        unitId: confirming.unit.id,
        expectedVersions: expectedVersionsForUnit(confirming.unit.id),
      });
      const parts: string[] = [];
      if (result.releasedEntryCount > 0) {
        parts.push(`${result.releasedEntryCount} paid`);
      }
      if (result.noPayDueCount > 0) {
        parts.push(`${result.noPayDueCount} no pay due`);
      }
      if (result.recoveryDueCount > 0) {
        parts.push(`${result.recoveryDueCount} recovery due`);
      }
      if (result.blockedCount > 0) {
        parts.push(`${result.blockedCount} blocked — needs attention`);
      }
      const verb = result.isLateSweep ? 'swept' : 'released';
      toast.success(
        parts.length > 0 ? `${confirming.unit.name} ${verb} — ${parts.join(', ')}` : `${confirming.unit.name} ${verb}`,
      );
      if (result.blockedEntries.length > 0) {
        setBlockedResult({ unitName: confirming.unit.name, entries: result.blockedEntries });
      }
      setConfirming(undefined);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Release failed');
    }
  }

  async function handleConfirmReleaseAll() {
    if (!cycle) return;
    try {
      const result = await releaseAll.mutateAsync({ siteId });
      const parts: string[] = [
        `${result.releasedEntryCount} Released`,
        `${result.heldEntryCount} Held`,
        `${result.recoveryDueCount} Recovery Due`,
        `${result.noPayDueCount} No Payout`,
      ];
      if (result.blockedCount > 0) parts.push(`${result.blockedCount} Needs Attention`);
      parts.push(`${result.unitsFailed} Failed`);
      toast.success(parts.join(' · '));
      setConfirmingReleaseAll(false);
      setReleaseAllResult(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Release All failed');
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
          <PayrollPageToolbar
            title="Salary Release"
            badge={
              cycle && (
                <div className="flex items-center gap-1.5">
                  <PayrollCycleStatusBadge cycle={cycle} />
                  {siteId && !unitStatus.error && !unitStatus.isLoading && (unitStatus.data ?? []).length > 0 && (
                    <SiteReleaseStatusBadge units={unitStatus.data ?? []} />
                  )}
                </div>
              )
            }
            filters={
              <>
                {hasAnyCycle && (
                  <PayrollCycleSelectField
                    id="salary-release-cycle"
                    cycles={cycles}
                    selectedCycleId={cycleId}
                    onSelect={selectCycle}
                  />
                )}
                {hasAnyCycle && (sites.data ?? []).length > 0 && (
                  <FilterField id="salary-release-site" label="Site">
                    <select
                      id="salary-release-site"
                      className={selectClassName}
                      value={siteId ?? ALL_SITES_VALUE}
                      onChange={(e) => {
                        setSiteExplicitlyChosen(true);
                        setSiteId(e.target.value || undefined);
                      }}
                    >
                      {/* Release All (Phase 7F, 2026-08-04) — every accessible Site at once. The
                          per-Unit browsing table below only makes sense for one concrete Site, so it's
                          replaced with a scope-appropriate message while this option is selected. */}
                      <option value={ALL_SITES_VALUE}>All Sites</option>
                      {(sites.data ?? []).map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </select>
                  </FilterField>
                )}
              </>
            }
            actions={
              <>
                <PrintButton recommendedOrientation="portrait" />
                {/* Release All (Phase 7F, 2026-08-04) — same eligibility gate as an individual Unit
                    Release button (`canRelease`, Draft cycle, no unsaved Payroll Entry work). */}
                {cycle && canRelease && cycle.status === 'DRAFT' && (
                  <Button
                    variant="secondary"
                    onClick={() => setConfirmingReleaseAll(true)}
                    disabled={hasPendingEntryWork}
                    title={
                      hasPendingEntryWork
                        ? 'Release is disabled while this cycle has unsaved, saving, retrying, or conflicted Payroll Entry rows'
                        : undefined
                    }
                  >
                    Release All
                  </Button>
                )}
                {cycle && canFinalize && (cycle.status === 'DRAFT' || cycle.status === 'RELEASED') && (
                  <>
                    {cycle.status === 'DRAFT' && (
                      <Button variant="secondary" onClick={() => setConfirmingFinalize(true)}>
                        Finalize Cycle
                      </Button>
                    )}
                    {cycle.status === 'RELEASED' && (
                      <Button variant="secondary" onClick={() => setConfirmingRollover(true)}>
                        Start New Payroll Cycle
                      </Button>
                    )}
                  </>
                )}
              </>
            }
          />
        </CardHeader>
        <CardContent className="p-0">
          {cycle && (
            <div className="px-[18px] pt-[18px]">
              <PrintContextHeader title="Salary Release" context={`${formatCycleLabel(cycle)} · ${cycle.status}`} />
            </div>
          )}
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

          {!cycleError && !cycleLoading && cycle && (sites.data ?? []).length > 0 && (
            <>
              {isArchived && (
                <div className="mx-[18px] mt-[18px] flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                  This cycle is Archived — the release summary below is historical and read-only. No
                  further release, Finalize, or rollover action can be taken against it.
                </div>
              )}
              {!isArchived && hasPendingEntryWork && (
                <div className="mx-[18px] mt-[18px] flex items-center gap-2 rounded border border-warning bg-warning-light/40 px-3 py-2 text-xs text-text print:hidden">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                  Release is disabled — this cycle has {saveSummary.pendingCount} Payroll Entry row
                  {saveSummary.pendingCount === 1 ? '' : 's'} that {saveSummary.pendingCount === 1 ? 'is' : 'are'} not
                  yet server-confirmed saved (unsaved, saving, retrying, or in conflict). Releasing now could
                  exclude an edit that hasn't reached the server yet.{' '}
                  {cycleId && (
                    <Link
                      to={`/payroll-cycles/${cycleId}/payroll-entry`}
                      className="font-medium text-accent-mid underline hover:no-underline"
                    >
                      Go to Payroll Entry to resolve or retry
                    </Link>
                  )}
                </div>
              )}
              {/* Release All (Phase 7F, 2026-08-04) — "All Sites" has no single per-Unit table to
                  show (the table below is inherently one-Site-at-a-time); pick a specific Site to
                  browse Units individually, or use the Release All action above directly. */}
              {!siteId && (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-text">All Sites selected</p>
                  <p className="max-w-sm text-xs text-text-muted">
                    Pick one Site above to browse and release its Project Units individually, or use
                    Release All to release every eligible employee across every accessible Site at once.
                  </p>
                </div>
              )}

              {siteId && unitStatus.error && (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-danger">Could not load release status</p>
                  <p className="text-xs text-text-muted">{unitStatus.error.message}</p>
                </div>
              )}

              {siteId && !unitStatus.error && unitStatus.isLoading && (
                <div className="flex flex-col gap-2 p-[18px]">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}

              {siteId && !unitStatus.error && !unitStatus.isLoading && (unitStatus.data ?? []).length === 0 && (
                <div className="flex flex-col items-center gap-1 py-14 text-center">
                  <p className="text-xs font-medium text-text">No Project Units at this Site</p>
                  <p className="text-xs text-text-muted">
                    Ask a Master User to add a Project Unit before payroll can be released here.
                  </p>
                </div>
              )}

              {siteId && !unitStatus.error && !unitStatus.isLoading && (unitStatus.data ?? []).length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Employees</TableHead>
                      <TableHead>Released</TableHead>
                      {/* The Release action column is screen-only (Professional Printing checkpoint
                          B3) — meaningless on a printed document, so hidden here and on its own
                          per-row cell below rather than left to print as an empty button gap. */}
                      <TableHead className="w-40 print:hidden" />
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
                        <TableCell className="text-right tabular-nums">
                          <div className="flex items-center justify-end gap-1.5">
                            <span>{status.entryCount}</span>
                            {status.heldCount > 0 && (
                              <Badge tone="hold" title={`${status.heldCount} employee${status.heldCount === 1 ? '' : 's'} on Hold at this Unit`}>
                                {status.heldCount} Held
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-text-muted">
                          {status.released && status.releasedAt && status.releasedBy
                            ? `${formatDateTime(status.releasedAt)} · ${status.releasedBy.name}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right print:hidden">
                          {/* Late/Straggler Sweep (Hold Workflow Verification, Phase 7F,
                              2026-08-04) — a Unit that's already released can still have a fresh
                              action available: an entry Held at the time of the original release,
                              since un-Held, has no other path back to being released this cycle.
                              `willReleaseCount` now reflects that even for an already-released Unit
                              (`getUnitReleaseStatus`), so the action reappears exactly when there's
                              a genuine straggler to sweep, labeled distinctly from a first-time
                              release. */}
                          {canRelease && cycle.status === 'DRAFT' && (!status.released || status.willReleaseCount > 0) && (
                            <Button
                              size="sm"
                              variant={status.released ? 'secondary' : 'primary'}
                              onClick={() => setConfirming(status)}
                              disabled={hasPendingEntryWork}
                              title={
                                hasPendingEntryWork
                                  ? 'Release is disabled while this cycle has unsaved, saving, retrying, or conflicted Payroll Entry rows'
                                  : undefined
                              }
                            >
                              {status.released ? 'Release Remaining' : 'Release'}
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

      {blockedResult && (
        <BlockedEmployeesModal
          unitName={blockedResult.unitName}
          entries={blockedResult.entries}
          onOpenChange={(open) => !open && setBlockedResult(undefined)}
        />
      )}

      {cycle && (
        <ReleaseAllConfirmModal
          open={confirmingReleaseAll}
          onOpenChange={(open) => !releaseAll.isPending && setConfirmingReleaseAll(open)}
          scopeLabel={releaseAllScopeLabel}
          cycleLabel={cycleLabel}
          onConfirm={handleConfirmReleaseAll}
          isPending={releaseAll.isPending}
        />
      )}

      {releaseAllResult && (
        <ReleaseAllSummaryModal result={releaseAllResult} onOpenChange={(open) => !open && setReleaseAllResult(undefined)} />
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
