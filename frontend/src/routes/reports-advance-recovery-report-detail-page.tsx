import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatDate, formatMoney, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useAdvanceRecoveryReportDetail } from '@/hooks/use-advance-recovery-report';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import {
  advanceStatusLabel,
  advanceStatusTone,
  advanceTypeLabel,
  repaymentTypeLabel,
  rowStatusLabel,
  rowStatusTone,
} from '@/components/reports/advance-recovery-report-labels';
import type { AdvanceRecoveryReportListNavigationState } from './reports-advance-recovery-report-page';

function IdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="break-words text-xs font-medium text-text">{value}</span>
    </div>
  );
}

/**
 * Advance Recovery Report Checkpoint 1B — the read-only detail/history page over
 * `GET /api/v1/reports/advance-recovery/:advanceId`. Never a modal (the list page's own "View
 * Details" navigates here, matching Employee Payroll History's own detail-page precedent). Every
 * field in the Advance Summary card is the Advance's own LIVE CURRENT figure (Original Amount,
 * Recovered To Date, Current Outstanding Balance, Status, Repayment Type, Scheduled Installment) —
 * this page never recomputes anything. Recovery History and Schedule/Deferral History are always
 * rendered as two separate tables/timelines, never merged (frozen backend decision, §19).
 *
 * **403 and 404 are deliberately CONCEALED behind one identical message** — the backend itself does
 * distinguish a nonexistent Advance (404) from one that exists but is outside the caller's current
 * Site access (403, mirroring the Advances module's own existing precedent,
 * `docs/architecture/workflows/reports.md` §19.1's "Detail auth posture" decision), but this page
 * deliberately does not surface that distinction to the user. Unlike the Advances module (where a user
 * can only ever construct/see an Advance id for an employee already within their own site scope), this
 * report's `reports:view` population routinely holds a valid grant scoped to *some* sites — a 403 here
 * would confirm "an Advance with this id exists, just outside your Site access" to that exact
 * population via nothing more than a shared/guessed link, an existence disclosure with no legitimate
 * use on a read-only report. Matching Employee Payroll History's own "reveal nothing" posture
 * (`getEmployeePayrollHistoryDetail`) is the safer default here, even though the two backends differ.
 * `errorStatus` is intentionally unused for copy — only kept to fall back to a generic message for any
 * other (non-403/404) failure.
 */
