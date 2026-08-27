import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { formatMoney, isOutstandingWaived, toIsoDateOnly } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { FilterField } from '@/components/ui/filter-field';
import { EmployeeLookup } from '@/components/ui/employee-lookup';
import { ReportPagination } from '@/components/reports/report-pagination';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useCurrentPayrollCycle } from '@/hooks/use-payroll-cycles';
import { apiRequest } from '@/lib/api-client';
import {
  ADVANCES_PAGE_SIZE,
  type Advance,
  useAdvances,
  useCancelAdvance,
  useCreateAdvance,
  useDeferAdvanceSchedule,
  useUpdateAdvance,
} from '@/hooks/use-advances';

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

function typeLabel(type: string): string {
  return type === 'LOAN' ? 'Advance' : 'Eid Advance';
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatYearMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function periodLabel(period: Advance['currentScheduledPeriod']): string {
  if (!period) return '—';
  return formatYearMonth(period.year, period.month);
}

function statusTone(status: Advance['status']): 'green' | 'gray' | 'red' | 'amber' {
  if (status === 'ACTIVE') return 'green';
  if (status === 'CANCELLED') return 'red';
  // amber = "pending" (docs/design-system.md §3) — RESERVED is exactly that: the deduction is
  // fully staged against the current Draft payroll, but not yet confirmed by an actual Release.
  if (status === 'RESERVED') return 'amber';
  return 'gray';
}

function statusLabel(status: Advance['status']): string {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'CANCELLED') return 'Cancelled';
  if (status === 'RESERVED') return 'Reserved (pending release)';
  return 'Paid Off';
}

function RecordAdvanceModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { cycle } = useCurrentPayrollCycle();
  const createAdvance = useCreateAdvance();

  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<'LOAN' | 'EID_ADVANCE'>('LOAN');
  const [totalAmount, setTotalAmount] = useState('');
  const [dateGiven, setDateGiven] = useState(() => toIsoDateOnly(new Date()));
  const [repaymentType, setRepaymentType] = useState<'FULL_DEDUCTION' | 'INSTALLMENT'>('FULL_DEDUCTION');
  const [scheduledInstallmentAmount, setScheduledInstallmentAmount] = useState('');
  const [notes, setNotes] = useState('');
  // The deduction start cycle now defaults to, and stays pinned to, the current Draft cycle unless
  // the user explicitly opts into "Future Cycle" (Section D's frozen business rule: "Earliest
  // deduction cycle = current Draft payroll cycle... If the business wants to delay deduction until
  // the next cycle, that must be an explicit user choice"). Raw, unconstrained year/month number
  // inputs only appear once that explicit choice is made — there is no way to land on an
  // arbitrary/past period by accident.
  const [scheduleMode, setScheduleMode] = useState<'CURRENT_DRAFT' | 'FUTURE'>('CURRENT_DRAFT');
  const today = new Date();
  const floorYear = cycle?.year ?? today.getFullYear();
  const floorMonth = cycle?.month ?? today.getMonth() + 1;
  const [futureYear, setFutureYear] = useState(floorMonth === 12 ? floorYear + 1 : floorYear);
  const [futureMonthNum, setFutureMonthNum] = useState(floorMonth === 12 ? 1 : floorMonth + 1);

  useEffect(() => {
    if (open) {
      setScheduleMode(cycle ? 'CURRENT_DRAFT' : 'FUTURE');
      const nextYear = (cycle?.year ?? today.getFullYear()) + ((cycle?.month ?? today.getMonth() + 1) === 12 ? 1 : 0);
      const nextMonth = (cycle?.month ?? today.getMonth() + 1) === 12 ? 1 : (cycle?.month ?? today.getMonth() + 1) + 1;
      setFutureYear(nextYear);
      setFutureMonthNum(nextMonth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycle?.id]);

  useEffect(() => {
    if (!open) {
      setEmployeeId('');
      setType('LOAN');
      setTotalAmount('');
      setDateGiven(toIsoDateOnly(new Date()));
      setRepaymentType('FULL_DEDUCTION');
      setScheduledInstallmentAmount('');
      setNotes('');
    }
  }, [open]);

  const originalYear = scheduleMode === 'CURRENT_DRAFT' ? floorYear : futureYear;
  const originalMonth = scheduleMode === 'CURRENT_DRAFT' ? floorMonth : futureMonthNum;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId || !totalAmount) {
      toast.error('An employee and amount are required');
      return;
    }
    try {
      await createAdvance.mutateAsync({
        employeeId,
        type,
        totalAmount,
        dateGiven,
        repaymentType,
        scheduledInstallmentAmount: repaymentType === 'INSTALLMENT' && scheduledInstallmentAmount ? scheduledInstallmentAmount : null,
        notes: notes || null,
        originalPeriod: { year: originalYear, month: originalMonth },
      });
      toast.success('Advance recorded');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to record advance');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !createAdvance.isPending && onOpenChange(next)}>
      <ModalContent title="Record Advance" widthClassName="max-w-[560px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="advance-employee">Employee</Label>
            <EmployeeLookup
              id="advance-employee"
              value={employeeId}
              onChange={(id) => setEmployeeId(id)}
              activeOnly
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-type">Type</Label>
              <select
                id="advance-type"
                className={selectClassName}
                value={type}
                onChange={(e) => setType(e.target.value as 'LOAN' | 'EID_ADVANCE')}
              >
                <option value="LOAN">Advance</option>
                <option value="EID_ADVANCE">Eid Advance</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-total">Total Amount</Label>
              <Input
                id="advance-total"
                inputMode="decimal"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="e.g. 15000"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-date-given">Date Given</Label>
              <DateInput id="advance-date-given" value={dateGiven} onChange={setDateGiven} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-repayment-type">Repayment Type</Label>
              <select
                id="advance-repayment-type"
                className={selectClassName}
                value={repaymentType}
                onChange={(e) => setRepaymentType(e.target.value as 'FULL_DEDUCTION' | 'INSTALLMENT')}
              >
                <option value="FULL_DEDUCTION">Full Deduction</option>
                <option value="INSTALLMENT">Installment</option>
              </select>
            </div>
          </div>

          {repaymentType === 'INSTALLMENT' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-installment-amount">
                Scheduled Installment Amount (optional — leave blank to enter each cycle manually)
              </Label>
              <Input
                id="advance-installment-amount"
                inputMode="decimal"
                value={scheduledInstallmentAmount}
                onChange={(e) => setScheduledInstallmentAmount(e.target.value)}
                placeholder="e.g. 3000"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>First Deduction Cycle</Label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!cycle}
                onClick={() => setScheduleMode('CURRENT_DRAFT')}
                className={`h-9 flex-1 rounded border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${scheduleMode === 'CURRENT_DRAFT' ? 'border-accent-mid bg-accent-light text-accent' : 'border-border bg-surface text-text-muted hover:text-text'}`}
              >
                {cycle ? `Current Draft — ${formatYearMonth(cycle.year, cycle.month)}` : 'No Draft cycle open'}
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('FUTURE')}
                className={`h-9 flex-1 rounded border px-3 text-xs font-medium transition-colors ${scheduleMode === 'FUTURE' ? 'border-accent-mid bg-accent-light text-accent' : 'border-border bg-surface text-text-muted hover:text-text'}`}
              >
                Future Cycle
              </button>
            </div>
            {!cycle && (
              <p className="text-[11px] text-text-muted">
                No payroll cycle is currently open — choose the payroll period this deduction should
                first target. It cannot be earlier than {formatYearMonth(floorYear, floorMonth)}.
              </p>
            )}
            {scheduleMode === 'FUTURE' && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="advance-original-year">Year</Label>
                  <Input
                    id="advance-original-year"
                    type="number"
                    value={futureYear}
                    onChange={(e) => setFutureYear(Number(e.target.value))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="advance-original-month">Month</Label>
                  <Input
                    id="advance-original-month"
                    type="number"
                    min={1}
                    max={12}
                    value={futureMonthNum}
                    onChange={(e) => setFutureMonthNum(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="advance-notes">Notes</Label>
            <Input id="advance-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <p className="text-[11px] text-text-muted">
            Sites shown are unfiltered — every active employee is selectable if you hold unrestricted
            access; otherwise only employees at your assigned sites appear.
          </p>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={createAdvance.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createAdvance.isPending}>
              {createAdvance.isPending ? 'Recording…' : 'Record Advance'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

/**
 * Edit — narrowed to exactly three user-editable fields by explicit business decision (v1.0.2
 * Advance Edit/Cancel Final Product Semantics checkpoint, 2026-08-25): Advance Amount, Advance
 * Date, Notes. Nothing more — see `advances.service.ts`'s `updateAdvance` doc comment for the full
 * matrix this mirrors, and `updateAdvanceSchema` for why `repaymentType`/`scheduledInstallmentAmount`
 * (editable in the prior, 2026-07-24 shape) are now fixed at creation instead. Employee and
 * Advance/Eid Advance type are never offered here at all.
 *
 * `notes` and `dateGiven` are always editable, at every lifecycle stage, including PAID_OFF/
 * CANCELLED — neither carries any ledger consequence (`dateGiven` is purely descriptive/reporting,
 * traced this checkpoint to have zero coupling with payroll-cycle placement or release). Only
 * `totalAmount` is gated to `status === 'ACTIVE'` *or* `'RESERVED'` (the backend independently
 * enforces this — the UI just avoids offering an edit that would only bounce back as a 400) — a
 * RESERVED Advance still has a live, reversible Draft deduction, and the backend atomically
 * reverses and re-materializes it under the edited amount in the same transaction, so Finance can
 * correct a mis-entered amount without cancelling and re-recording it. The deduction start cycle is
 * deliberately not offered here at all — see the same doc comment for why (Cancel + re-record
 * before materialization, Defer after).
 */
function EditAdvanceModal({
  advance,
  onOpenChange,
}: {
  advance: Advance | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const updateAdvance = useUpdateAdvance();
  const [totalAmount, setTotalAmount] = useState('');
  const [dateGiven, setDateGiven] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (advance) {
      setTotalAmount(advance.totalAmount);
      setDateGiven(advance.dateGiven.slice(0, 10));
      setNotes(advance.notes ?? '');
    }
  }, [advance]);

  const isAmountEditable = advance?.status === 'ACTIVE' || advance?.status === 'RESERVED';
  const isReserved = advance?.status === 'RESERVED';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!advance) return;
    try {
      await updateAdvance.mutateAsync({
        id: advance.id,
        input: {
          ...(isAmountEditable && { totalAmount }),
          dateGiven,
          notes: notes || null,
        },
      });
      toast.success('Advance updated');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update advance');
    }
  }

  return (
    <Modal open={Boolean(advance)} onOpenChange={(next) => !updateAdvance.isPending && onOpenChange(next)}>
      {advance && (
        <ModalContent title={`Edit ${typeLabel(advance.type)} — ${advance.employee.name}`} widthClassName="max-w-[480px]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            {!isAmountEditable && (
              <p className="rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                This Advance is {advance.status === 'PAID_OFF' ? 'fully paid off' : 'cancelled'} — its amount can no
                longer be changed, but the date and notes can still be corrected.
              </p>
            )}
            {isReserved && (
              <p className="rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted">
                This Advance is reserved against the current Draft payroll (not yet released). Changing the amount
                will automatically recalculate that Draft deduction to match — the current payroll figures below will
                update once saved.
              </p>
            )}
            {isAmountEditable && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-advance-total">Advance Amount</Label>
                <Input
                  id="edit-advance-total"
                  inputMode="decimal"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                />
                {/* No client-side "already repaid" floor hint (v1.0.2 checkpoint, 2026-08-25):
                 * `totalAmount - outstandingBalance` conflates a still-reversible Draft
                 * reservation with actual RELEASED repayment — a RESERVED Advance's own
                 * outstandingBalance is always 0 (that's what RESERVED means), so this would
                 * always claim the full amount is "already repaid" even though nothing has
                 * actually released yet, and the backend would still allow reducing well below
                 * it. Only the backend knows the true released-only floor (it reverses any live
                 * Draft deduction before computing it); its own accurate error surfaces via the
                 * existing catch block below if a reduction genuinely goes too far. */}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-advance-date-given">Advance Date</Label>
              <DateInput id="edit-advance-date-given" value={dateGiven} onChange={setDateGiven} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-advance-notes">Notes</Label>
              <Input id="edit-advance-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={updateAdvance.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateAdvance.isPending}>
                {updateAdvance.isPending ? 'Saving…' : 'Save'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      )}
    </Modal>
  );
}

/** The non-destructive correction for a mistakenly-recorded Advance (Section G) — a status
 * transition (`CANCELLED`), never a delete; this schema has no delete path for `Advance` at all
 * (see `advances.service.ts`'s `cancelAdvance` doc comment). Works identically whether or not any
 * deduction has yet materialized — the backend reverses a still-Draft deduction first if one exists,
 * and never touches released history either way. */
function CancelAdvanceModal({
  advance,
  onOpenChange,
}: {
  advance: Advance | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const cancelAdvance = useCancelAdvance();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!advance) setReason('');
  }, [advance]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!advance) return;
    try {
      await cancelAdvance.mutateAsync({ id: advance.id, input: { reason } });
      toast.success('Advance cancelled');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to cancel advance');
    }
  }

  return (
    <Modal open={Boolean(advance)} onOpenChange={(next) => !cancelAdvance.isPending && onOpenChange(next)}>
      {advance && (
        <ModalContent title={`Cancel ${typeLabel(advance.type)} — ${advance.employee.name}`} widthClassName="max-w-[480px]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <p className="text-xs text-text-muted">
              Cancelling this Advance stops all further recovery — any remaining balance is waived, not
              still owed. Any unreleased Draft payroll deduction will be reversed automatically. Amounts
              already recovered through released payroll remain part of history and are never modified.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cancel-advance-reason">Reason</Label>
              <Input id="cancel-advance-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={cancelAdvance.isPending}>
                Back
              </Button>
              <Button
                type="submit"
                className="bg-danger hover:brightness-110"
                disabled={cancelAdvance.isPending || !reason.trim()}
              >
                {cancelAdvance.isPending ? 'Cancelling…' : 'Confirm Cancel'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      )}
    </Modal>
  );
}

/** Looks up the current Draft cycle's own entry for this advance's employee, so the operator never
 * has to know a raw entry id — deferral only ever targets a deduction already materialized into a
 * still-Draft entry (see the backend's own doc comment, advances.service.ts). */
function DeferAdvanceModal({
  advance,
  onOpenChange,
}: {
  advance: Advance | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { cycle } = useCurrentPayrollCycle();
  const deferAdvance = useDeferAdvanceSchedule();
  const [lookup, setLookup] = useState<{ status: 'idle' | 'loading' | 'found' | 'not-found'; entryId?: string; amount?: string }>({
    status: 'idle',
  });
  const [toYear, setToYear] = useState(0);
  const [toMonth, setToMonth] = useState(1);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!advance || !cycle) {
      setLookup({ status: 'idle' });
      return;
    }
    setLookup({ status: 'loading' });
    setToYear(cycle.month === 12 ? cycle.year + 1 : cycle.year);
    setToMonth(cycle.month === 12 ? 1 : cycle.month + 1);
    apiRequest<{ entries: { id: string; advanceId: string | null; eidAdvanceId: string | null; advanceDeduction: string; eidAdvanceDeduction: string }[] }>(
      `/api/v1/payroll-cycles/${cycle.id}/entries?employeeId=${advance.employeeId}`,
    )
      .then((res) => {
        const entry = res.entries[0];
        const isLoan = advance.type === 'LOAN';
        const linkedId = entry ? (isLoan ? entry.advanceId : entry.eidAdvanceId) : null;
        if (entry && linkedId === advance.id) {
          setLookup({ status: 'found', entryId: entry.id, amount: isLoan ? entry.advanceDeduction : entry.eidAdvanceDeduction });
        } else {
          setLookup({ status: 'not-found' });
        }
      })
      .catch(() => setLookup({ status: 'not-found' }));
  }, [advance, cycle]);

  useEffect(() => {
    if (!advance) setReason('');
  }, [advance]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!advance || lookup.status !== 'found' || !lookup.entryId) return;
    try {
      await deferAdvance.mutateAsync({
        id: advance.id,
        input: { payrollEntryId: lookup.entryId, toPeriod: { year: toYear, month: toMonth }, reason },
      });
      toast.success('Deduction deferred');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to defer');
    }
  }

  return (
    <Modal open={Boolean(advance)} onOpenChange={(next) => !deferAdvance.isPending && onOpenChange(next)}>
      {advance && (
        <ModalContent title={`Defer ${typeLabel(advance.type)} — ${advance.employee.name}`} widthClassName="max-w-[480px]">
          {lookup.status === 'loading' && <Skeleton className="h-20 w-full" />}
          {lookup.status === 'not-found' && (
            <p className="text-xs text-text-muted">
              No currently materialized deduction was found for this employee in the active Draft
              cycle — deferral only applies to a deduction that has already landed in a still-Draft
              Payroll Entry.
            </p>
          )}
          {lookup.status === 'found' && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <p className="text-xs text-text-muted">
                Currently deducting <span className="font-medium text-text">{formatMoney(lookup.amount)}</span> in{' '}
                {cycle ? `${cycle.month}/${cycle.year}` : 'the current cycle'}.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="defer-to-year">Target Year</Label>
                  <Input id="defer-to-year" type="number" value={toYear} onChange={(e) => setToYear(Number(e.target.value))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="defer-to-month">Target Month</Label>
                  <Input
                    id="defer-to-month"
                    type="number"
                    min={1}
                    max={12}
                    value={toMonth}
                    onChange={(e) => setToMonth(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="defer-reason">Reason</Label>
                <Input id="defer-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
              </div>
              <ModalFooter>
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={deferAdvance.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={deferAdvance.isPending || !reason.trim()}>
                  {deferAdvance.isPending ? 'Deferring…' : 'Defer'}
                </Button>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      )}
    </Modal>
  );
}

export function AdvancesPage({ user }: { user: SessionUser }) {
  // Scoped to this user's own accessible sites (System-Wide RBAC Consistency remediation) —
  // Advances stays a strictly site-scoped operational domain; holding sites:manage does not widen it.
  const sites = useAccessibleProjectSites(user);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  // v1.0.4 Advances Scalability checkpoint — server-side pagination (25/page, newest first). The
  // default status filter stays "All" (empty), matching this page's own pre-existing default —
  // Cancelled/Paid Off history was already reachable without any filter change before this
  // checkpoint, and Part A's own audit found no existing expectation to disturb by narrowing it.
  const [page, setPage] = useState(1);

  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [editingAdvance, setEditingAdvance] = useState<Advance | undefined>(undefined);
  const [deferringAdvance, setDeferringAdvance] = useState<Advance | undefined>(undefined);
  const [cancellingAdvance, setCancellingAdvance] = useState<Advance | undefined>(undefined);

  // A filter change invalidates whichever page was previously being viewed — never silently keep
  // showing "page 3" of a now-different filtered result (mirrors the Advance Recovery Report page's
  // own identical page-reset effect).
  const selectedSiteIdsKey = selectedSiteIds.join(',');
  useEffect(() => {
    setPage(1);
  }, [selectedSiteIdsKey, typeFilter, statusFilter]);

  const advances = useAdvances({
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    type: (typeFilter || undefined) as 'LOAN' | 'EID_ADVANCE' | undefined,
    status: (statusFilter || undefined) as 'ACTIVE' | 'RESERVED' | 'PAID_OFF' | 'CANCELLED' | undefined,
    page,
    pageSize: ADVANCES_PAGE_SIZE,
  });

  // Narrow safeguard, independent of the filter-change page-reset effect above: clamp down to the
  // new last valid page if the backend total for the currently requested page shrinks (e.g. the
  // last Advance on the last page gets cancelled by someone else and no longer matches a status
  // filter — an edge case, but one that must never leave the page requesting rows past the end).
  useEffect(() => {
    if (!advances.data) return;
    const lastValidPage = Math.max(1, Math.ceil(advances.data.total / advances.data.pageSize));
    if (page > 1 && page > lastValidPage) {
      setPage(lastValidPage);
    }
  }, [advances.data, page]);

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  const rows = advances.data?.advances ?? [];

  return (
    <AppShell user={user} title="Advances" subtitle="Record and track Advance / Eid Advance balances">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2.5">
            <CardTitle>Advances</CardTitle>
            <div className="print:hidden">
              {/* 7 printable columns (Actions excluded) of mostly financial figures — Landscape
                  is the deliberate default (final verification pass), not a silently inherited
                  Portrait. */}
              <PrintButton recommendedOrientation="landscape" />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <MultiSelectFilter
              id="advances-site-filter"
              label="Site"
              options={siteOptions}
              selectedIds={selectedSiteIds}
              onChange={setSelectedSiteIds}
            />
            <FilterField id="advances-type-filter" label="Type">
              <select
                id="advances-type-filter"
                className={selectClassName}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All types</option>
                <option value="LOAN">Advance</option>
                <option value="EID_ADVANCE">Eid Advance</option>
              </select>
            </FilterField>
            <FilterField id="advances-status-filter" label="Status">
              <select
                id="advances-status-filter"
                className={selectClassName}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="RESERVED">Reserved (pending release)</option>
                <option value="PAID_OFF">Paid Off</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </FilterField>
            <div className="ml-auto">
              <Button onClick={() => setIsRecordOpen(true)}>
                Record Advance
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="px-[18px] pt-[18px]">
            <PrintContextHeader title="Advances" />
          </div>
          {advances.isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!advances.isLoading && advances.error && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load Advances</p>
              <p className="text-xs text-text-muted">
                {advances.error instanceof ApiError ? advances.error.message : 'Something went wrong'}
              </p>
            </div>
          )}

          {!advances.isLoading && !advances.error && rows.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No Advances recorded yet</p>
              <p className="text-xs text-text-muted">Use "Record Advance" to add one.</p>
            </div>
          )}

          {!advances.isLoading && !advances.error && rows.length > 0 && (
            <div className="print-flow overflow-x-auto">
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    {/* Employee Identity Visibility (v1.0.1 Checkpoint 1, 2026-08-25) — Code/Father
                        Name/CNIC join the pre-existing Employee column so two same-named employees
                        (e.g. two "Muhammad Talha"s) are distinguishable directly in this operational
                        grid, without opening Employee Registry. All three are already present on
                        every loaded row (`advance.employee`, `advances.service.ts`'s existing
                        `include: { employee: true, ... }`) — no backend change. This table has no
                        sticky-column mechanism today; introducing one purely for this patch was
                        judged out of scope (see this checkpoint's own record in
                        docs/PROJECT_PROGRESS.md), so the identity block is in normal grid flow. */}
                    <TableHead className="whitespace-nowrap">Code</TableHead>
                    <TableHead className="whitespace-nowrap">Employee</TableHead>
                    <TableHead className="whitespace-nowrap">Father Name</TableHead>
                    <TableHead className="whitespace-nowrap">CNIC</TableHead>
                    {/* Deputation Visibility (v1.0.4 checkpoint) — Site/Unit join the identity block
                        so two same-named employees deputed to different sites/units are
                        distinguishable directly here, and staff can see where an employee is
                        currently deputed without opening Employee Registry. Already present on
                        every loaded row (`advance.employee.site`/`.unit`,
                        `advances.service.ts`'s `advanceListInclude` — a single joined query, no
                        N+1). */}
                    <TableHead className="whitespace-nowrap">Site</TableHead>
                    <TableHead className="whitespace-nowrap">Unit</TableHead>
                    <TableHead className="whitespace-nowrap">Type</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Total Amount</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Outstanding Balance</TableHead>
                    <TableHead className="whitespace-nowrap">Repayment Type</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="whitespace-nowrap">Scheduled Period</TableHead>
                    {/* Row actions are screen-only (Professional Printing checkpoint, final
                        verification pass) — the body cell below was already print:hidden, but
                        this header cell wasn't, leaving a stray "Actions" column label over an
                        empty printed column. */}
                    <TableHead className="whitespace-nowrap print:hidden">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((advance) => (
                    <TableRow key={advance.id}>
                      <TableCell className="whitespace-nowrap text-text-muted">{advance.employee.employeeCode ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{advance.employee.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{advance.employee.fatherName ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{advance.employee.cnic ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{advance.employee.site.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{advance.employee.unit.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{typeLabel(advance.type)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(advance.totalAmount)}</TableCell>
                      {/* Cancel Business Semantics (v1.0.4 checkpoint) — a Cancelled Advance's
                          remaining balance is waived, never still owed; `isOutstandingWaived` masks
                          it to 0.00 here without touching the underlying stored `outstandingBalance`
                          (which the backend still needs, unmasked, to keep Recovered-To-Date figures
                          correct — see `shared/src/schemas/advance.ts`'s doc comment). */}
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatMoney(isOutstandingWaived(advance.status) ? '0' : advance.outstandingBalance)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {advance.repaymentType === 'FULL_DEDUCTION' ? 'Full Deduction' : 'Installment'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge tone={statusTone(advance.status)}>{statusLabel(advance.status)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{periodLabel(advance.currentScheduledPeriod)}</TableCell>
                      <TableCell className="whitespace-nowrap print:hidden">
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditingAdvance(advance)}>
                            Edit
                          </Button>
                          {/* RESERVED is included alongside ACTIVE (Presentation & Workflow
                              Stabilization Checkpoint, 2026-07-25) — a RESERVED Advance's deduction
                              still sits on a live, unreleased Draft entry, so it can still be
                              deferred or cancelled right up until that entry actually releases. */}
                          {(advance.status === 'ACTIVE' || advance.status === 'RESERVED') && (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => setDeferringAdvance(advance)}>
                                Defer
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-danger hover:border-danger"
                                onClick={() => setCancellingAdvance(advance)}
                              >
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {advances.data && (
                <ReportPagination
                  page={advances.data.page}
                  pageSize={advances.data.pageSize}
                  total={advances.data.total}
                  onPageChange={setPage}
                  disabled={advances.isFetching}
                  itemLabelPlural="advances"
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <RecordAdvanceModal open={isRecordOpen} onOpenChange={setIsRecordOpen} />
      <EditAdvanceModal advance={editingAdvance} onOpenChange={(open) => !open && setEditingAdvance(undefined)} />
      <DeferAdvanceModal advance={deferringAdvance} onOpenChange={(open) => !open && setDeferringAdvance(undefined)} />
      <CancelAdvanceModal advance={cancellingAdvance} onOpenChange={(open) => !open && setCancellingAdvance(undefined)} />
    </AppShell>
  );
}
