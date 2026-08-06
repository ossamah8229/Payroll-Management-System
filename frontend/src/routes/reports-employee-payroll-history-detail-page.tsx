import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatDate, formatMoney, type SessionUser } from '@payroll/shared';
import type {
  EmployeePayrollHistoryBalanceAdjustmentSummary,
  EmployeePayrollHistoryCorrectionDetail,
} from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useEmployeePayrollHistoryDetail } from '@/hooks/use-employee-payroll-history';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import {
  balanceAdjustmentStatusTone,
  balanceAdjustmentTypeLabel,
  balanceAdjustmentTypeTone,
  cyclePeriodLabel,
} from '@/components/corrections/correction-labels';
import { rosterStatusLabel } from '@/components/reports/employee-payroll-history-labels';
import type { EmployeePayrollHistoryListNavigationState } from './reports-employee-payroll-history-page';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-xs last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text">{children}</span>
    </div>
  );
}

function IdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="break-words text-xs font-medium text-text">{value}</span>
    </div>
  );
}

/**
 * A `BalanceAdjustmentSummary`'s own settlement history — reused for both a Correction's
 * `resultingBalanceAdjustment` and this entry's own `automaticRecoveryBalanceAdjustment` (Step 9:
 * "Clearly distinguish: ordinary payroll materialization / standalone Correction Payment /
 * recovery installment / immediate payable / deferred payable... Do not combine them into Net
 * Salary"). Mirrors `balance-adjustment-detail-page.tsx`'s own identical Settlement History table
 * shape — the one existing precedent for rendering this exact data — rather than inventing a new
 * layout for it here.
 */