export function ReportsAdvanceRecoveryReportDetailPage({ user }: { user: SessionUser }) {
  const { advanceId } = useParams<{ advanceId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const detail = useAdvanceRecoveryReportDetail(advanceId);

  function goBackToReport() {
    const listState = (location.state as { listState?: AdvanceRecoveryReportListNavigationState } | null)?.listState;
    const path = listState?.cycleId
      ? `/payroll-cycles/${listState.cycleId}/reports/advance-recovery`
      : '/reports/advance-recovery';
    navigate(path, listState ? { state: { listState } } : undefined);
  }

  const errorStatus = detail.error instanceof ApiError ? detail.error.status : undefined;

  return (
    <AppShell
      user={user}
      title="Advance Recovery Report"
      subtitle="Advance summary and payroll-cycle recovery history"
    >
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
                {errorStatus === 404 || errorStatus === 403
                  ? 'This Advance could not be found'
                  : 'Could not load this Advance'}
              </p>
              <p className="max-w-md text-xs text-text-muted">
                {errorStatus === 404 || errorStatus === 403
                  ? 'It may have been removed, the link may be incorrect, or it may be outside your accessible Project Sites.'
                  : detail.error instanceof ApiError
                    ? detail.error.message
                    : 'Something went wrong'}
              </p>
            </CardContent>
          </Card>
        )}

        {!detail.isLoading && !detail.error && detail.data && (
          <>
            {/* A. Advance Summary */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2.5">
                  <CardTitle>{detail.data.employee.name}</CardTitle>
                  <Badge tone={advanceStatusTone(detail.data.status)}>{advanceStatusLabel(detail.data.status)}</Badge>
                  <Badge tone="blue">{advanceTypeLabel(detail.data.advanceType)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col">
                <p className="pb-2 text-[11px] text-text-muted">
                  Original Amount, Recovered To Date, Current Outstanding Balance, Status, Repayment Type, and
                  Scheduled Installment below are current, live figures — not as of any selected Payroll Cycle.
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <IdentityField label="Employee Code" value={detail.data.employee.employeeCode ?? '—'} />
                  <IdentityField label="Current Site" value={detail.data.employee.siteName} />
                  <IdentityField label="Advance Type" value={advanceTypeLabel(detail.data.advanceType)} />
                  <IdentityField label="Repayment Type" value={repaymentTypeLabel(detail.data.repaymentType)} />
                  <IdentityField label="Original Amount" value={formatMoney(detail.data.originalAmount)} />
                  <IdentityField label="Recovered To Date" value={formatMoney(detail.data.recoveredToDate)} />
                  <IdentityField label="Current Outstanding Balance" value={formatMoney(detail.data.currentOutstandingBalance)} />
                  <IdentityField
                    label="Scheduled Installment"
                    value={detail.data.scheduledInstallmentAmount !== null ? formatMoney(detail.data.scheduledInstallmentAmount) : '—'}
                  />
                  <IdentityField label="Date Given" value={formatDate(detail.data.dateGiven) || '—'} />
                  <IdentityField label="Paid Off Date" value={detail.data.paidOffAt ? formatDate(detail.data.paidOffAt) || '—' : '—'} />
                </div>
              </CardContent>
            </Card>

            {/* B. Recovery History */}
            <Card>
              <CardHeader>
                <CardTitle>Recovery History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {detail.data.recoveryHistory.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">No recovery has been recorded against this Advance yet</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 p-3">
                    <p className="text-[11px] text-text-muted">
                      Each event&apos;s own Site is the historical Site of that payroll entry — it may differ from
                      this employee&apos;s current Site above (e.g. after a transfer).
                    </p>
                    <div className="overflow-x-auto rounded border border-border">
                      <Table density="compact" className="min-w-full">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Cycle</TableHead>
                            <TableHead className="whitespace-nowrap">Historical Site</TableHead>
                            <TableHead className="whitespace-nowrap text-right">Amount Recovered</TableHead>
                            <TableHead className="whitespace-nowrap">Row Status</TableHead>
                            <TableHead className="whitespace-nowrap">Released Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.data.recoveryHistory.map((event) => (
                            <TableRow key={event.payrollEntryId}>
                              <TableCell className="whitespace-nowrap">{event.cycleLabel}</TableCell>
                              <TableCell className="whitespace-nowrap">{event.siteName}</TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(event.amountRecovered)}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                <Badge tone={rowStatusTone(event.rowStatus)}>{rowStatusLabel(event.rowStatus)}</Badge>
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{formatDate(event.releasedAt) || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* C. Schedule / Deferral History — always a separate timeline from Recovery History
                above; a schedule change is never itself a recovery event. */}
            <Card>
              <CardHeader>
                <CardTitle>Schedule / Deferral History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {detail.data.scheduleChanges.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <p className="text-xs text-text-muted">No schedule or deferral changes have been recorded</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table density="compact" className="min-w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">From Period</TableHead>
                          <TableHead className="whitespace-nowrap">To Period</TableHead>
                          <TableHead className="whitespace-nowrap">Reason</TableHead>
                          <TableHead className="whitespace-nowrap">Changed At</TableHead>
                          <TableHead className="whitespace-nowrap">Changed By</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.data.scheduleChanges.map((change) => (
                          <TableRow key={change.id}>
                            <TableCell className="whitespace-nowrap">{formatCycleLabel(change.fromPeriod)}</TableCell>
                            <TableCell className="whitespace-nowrap">{formatCycleLabel(change.toPeriod)}</TableCell>
                            <TableCell className="whitespace-nowrap">{change.reason}</TableCell>
                            <TableCell className="whitespace-nowrap">{formatDate(change.changedAt) || '—'}</TableCell>
                            <TableCell className="whitespace-nowrap">{change.changedBy.name}</TableCell>
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
