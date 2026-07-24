import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { formatMoney, toIsoDateOnly } from '@payroll/shared';
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
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useCurrentPayrollCycle } from '@/hooks/use-payroll-cycles';
import { apiRequest } from '@/lib/api-client';
import {
  type Advance,
  useAdvances,
  useCreateAdvance,
  useDeferAdvanceSchedule,
  useUpdateAdvance,
} from '@/hooks/use-advances';

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

function typeLabel(type: string): string {
  return type === 'LOAN' ? 'Advance' : 'Eid Advance';
}

function periodLabel(period: Advance['currentScheduledPeriod']): string {
  if (!period) return '—';
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${MONTH_NAMES[period.month - 1]} ${period.year}`;
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
  const [originalYear, setOriginalYear] = useState(() => cycle?.year ?? new Date().getFullYear());
  const [originalMonth, setOriginalMonth] = useState(() => cycle?.month ?? new Date().getMonth() + 1);

  useEffect(() => {
    if (open && cycle) {
      setOriginalYear(cycle.year);
      setOriginalMonth(cycle.month);
    }
  }, [open, cycle]);

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

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-original-year">First Deduction Year</Label>
              <Input
                id="advance-original-year"
                type="number"
                value={originalYear}
                onChange={(e) => setOriginalYear(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-original-month">First Deduction Month</Label>
              <Input
                id="advance-original-month"
                type="number"
                min={1}
                max={12}
                value={originalMonth}
                onChange={(e) => setOriginalMonth(Number(e.target.value))}
              />
            </div>
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

function EditAdvanceModal({
  advance,
  onOpenChange,
}: {
  advance: Advance | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const updateAdvance = useUpdateAdvance();
  const [repaymentType, setRepaymentType] = useState<'FULL_DEDUCTION' | 'INSTALLMENT'>('FULL_DEDUCTION');
  const [scheduledInstallmentAmount, setScheduledInstallmentAmount] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (advance) {
      setRepaymentType(advance.repaymentType);
      setScheduledInstallmentAmount(advance.scheduledInstallmentAmount ?? '');
      setNotes(advance.notes ?? '');
    }
  }, [advance]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!advance) return;
    try {
      await updateAdvance.mutateAsync({
        id: advance.id,
        input: {
          repaymentType,
          scheduledInstallmentAmount: repaymentType === 'INSTALLMENT' && scheduledInstallmentAmount ? scheduledInstallmentAmount : null,
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-advance-repayment-type">Repayment Type</Label>
              <select
                id="edit-advance-repayment-type"
                className={selectClassName}
                value={repaymentType}
                onChange={(e) => setRepaymentType(e.target.value as 'FULL_DEDUCTION' | 'INSTALLMENT')}
              >
                <option value="FULL_DEDUCTION">Full Deduction</option>
                <option value="INSTALLMENT">Installment</option>
              </select>
            </div>
            {repaymentType === 'INSTALLMENT' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-advance-installment-amount">Scheduled Installment Amount</Label>
                <Input
                  id="edit-advance-installment-amount"
                  inputMode="decimal"
                  value={scheduledInstallmentAmount}
                  onChange={(e) => setScheduledInstallmentAmount(e.target.value)}
                  placeholder="e.g. 3000"
                />
              </div>
            )}
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
  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [editingAdvance, setEditingAdvance] = useState<Advance | undefined>(undefined);
  const [deferringAdvance, setDeferringAdvance] = useState<Advance | undefined>(undefined);

  const advances = useAdvances({
    siteId: selectedSiteIds.length === 1 ? selectedSiteIds[0] : undefined,
    type: (typeFilter || undefined) as 'LOAN' | 'EID_ADVANCE' | undefined,
    status: (statusFilter || undefined) as 'ACTIVE' | 'PAID_OFF' | undefined,
  });

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  const rows = useMemo(() => {
    const list = advances.data ?? [];
    if (selectedSiteIds.length <= 1) return list;
    return list.filter((advance) => selectedSiteIds.includes(advance.employee.siteId));
  }, [advances.data, selectedSiteIds]);

  return (
    <AppShell user={user} title="Advances" subtitle="Record and track Advance / Eid Advance balances">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2.5">
            <CardTitle>Advances</CardTitle>
            <div className="print:hidden">
              <PrintButton />
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
                <option value="PAID_OFF">Paid Off</option>
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
                    <TableHead className="whitespace-nowrap">Employee</TableHead>
                    <TableHead className="whitespace-nowrap">Type</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Total Amount</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Outstanding Balance</TableHead>
                    <TableHead className="whitespace-nowrap">Repayment Type</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="whitespace-nowrap">Scheduled Period</TableHead>
                    <TableHead className="whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((advance) => (
                    <TableRow key={advance.id}>
                      <TableCell className="whitespace-nowrap font-medium">{advance.employee.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{typeLabel(advance.type)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(advance.totalAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatMoney(advance.outstandingBalance)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {advance.repaymentType === 'FULL_DEDUCTION' ? 'Full Deduction' : 'Installment'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge tone={advance.status === 'ACTIVE' ? 'green' : 'gray'}>
                          {advance.status === 'ACTIVE' ? 'Active' : 'Paid Off'}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{periodLabel(advance.currentScheduledPeriod)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex gap-2 print:hidden">
                          <Button size="sm" variant="secondary" onClick={() => setEditingAdvance(advance)}>
                            Edit
                          </Button>
                          {advance.status === 'ACTIVE' && (
                            <Button size="sm" variant="secondary" onClick={() => setDeferringAdvance(advance)}>
                              Defer
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RecordAdvanceModal open={isRecordOpen} onOpenChange={setIsRecordOpen} />
      <EditAdvanceModal advance={editingAdvance} onOpenChange={(open) => !open && setEditingAdvance(undefined)} />
      <DeferAdvanceModal advance={deferringAdvance} onOpenChange={(open) => !open && setDeferringAdvance(undefined)} />
    </AppShell>
  );
}