function BalanceAdjustmentSummaryBlock({ summary }: { summary: EmployeePayrollHistoryBalanceAdjustmentSummary }) {
  const hasSettlementHistory = summary.correctionPayment !== null || summary.settlements.length > 0;
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={balanceAdjustmentTypeTone(summary.type)}>{balanceAdjustmentTypeLabel(summary.type)}</Badge>
        <Badge tone={balanceAdjustmentStatusTone(summary.status)}>{summary.status}</Badge>
        {summary.paymentTiming && <span className="text-[11px] text-text-muted">{summary.paymentTiming === 'IMMEDIATE' ? 'Immediate payable' : 'Deferred payable'}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-6">
        <Row label="Original Amount">{formatMoney(summary.amount)}</Row>
        <Row label="Remaining Amount">{formatMoney(summary.remainingAmount)}</Row>
      </div>
      {hasSettlementHistory && (
        <div className="overflow-x-auto rounded border border-border">
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
              {summary.correctionPayment && (
                <TableRow>
                  <TableCell className="whitespace-nowrap">Standalone Correction Payment</TableCell>
                  <TableCell className="whitespace-nowrap">—</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(summary.correctionPayment.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(summary.correctionPayment.paidAt) || '—'}</TableCell>
                </TableRow>
              )}
              {summary.settlements.map((settlement) => (
                <TableRow key={settlement.settlementId}>
                  <TableCell className="whitespace-nowrap">Cycle-Scoped Settlement (recovery installment)</TableCell>
                  <TableCell className="whitespace-nowrap">{cyclePeriodLabel(settlement.cycle)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(settlement.amountApplied)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(settlement.appliedAt) || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!hasSettlementHistory && <p className="text-[11px] text-text-muted">No settlement recorded yet.</p>}
    </div>
  );
}

function CorrectionItem({ correction }: { correction: EmployeePayrollHistoryCorrectionDetail }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text">{correction.adjustmentTypeLabel}</span>
        <span className="text-[11px] text-text-muted">
          {formatDate(correction.approvedAt) || '—'} · Approved by {correction.approvedBy.name}
        </span>
      </div>
      <Row label="Reason">{correction.reason}</Row>
      <Row label="Field">{correction.field}</Row>
      <Row label="Value Change">
        {correction.oldValue} → {correction.newValue}
      </Row>
      <Row label="Net Salary Change">
        {formatMoney(correction.oldNetSalary)} → {formatMoney(correction.newNetSalary)}
      </Row>
      {correction.resultingBalanceAdjustment ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Resulting Balance Adjustment
          </span>
          <BalanceAdjustmentSummaryBlock summary={correction.resultingBalanceAdjustment} />
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">This correction produced no balance adjustment (zero-delta).</p>
      )}
    </div>
  );
}

/**
 * Employee Payroll History Checkpoint 1B — the read-only detail page over
 * `GET /api/v1/reports/employee-payroll-history/:entryId`. Never a modal (Step 9). Every figure in
 * the "Original Payroll Result" card is the entry's own immutable, as-released `calcNet` breakdown
 * — this page never recomputes anything; Corrections/Balance Adjustments/Materializations/
 * Settlements below are rendered as later, separate events layered on top, never merged into that
 * original result (approved decision 3, `docs/architecture/workflows/reports.md` §15.1.3).
 *
 * A 404 here (entry does not exist, or exists but is outside this session's historical site
 * access) is deliberately shown as one plain "not found" state — the backend itself never
 * distinguishes the two cases for exactly this reason (concealment, matching Statements' own
 * `docs/architecture/workflows/statements-ledger.md` posture), so this page can't either.
 */
export function EmployeePayrollHistoryDetailPage({ user }: { user: SessionUser }) {
  const { entryId } = useParams<{ entryId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const detail = useEmployeePayrollHistoryDetail(entryId);

  function goBackToReport() {
    const listState = (location.state as { listState?: EmployeePayrollHistoryListNavigationState } | null)?.listState;
    navigate('/reports/employee-payroll-history', listState ? { state: { listState } } : undefined);
  }

  return (
    <AppShell user={user} title="Employee Payroll History" subtitle="Original payroll result and its later financial events">
      <div className="mx-auto flex max-w-[900px] flex-col gap-3">
        <button
          type="button"
          onClick={goBackToReport}
          className="flex w-fit items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to Report
        </button>

        {detail.isLoading && (
          <Card>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </CardContent>
          </Card>
        )}

        {!detail.isLoading && detail.error && (
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">
                {detail.error instanceof ApiError && detail.error.status === 404
                  ? 'This payroll history entry could not be found'
                  : 'Could not load this payroll history entry'}
              </p>
              <p className="max-w-md text-xs text-text-muted">
                {detail.error instanceof ApiError && detail.error.status === 404
                  ? "It may not exist, or it may be outside your Site access. If you believe this is a mistake, contact a Master User."
                  : detail.error instanceof ApiError
                    ? detail.error.message
                    : 'Something went wrong'}
              </p>
            </CardContent>
          </Card>
        )}

        {!detail.isLoading && !detail.error && detail.data && (
          <>
            {/* 1. Identity & Historical Assignment. The badge reflects only the single
                `release.released` fact returned by the detail endpoint — the full 5-state
                `rowStatus` precedence is a list-only concept (`EmployeePayrollHistoryRow.rowStatus`,
                derived server-side); the detail response has no equivalent field, and this page
                never re-derives one (Step 7: "Do not derive status client-side"). The full release
                facts (hold/payout outcome/late reason) are shown as-is in Release Information below. */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2.5">
                  <CardTitle>{detail.data.identity.employeeName}</CardTitle>
                  <Badge tone={detail.data.release.released ? 'green' : 'amber'}>
                    {detail.data.release.released ? 'Released' : 'Not Yet Released'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <IdentityField label="Payroll Month" value={formatCycleLabel(detail.data.identity.cycle)} />
                <IdentityField label="Employee Code" value={detail.data.identity.employeeCode ?? '—'} />
                <IdentityField label="CNIC" value={detail.data.identity.cnic ?? '—'} />
                <IdentityField label="Project Site (historical)" value={detail.data.identity.siteName} />
                <IdentityField label="Designation" value={detail.data.identity.designation} />
                <IdentityField
                  label="Current Roster Status"
                  value={`${rosterStatusLabel(detail.data.identity.currentEmployeeRosterStatus)} (current)`}
                />
              </CardContent>
            </Card>

            {/* 2. Original Payroll Calculation */}
            <Card>
              <CardHeader>
                <CardTitle>Original Payroll Result</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col">
                <p className="pb-2 text-[11px] text-text-muted">
                  Corrections and later settlements do not overwrite this original payroll result.
                </p>
                <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  <Row label="Gross Pay">{formatMoney(detail.data.calculation.grossPay)}</Row>
                  <Row label="Earned Amount">{formatMoney(detail.data.calculation.earnedAmount)}</Row>
                  <Row label="OT Earned">{formatMoney(detail.data.calculation.otEarned)}</Row>
                  <Row label="Leave Earned">{formatMoney(detail.data.calculation.leaveEarned)}</Row>
                  <Row label="Allowance">{formatMoney(detail.data.calculation.allowance)}</Row>
                  <Row label="Materialized Balance Payable">{formatMoney(detail.data.calculation.correctionBalancePayable)}</Row>
                  <Row label="EOBI">
                    {detail.data.calculation.eobiApplicable ? formatMoney(detail.data.calculation.eobiDeduction) : 'Not Applicable'}
                  </Row>
                  <Row label="Advance Deduction">{formatMoney(detail.data.calculation.advanceDeduction)}</Row>
                  <Row label="EID Advance Deduction">{formatMoney(detail.data.calculation.eidAdvanceDeduction)}</Row>
                  <Row label="Fine">{formatMoney(detail.data.calculation.fine)}</Row>
                  <Row label="Materialized Balance Recovery">{formatMoney(detail.data.calculation.correctionBalanceRecovery)}</Row>
                  <Row label="Total Earnings">{formatMoney(detail.data.calculation.totalEarning)}</Row>
                  <Row label="Total Deductions">{formatMoney(detail.data.calculation.totalDeduction)}</Row>
                </div>
                <div className="mt-2 flex items-center justify-between border-t-2 border-border pt-2 text-sm">
                  <span className="font-semibold text-text">Net Salary</span>
                  <span className="font-semibold tabular-nums text-text">{formatMoney(detail.data.calculation.netSalary)}</span>
                </div>
              </CardContent>
            </Card>

            {/* 3. Work Line / Unit Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Work Line / Unit Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table density="compact" className="min-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Unit</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Days</TableHead>
                        <TableHead className="whitespace-nowrap text-right">OT Hours</TableHead>
                        <TableHead className="whitespace-nowrap text-right">OT Rate</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Daily Rate</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Earned Amount</TableHead>
                        <TableHead className="whitespace-nowrap text-right">OT Earned</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.data.calculation.workLines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="whitespace-nowrap font-medium">{line.unit.name}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{line.days}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{line.otHours}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{line.otRate ?? '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{line.dailyRate}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(line.earnedAmount)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(line.otEarned)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* 4. Release Information */}
            <Card>
              <CardHeader>
                <CardTitle>Release Information</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col">
                <Row label="Released">{detail.data.release.released ? 'Yes' : 'No'}</Row>
                <Row label="Released Date">{formatDate(detail.data.release.releasedAt) || '—'}</Row>
                <Row label="Released By">{detail.data.release.releasedBy?.name ?? '—'}</Row>
                <Row label="Late Entry Reason">{detail.data.release.lateReason ?? '—'}</Row>
                <Row label="Hold">{detail.data.release.hold ? 'Yes' : 'No'}</Row>
                <Row label="Payout Outcome">{detail.data.release.payoutOutcome ?? '—'}</Row>
              </CardContent>
            </Card>

            {/* 5. Linked Advances */}
            <Card>
              <CardHeader>
                <CardTitle>Linked Advances</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {detail.data.advances.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">No Advances linked to this entry</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table density="compact" className="min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Type</TableHead>
                          <TableHead className="whitespace-nowrap text-right">Total Amount</TableHead>
                          <TableHead className="whitespace-nowrap text-right">Outstanding Balance</TableHead>
                          <TableHead className="whitespace-nowrap text-right">Deducted This Entry</TableHead>
                          <TableHead className="whitespace-nowrap">Status</TableHead>
                          <TableHead className="whitespace-nowrap">Date Given</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.data.advances.map((advance) => (
                          <TableRow key={advance.advanceId}>
                            <TableCell className="whitespace-nowrap">{advance.type === 'LOAN' ? 'Advance' : 'Eid Advance'}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(advance.totalAmount)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(advance.outstandingBalance)}</TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(advance.deductionThisEntry)}</TableCell>
                            <TableCell className="whitespace-nowrap">{advance.status}</TableCell>
                            <TableCell className="whitespace-nowrap">{formatDate(advance.dateGiven) || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 6. Corrections Originating From This Entry — each correction's own Resulting
                Balance Adjustment, Settlements, and Correction Payments render inline via
                `BalanceAdjustmentSummaryBlock` below, not as separate top-level sections. */}
            <Card>
              <CardHeader>
                <CardTitle>Corrections Originating From This Entry</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {detail.data.correctionsOriginatingFromThisEntry.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">No Corrections originate from this entry</p>
                  </div>
                ) : (
                  detail.data.correctionsOriginatingFromThisEntry.map((correction) => (
                    <CorrectionItem key={correction.correctionId} correction={correction} />
                  ))
                )}
              </CardContent>
            </Card>

            {/* 7. Resulting Balance Adjustments — this entry's own direct release outcome only
                (distinct origin path from a Correction, never conflated with one). */}
            <Card>
              <CardHeader>
                <CardTitle>Automatic Recovery Balance Adjustment</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {detail.data.automaticRecoveryBalanceAdjustment === null ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">
                      This entry&apos;s own release created no automatic Recovery balance adjustment
                    </p>
                  </div>
                ) : (
                  <BalanceAdjustmentSummaryBlock summary={detail.data.automaticRecoveryBalanceAdjustment} />
                )}
              </CardContent>
            </Card>

            {/* 8. Materializations Consumed By This Entry */}
            <Card>
              <CardHeader>
                <CardTitle>Materializations Consumed By This Entry</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {detail.data.materializationsConsumedByThisEntry.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">This entry consumed no prior Balance Adjustment</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 p-3">
                    <p className="text-[11px] text-text-muted">
                      This cycle&apos;s Net Salary includes settlement of a Balance Adjustment originating from an
                      earlier cycle — the origin cycle below is never this (consuming) entry&apos;s own cycle.
                    </p>
                    <div className="overflow-x-auto rounded border border-border">
                      <Table density="compact" className="min-w-full">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Type</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Amount</TableHead>
                            <TableHead className="whitespace-nowrap">Status</TableHead>
                            <TableHead className="whitespace-nowrap">Origin Cycle</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.data.materializationsConsumedByThisEntry.map((m) => (
                            <TableRow key={m.materializationId}>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone={balanceAdjustmentTypeTone(m.originType)}>{balanceAdjustmentTypeLabel(m.originType)}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(m.amount)}</TableCell>
                              <TableCell className="whitespace-nowrap">{m.status}</TableCell>
                              <TableCell className="whitespace-nowrap">Origin cycle: {cyclePeriodLabel(m.originCycle)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 9. Audit References — read-only identifiers only; no Audit Log viewer route exists
                yet, so these are never rendered as a link. */}
            <Card>
              <CardHeader>
                <CardTitle>Audit References</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {detail.data.auditReferences.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">No audit references</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table density="compact" className="min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Entity Type</TableHead>
                          <TableHead className="whitespace-nowrap">Entity ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.data.auditReferences.map((ref) => (
                          <TableRow key={`${ref.entityType}-${ref.entityId}`}>
                            <TableCell className="whitespace-nowrap">{ref.entityType}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">{ref.entityId}</TableCell>
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
    </AppShell>
  );
}
