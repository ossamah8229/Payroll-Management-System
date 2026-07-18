import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Decimal } from 'decimal.js';
import { formatMoney, PERMISSIONS, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import {
  useBalanceAdjustment,
  useBalanceAdjustmentMaterializations,
  useBalanceAdjustmentSettlements,
} from '@/hooks/use-balance-adjustments';
import { RecordSettlementModal } from '@/components/corrections/record-settlement-modal';
import {
  balanceAdjustmentStatusTone,
  balanceAdjustmentTypeLabel,
  balanceAdjustmentTypeTone,
  cyclePeriodLabel,
  materializationStatusTone,
} from '@/components/corrections/correction-labels';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-xs last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text">{children}</span>
    </div>
  );
}

/**
 * BalanceAdjustment detail (Phase 6 Checkpoint 6) — the full lifecycle view: original vs.
 * remaining vs. reserved vs. available vs. settled, every materialization (the reservation
 * ledger), and every settlement/payment (the immutable settlement history). `activeReservedAmount`
 * is summed here from the already-fetched materializations list — the exact same
 * `status === 'ACTIVE'` filter `getActiveReservedAmount` (backend) applies, never a client-side
 * financial recalculation of anything the backend doesn't already report as raw figures.
 */
export function BalanceAdjustmentDetailPage({ user }: { user: SessionUser }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const adjustment = useBalanceAdjustment(id);
  const materializations = useBalanceAdjustmentMaterializations(id);
  const settlements = useBalanceAdjustmentSettlements(id);
  const [recordingSettlement, setRecordingSettlement] = useState(false);
  const canRecordSettlement = user.permissions.includes(PERMISSIONS.CORRECTIONS_APPROVE);

  const activeReservedAmount = useMemo(() => {
    const active = (materializations.data ?? []).filter((m) => m.status === 'ACTIVE');
    return active.reduce((sum, m) => sum.plus(m.amount), new Decimal(0)).toFixed(2);
  }, [materializations.data]);

  const isLoading = adjustment.isLoading || materializations.isLoading || settlements.isLoading;

  return (
    <AppShell user={user} title="Balance Adjustment" subtitle="Reservation, materialization, and settlement state">
      <div className="mx-auto flex max-w-[760px] flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate('/corrections')}
          className="flex w-fit items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to Corrections
        </button>

        {isLoading && (
          <Card>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </CardContent>
          </Card>
        )}

        {!isLoading && adjustment.error && (
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load this Balance Adjustment</p>
              <p className="text-xs text-text-muted">
                {adjustment.error instanceof ApiError ? adjustment.error.message : 'Something went wrong'}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !adjustment.error && adjustment.data && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <CardTitle>{adjustment.data.employee.name}</CardTitle>
                  <Badge tone={balanceAdjustmentTypeTone(adjustment.data.type)}>
                    {balanceAdjustmentTypeLabel(adjustment.data.type)}
                  </Badge>
                  <Badge tone={balanceAdjustmentStatusTone(adjustment.data.status)}>{adjustment.data.status}</Badge>
                </div>
                {adjustment.data.status === 'PENDING' && canRecordSettlement && (
                  <Button size="sm" onClick={() => setRecordingSettlement(true)}>
                    Record Settlement
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col">
                <Row label="Employee Code">{adjustment.data.employee.employeeCode ?? '—'}</Row>
                <Row label="Adjustment Type">{adjustment.data.adjustmentType.label}</Row>
                <Row label="Source Cycle">{cyclePeriodLabel(adjustment.data.sourceCycle)}</Row>
                <Row label="Payment Timing">{adjustment.data.paymentTiming ?? '—'}</Row>
                {adjustment.data.type === 'RECOVERY' && (
                  <Row label="Recovery Installment">
                    {adjustment.data.recoveryInstallmentAmount
                      ? formatMoney(adjustment.data.recoveryInstallmentAmount)
                      : 'Full balance next cycle'}
                  </Row>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Outstanding Balance</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1">
                <Row label="Original adjustment">{formatMoney(adjustment.data.amount)}</Row>
                <Row label="Remaining obligation">{formatMoney(adjustment.data.remainingAmount)}</Row>
                <Row label="Reserved in payroll">{formatMoney(activeReservedAmount)}</Row>
                <Row label="Available outside payroll">
                  {formatMoney(new Decimal(adjustment.data.remainingAmount).minus(activeReservedAmount).toFixed(2))}
                </Row>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Materializations (Draft-Cycle Reservations)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {(materializations.data ?? []).length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">No Draft-cycle reservations yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table density="compact" className="min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Cycle</TableHead>
                          <TableHead className="whitespace-nowrap text-right">Amount</TableHead>
                          <TableHead className="whitespace-nowrap">Status</TableHead>
                          <TableHead className="whitespace-nowrap">Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(materializations.data ?? []).map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="whitespace-nowrap">{cyclePeriodLabel(m.cycle)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(m.amount)}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge tone={materializationStatusTone(m.status)}>{m.status}</Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Settlement History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {adjustment.data.correctionPayment === null && (settlements.data ?? []).length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">No settlement recorded yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table density="compact" className="min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Kind</TableHead>
                          <TableHead className="whitespace-nowrap">Cycle</TableHead>
                          <TableHead className="whitespace-nowrap text-right">Amount</TableHead>
                          <TableHead className="whitespace-nowrap">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adjustment.data.correctionPayment && (
                          <TableRow>
                            <TableCell className="whitespace-nowrap">Standalone Payment</TableCell>
                            <TableCell className="whitespace-nowrap">—</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {formatMoney(adjustment.data.correctionPayment.amount)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {new Date(adjustment.data.correctionPayment.paidAt).toLocaleDateString()}
                            </TableCell>
                          </TableRow>
                        )}
                        {(settlements.data ?? []).map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="whitespace-nowrap">Cycle-Scoped Settlement</TableCell>
                            <TableCell className="whitespace-nowrap">{cyclePeriodLabel(s.cycle)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(s.amountApplied)}</TableCell>
                            <TableCell className="whitespace-nowrap">{new Date(s.appliedAt).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <RecordSettlementModal
        balanceAdjustment={recordingSettlement ? adjustment.data : undefined}
        activeReservedAmount={activeReservedAmount}
        onOpenChange={setRecordingSettlement}
      />
    </AppShell>
  );
}
