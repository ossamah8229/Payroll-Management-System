import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import {
  canAccessCorrections,
  canReviewCorrectionRequests,
  canViewOwnCorrectionRequests,
  defaultCorrectionsTab,
  type CorrectionsTab,
} from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { FilterField } from '@/components/ui/filter-field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useCorrectionRequests, type CorrectionRequest } from '@/hooks/use-correction-requests';
import { useBalanceAdjustments, type BalanceAdjustment } from '@/hooks/use-balance-adjustments';
import {
  balanceAdjustmentStatusTone,
  balanceAdjustmentTypeLabel,
  balanceAdjustmentTypeTone,
  correctionFieldLabel,
  correctionRequestStatusTone,
  cyclePeriodLabel,
} from '@/components/corrections/correction-labels';

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-1 pb-2.5 text-xs font-medium transition-colors',
        active ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function matchesSearch(name: string, code: string | null, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle) || (code ?? '').toLowerCase().includes(needle);
}

// --- Review Queue --------------------------------------------------------------------------

function ReviewQueueTab({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  // Scoped to this user's own accessible sites (System-Wide RBAC Consistency remediation) —
  // Corrections stays a strictly site-scoped operational domain; holding sites:manage does not
  // widen it.
  const sites = useAccessibleProjectSites(user);
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const requests = useCorrectionRequests(status ? { status } : {});

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  const rows = useMemo(() => {
    const list = requests.data ?? [];
    return list.filter((request) => {
      if (selectedSiteIds.length > 0 && !selectedSiteIds.includes(request.payrollEntry.siteId)) return false;
      if (!matchesSearch(request.payrollEntry.employee.name, request.payrollEntry.employee.employeeCode, search)) return false;
      return true;
    });
  }, [requests.data, selectedSiteIds, search]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <FilterField id="queue-status-filter" label="Status">
          <select
            id="queue-status-filter"
            className={selectClassName}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All statuses</option>
          </select>
        </FilterField>
        <MultiSelectFilter
          id="queue-site-filter"
          label="Site"
          options={siteOptions}
          selectedIds={selectedSiteIds}
          onChange={setSelectedSiteIds}
        />
        <FilterField id="queue-search" label="Employee">
          <Input
            id="queue-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code…"
            className="w-56"
          />
        </FilterField>
      </div>

      {requests.isLoading && (
        <div className="flex flex-col gap-2 p-[18px]">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!requests.isLoading && requests.error && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-xs font-medium text-danger">Could not load the Review Queue</p>
          <p className="text-xs text-text-muted">
            {requests.error instanceof ApiError ? requests.error.message : 'Something went wrong'}
          </p>
        </div>
      )}

      {!requests.isLoading && !requests.error && rows.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-xs font-medium text-text">No correction requests match this filter</p>
          <p className="text-xs text-text-muted">Adjust the filters, or check back once a request is submitted.</p>
        </div>
      )}

      {!requests.isLoading && !requests.error && rows.length > 0 && (
        <div className="print-flow overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Employee</TableHead>
                <TableHead className="whitespace-nowrap">Code</TableHead>
                <TableHead className="whitespace-nowrap">Payroll Period</TableHead>
                <TableHead className="whitespace-nowrap">Field</TableHead>
                <TableHead className="whitespace-nowrap">Proposed Value</TableHead>
                <TableHead className="whitespace-nowrap">Submitted By</TableHead>
                <TableHead className="whitespace-nowrap">Submitted At</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((request: CorrectionRequest) => (
                <TableRow
                  key={request.id}
                  className="cursor-pointer hover:bg-bg"
                  onClick={() => navigate(`/corrections/requests/${request.id}`)}
                >
                  <TableCell className="whitespace-nowrap font-medium">{request.payrollEntry.employee.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{request.payrollEntry.employee.employeeCode ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{cyclePeriodLabel(request.payrollEntry.cycle)}</TableCell>
                  <TableCell className="whitespace-nowrap">{correctionFieldLabel(request.field)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{request.proposedNewValue}</TableCell>
                  <TableCell className="whitespace-nowrap">{request.requestedBy.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{new Date(request.requestedAt).toLocaleString()}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge tone={correctionRequestStatusTone(request.status)}>{request.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

// --- My Requests -----------------------------------------------------------------------------

/**
 * A submitter's own tracking view (Presentation & Workflow Stabilization Checkpoint, 2026-07-25,
 * Issues 3/4) — everything a Payroll Manager needs to monitor a request they submitted (status,
 * submission date, submitted values, eventual approval/rejection) without holding
 * `corrections:approve`. Reads the exact same `useCorrectionRequests` source of truth as
 * `ReviewQueueTab` (no duplicate data source, per the brief) — the backend itself narrows the
 * result to "requests I submitted" for any caller who lacks `corrections:approve`
 * (`listCorrectionRequestsForUser`, `corrections.service.ts`), so this component never needs its
 * own client-side "is this mine?" filter.
 */
function MyCorrectionRequestsTab({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const sites = useAccessibleProjectSites(user);
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const requests = useCorrectionRequests(status ? { status } : {});

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  const rows = useMemo(() => {
    const list = requests.data ?? [];
    return list.filter((request) => {
      if (selectedSiteIds.length > 0 && !selectedSiteIds.includes(request.payrollEntry.siteId)) return false;
      if (!matchesSearch(request.payrollEntry.employee.name, request.payrollEntry.employee.employeeCode, search)) return false;
      return true;
    });
  }, [requests.data, selectedSiteIds, search]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <FilterField id="mine-status-filter" label="Status">
          <select
            id="mine-status-filter"
            className={selectClassName}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </FilterField>
        <MultiSelectFilter
          id="mine-site-filter"
          label="Site"
          options={siteOptions}
          selectedIds={selectedSiteIds}
          onChange={setSelectedSiteIds}
        />
        <FilterField id="mine-search" label="Employee">
          <Input
            id="mine-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code…"
            className="w-56"
          />
        </FilterField>
      </div>

      {requests.isLoading && (
        <div className="flex flex-col gap-2 p-[18px]">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!requests.isLoading && requests.error && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-xs font-medium text-danger">Could not load your correction requests</p>
          <p className="text-xs text-text-muted">
            {requests.error instanceof ApiError ? requests.error.message : 'Something went wrong'}
          </p>
        </div>
      )}

      {!requests.isLoading && !requests.error && rows.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-xs font-medium text-text">You haven't submitted any correction requests yet</p>
          <p className="text-xs text-text-muted">
            Requests you submit from a released Payroll Entry will appear here.
          </p>
        </div>
      )}

      {!requests.isLoading && !requests.error && rows.length > 0 && (
        <div className="print-flow overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Employee</TableHead>
                <TableHead className="whitespace-nowrap">Code</TableHead>
                <TableHead className="whitespace-nowrap">Payroll Period</TableHead>
                <TableHead className="whitespace-nowrap">Field</TableHead>
                <TableHead className="whitespace-nowrap">Proposed Value</TableHead>
                <TableHead className="whitespace-nowrap">Submitted At</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((request: CorrectionRequest) => (
                <TableRow
                  key={request.id}
                  className="cursor-pointer hover:bg-bg"
                  onClick={() => navigate(`/corrections/requests/${request.id}`)}
                >
                  <TableCell className="whitespace-nowrap font-medium">{request.payrollEntry.employee.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{request.payrollEntry.employee.employeeCode ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{cyclePeriodLabel(request.payrollEntry.cycle)}</TableCell>
                  <TableCell className="whitespace-nowrap">{correctionFieldLabel(request.field)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{request.proposedNewValue}</TableCell>
                  <TableCell className="whitespace-nowrap">{new Date(request.requestedAt).toLocaleString()}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge tone={correctionRequestStatusTone(request.status)}>
                      {request.status === 'PENDING' ? 'Awaiting Approval' : request.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

// --- Corrections Ledger ----------------------------------------------------------------------

function CorrectionsLedgerTab({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  // Scoped to this user's own accessible sites (System-Wide RBAC Consistency remediation) —
  // Corrections stays a strictly site-scoped operational domain; holding sites:manage does not
  // widen it.
  const sites = useAccessibleProjectSites(user);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'SETTLED' | ''>('');
  const [typeFilter, setTypeFilter] = useState<'PAYABLE' | 'RECOVERY' | ''>('');
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const adjustments = useBalanceAdjustments({
    status: statusFilter || undefined,
    type: typeFilter || undefined,
  });

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  const rows = useMemo(() => {
    const list = adjustments.data ?? [];
    return list.filter((row) => {
      if (selectedSiteIds.length > 0 && !selectedSiteIds.includes(row.employee.siteId)) return false;
      if (!matchesSearch(row.employee.name, row.employee.employeeCode, search)) return false;
      return true;
    });
  }, [adjustments.data, selectedSiteIds, search]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <FilterField id="ledger-status-filter" label="Status">
          <select
            id="ledger-status-filter"
            className={selectClassName}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SETTLED">Settled</option>
          </select>
        </FilterField>
        <FilterField id="ledger-type-filter" label="Type">
          <select
            id="ledger-type-filter"
            className={selectClassName}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          >
            <option value="">All types</option>
            <option value="PAYABLE">Payable</option>
            <option value="RECOVERY">Recovery</option>
          </select>
        </FilterField>
        <MultiSelectFilter
          id="ledger-site-filter"
          label="Site"
          options={siteOptions}
          selectedIds={selectedSiteIds}
          onChange={setSelectedSiteIds}
        />
        <FilterField id="ledger-search" label="Employee">
          <Input
            id="ledger-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code…"
            className="w-56"
          />
        </FilterField>
      </div>

      {adjustments.isLoading && (
        <div className="flex flex-col gap-2 p-[18px]">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!adjustments.isLoading && adjustments.error && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-xs font-medium text-danger">Could not load the Corrections Ledger</p>
          <p className="text-xs text-text-muted">
            {adjustments.error instanceof ApiError ? adjustments.error.message : 'Something went wrong'}
          </p>
        </div>
      )}

      {!adjustments.isLoading && !adjustments.error && rows.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-xs font-medium text-text">No Balance Adjustments match this filter</p>
          <p className="text-xs text-text-muted">Every approved correction that carries a balance will appear here.</p>
        </div>
      )}

      {!adjustments.isLoading && !adjustments.error && rows.length > 0 && (
        <div className="print-flow overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Employee</TableHead>
                <TableHead className="whitespace-nowrap">Code</TableHead>
                <TableHead className="whitespace-nowrap">Adjustment Type</TableHead>
                <TableHead className="whitespace-nowrap">Type</TableHead>
                <TableHead className="whitespace-nowrap text-right">Original Amount</TableHead>
                <TableHead className="whitespace-nowrap text-right">Remaining</TableHead>
                <TableHead className="whitespace-nowrap">Source Cycle</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row: BalanceAdjustment) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-bg"
                  onClick={() => navigate(`/corrections/ledger/${row.id}`)}
                >
                  <TableCell className="whitespace-nowrap font-medium">{row.employee.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.employee.employeeCode ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.adjustmentType.label}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge tone={balanceAdjustmentTypeTone(row.type)}>{balanceAdjustmentTypeLabel(row.type)}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(row.remainingAmount)}</TableCell>
                  <TableCell className="whitespace-nowrap">{cyclePeriodLabel(row.sourceCycle)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge tone={balanceAdjustmentStatusTone(row.status)}>{row.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

/**
 * The Corrections operational hub (Phase 6 Checkpoint 6; "My Requests" added Presentation &
 * Workflow Stabilization Checkpoint, 2026-07-25) — three tabs: the Review Queue
 * (`corrections:approve` only — the backend's `GET /correction-requests` itself is gated to admit
 * either that or `payroll:entry`, but a non-approver's query is scoped server-side to their own
 * requests, so this tab specifically is still hidden rather than shown with a misleadingly narrow
 * result set), My Requests (`payroll:entry` — a submitter's own requests, whatever their status;
 * see `canViewOwnCorrectionRequests`), and the Corrections Ledger (either permission, matching
 * `GET /balance-adjustments`'s own `BALANCE_VIEW_PERMISSIONS`). "Request Correction" is
 * deliberately not its own tab here — it opens from an eligible Payroll Entry view instead, per
 * the brief's own information architecture; submitting one now returns here (My Requests) rather
 * than to a Review-Queue-only detail page a submitter may not be able to open.
 */
export function CorrectionsPage({ user }: { user: SessionUser }) {
  const canApprove = canReviewCorrectionRequests(user);
  const canViewOwn = canViewOwnCorrectionRequests(user);
  const canView = canAccessCorrections(user);
  const [tab, setTab] = useState<CorrectionsTab>(defaultCorrectionsTab(user) ?? 'ledger');

  if (!canView) {
    return (
      <AppShell user={user} title="Corrections" subtitle="Review Queue and Corrections Ledger">
        <div className="flex flex-col items-center gap-1 py-14 text-center">
          <p className="text-xs font-medium text-text">You do not have access to Corrections</p>
          <p className="text-xs text-text-muted">Ask a Master User for the corrections:approve or payroll:entry permission.</p>
        </div>
      </AppShell>
    );
  }

  const tabTitle = tab === 'queue' ? 'Review Queue' : tab === 'mine' ? 'My Requests' : 'Ledger';

  return (
    <AppShell user={user} title="Corrections" subtitle="Review Queue and Corrections Ledger">
      <Card>
        <CardHeader className="flex-col items-start gap-3 border-b-0 pb-0">
          <div className="flex w-full items-center justify-between">
            <CardTitle>Corrections</CardTitle>
            <div className="print:hidden">
              {/* Up to 8 columns per tab, several holding longer text (Submitted By/At) —
                  Landscape is the deliberate default (final verification pass), not a silently
                  inherited Portrait. */}
              <PrintButton recommendedOrientation="landscape" />
            </div>
          </div>
          <div className="flex gap-6 print:hidden">
            {canApprove && (
              <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>
                Review Queue
              </TabButton>
            )}
            {canViewOwn && (
              <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
                My Requests
              </TabButton>
            )}
            <TabButton active={tab === 'ledger'} onClick={() => setTab('ledger')}>
              Corrections Ledger
            </TabButton>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 border-t border-border">
          <PrintContextHeader title={`Corrections — ${tabTitle}`} />
          {tab === 'queue' && canApprove && <ReviewQueueTab user={user} />}
          {tab === 'mine' && canViewOwn && <MyCorrectionRequestsTab user={user} />}
          {tab === 'ledger' && <CorrectionsLedgerTab user={user} />}
        </CardContent>
      </Card>
    </AppShell>
  );
}
