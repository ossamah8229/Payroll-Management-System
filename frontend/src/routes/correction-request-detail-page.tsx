import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatMoney, PERMISSIONS, type SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { useCorrectionRequest } from '@/hooks/use-correction-requests';
import { ApproveRequestModal } from '@/components/corrections/approve-request-modal';
import { RejectRequestModal } from '@/components/corrections/reject-request-modal';
import {
  correctionFieldLabel,
  correctionRequestStatusTone,
  cyclePeriodLabel,
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
 * Request-detail view (Phase 6 Checkpoint 6) — every field the checkpoint's own brief requires,
 * clearly distinguishing the source historical value, the requester's proposed replacement, and
 * (only once approval has actually succeeded) the resulting immutable Correction/BalanceAdjustment.
 * Never presents `proposedNewValue` as though it were already applied — that only happens once
 * `status === 'APPROVED'` and `resultingCorrection` is populated by the backend itself.
 */
export function CorrectionRequestDetailPage({ user }: { user: SessionUser }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const request = useCorrectionRequest(id);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const canApprove = user.permissions.includes(PERMISSIONS.CORRECTIONS_APPROVE);

  return (
    <AppShell user={user} title="Correction Request" subtitle="Request detail, review, and outcome">
      <div className="mx-auto flex max-w-[720px] flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate('/corrections')}
          className="flex w-fit items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to Corrections
        </button>

        {request.isLoading && (
          <Card>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </CardContent>
          </Card>
        )}

        {!request.isLoading && request.error && (
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load this correction request</p>
              <p className="text-xs text-text-muted">
                {request.error instanceof ApiError ? request.error.message : 'Something went wrong'}
              </p>
            </CardContent>
          </Card>
        )}

        {!request.isLoading && !request.error && request.data && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <CardTitle>{correctionFieldLabel(request.data.field)}</CardTitle>
                  <Badge tone={correctionRequestStatusTone(request.data.status)}>{request.data.status}</Badge>
                </div>
                {request.data.status === 'PENDING' && canApprove && (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setRejecting(true)}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => setApproving(true)}>
                      Approve
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex flex-col">
                <Row label="Employee">{request.data.payrollEntry.employee.name}</Row>
                <Row label="Employee Code">{request.data.payrollEntry.employee.employeeCode ?? '—'}</Row>
                <Row label="Payroll Period">{cyclePeriodLabel(request.data.payrollEntry.cycle)}</Row>
                <Row label="Field">{correctionFieldLabel(request.data.field)}</Row>
                <Row label="Proposed Value">{request.data.proposedNewValue}</Row>
                <Row label="Adjustment Type">{request.data.adjustmentType.label}</Row>
                <Row label="Reason">{request.data.reason}</Row>
                <Row label="Requested By">{request.data.requestedBy.name}</Row>
                <Row label="Submitted At">{new Date(request.data.requestedAt).toLocaleString()}</Row>
                {request.data.status !== 'PENDING' && (
                  <>
                    <Row label="Reviewed By">{request.data.reviewedBy?.name ?? '—'}</Row>
                    <Row label="Reviewed At">
                      {request.data.reviewedAt ? new Date(request.data.reviewedAt).toLocaleString() : '—'}
                    </Row>
                    {request.data.status === 'REJECTED' && (
                      <Row label="Rejection Reason">{request.data.rejectionReason ?? '—'}</Row>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {request.data.status === 'APPROVED' && request.data.resultingCorrection && (
              <Card>
                <CardHeader>
                  <CardTitle>Resulting Correction</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                  <Row label="Old Value">{request.data.resultingCorrection.oldValue}</Row>
                  <Row label="New Value">{request.data.resultingCorrection.newValue}</Row>
                  <Row label="Net Salary">
                    {formatMoney(request.data.resultingCorrection.oldNetSalary)} →{' '}
                    {formatMoney(request.data.resultingCorrection.newNetSalary)}
                  </Row>
                  <Row label="Approved At">{new Date(request.data.resultingCorrection.approvedAt).toLocaleString()}</Row>
                  <div className="flex items-center justify-between pt-2">
                    <Link
                      to={`/corrections/ledger`}
                      className="text-xs font-medium text-accent-mid hover:underline"
                    >
                      View resulting Balance Adjustment in the Ledger →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <ApproveRequestModal request={approving ? request.data : undefined} onOpenChange={setApproving} />
      <RejectRequestModal request={rejecting ? request.data : undefined} onOpenChange={setRejecting} />
    </AppShell>
  );
}
