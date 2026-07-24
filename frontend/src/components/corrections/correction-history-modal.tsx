import { useNavigate } from 'react-router-dom';
import { formatMoney } from '@payroll/shared';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useCorrectionRequests } from '@/hooks/use-correction-requests';
import { correctionFieldLabel, correctionRequestStatusTone } from './correction-labels';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';

/**
 * Every correction request ever filed against one Payroll Entry — pending, approved, and
 * rejected alike (Corrections workflow completion) — reached from the entry's own row in the
 * Payroll Entry grid, per "Released payroll entries must expose ... View Correction History."
 * Reuses `useCorrectionRequests({ payrollEntryId })`, the same data `GET
 * /payroll-entries/:entryId/correction-requests` (`corrections.routes.ts`) already serves — no new
 * backend endpoint needed, only a new place to surface it. Clicking a row navigates to that
 * request's own existing detail page (approve/reject, or a read-only past decision).
 */
export function CorrectionHistoryModal({
  open,
  onOpenChange,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: PayrollEntry | undefined;
}) {
  const navigate = useNavigate();
  const requests = useCorrectionRequests(entry ? { payrollEntryId: entry.id } : {});

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title={entry ? `Correction History — ${entry.employee.name}` : 'Correction History'}
        widthClassName="max-w-[720px]"
      >
        {requests.isLoading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!requests.isLoading && requests.error && (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <p className="text-xs font-medium text-danger">Could not load correction history</p>
            <p className="text-xs text-text-muted">
              {requests.error instanceof ApiError ? requests.error.message : 'Something went wrong'}
            </p>
          </div>
        )}

        {!requests.isLoading && !requests.error && (requests.data ?? []).length === 0 && (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <p className="text-xs font-medium text-text">No corrections have been requested for this entry</p>
            <p className="text-xs text-text-muted">Every request filed against it, approved or not, will appear here.</p>
          </div>
        )}

        {!requests.isLoading && !requests.error && (requests.data ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Proposed Value</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(requests.data ?? []).map((request) => (
                  <TableRow
                    key={request.id}
                    className="cursor-pointer hover:bg-bg"
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/corrections/requests/${request.id}`);
                    }}
                  >
                    <TableCell>{correctionFieldLabel(request.field)}</TableCell>
                    <TableCell>{request.proposedNewValue}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{request.reason}</TableCell>
                    <TableCell>{request.requestedBy.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(request.requestedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge tone={correctionRequestStatusTone(request.status)}>{request.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {request.resultingCorrection ? formatMoney(request.resultingCorrection.newNetSalary) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
