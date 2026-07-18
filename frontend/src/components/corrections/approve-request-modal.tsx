import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatMoney } from '@payroll/shared';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import {
  useApproveCorrectionRequest,
  useCorrectionHistoryForEntry,
  usePreviewCorrection,
  type CorrectionRequest,
} from '@/hooks/use-correction-requests';
import { correctionFieldLabel } from './correction-labels';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

/**
 * The approval workflow (Phase 6 Checkpoint 6) — always shows a *fresh* preview against the
 * request's own stored proposal (never the requester's possibly-stale one), requests the
 * PAYABLE-timing/RECOVERY-installment metadata the backend requires at approval time, and warns
 * explicitly that approving creates immutable financial history. The backend's own transactional
 * recalculation, not this dialog's preview, is the one that actually persists — this is advisory.
 */
export function ApproveRequestModal({
  request,
  onOpenChange,
}: {
  request: CorrectionRequest | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const preview = usePreviewCorrection(request?.payrollEntryId);
  const history = useCorrectionHistoryForEntry(request?.payrollEntryId);
  const approve = useApproveCorrectionRequest();
  const [paymentTiming, setPaymentTiming] = useState<'IMMEDIATE' | 'DEFERRED'>('DEFERRED');
  const [recoveryInstallmentAmount, setRecoveryInstallmentAmount] = useState('');
  const [reversesCorrectionId, setReversesCorrectionId] = useState('');

  useEffect(() => {
    if (request) {
      preview.mutate({
        field: request.field,
        proposedNewValue: request.proposedNewValue,
        adjustmentTypeId: request.adjustmentTypeId,
      });
      setPaymentTiming('DEFERRED');
      setRecoveryInstallmentAmount('');
      setReversesCorrectionId('');
    } else {
      preview.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  async function handleApprove() {
    if (!request) return;
    try {
      const result = await approve.mutateAsync({
        id: request.id,
        input: {
          paymentTiming: preview.data?.delta.classification === 'PAYABLE' ? paymentTiming : undefined,
          recoveryInstallmentAmount:
            preview.data?.delta.classification === 'RECOVERY' && recoveryInstallmentAmount
              ? recoveryInstallmentAmount
              : null,
          reversesCorrectionId: reversesCorrectionId || null,
        },
      });
      toast.success(`Approved — ${result.balanceAdjustment.type === 'PAYABLE' ? 'Payable' : result.balanceAdjustment.type === 'RECOVERY' ? 'Recovery' : 'no'} balance of ${formatMoney(result.balanceAdjustment.amount)} recorded`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to approve correction request');
    }
  }

  const previewError = preview.error instanceof ApiError ? preview.error : null;
  const priorCorrectionsForField = (history.data ?? []).filter((c) => c.field === request?.field);

  return (
    <Modal open={Boolean(request)} onOpenChange={(next) => !approve.isPending && onOpenChange(next)}>
      {request && (
        <ModalContent title={`Approve Correction Request — ${correctionFieldLabel(request.field)}`} widthClassName="max-w-[560px] max-h-[85vh] overflow-y-auto">
          <div className="flex flex-col gap-3.5">
            <div className="rounded border border-border bg-bg px-3 py-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Requested by</span>
                <span className="font-medium text-text">{request.requestedBy.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Reason</span>
                <span className="max-w-[280px] text-right font-medium text-text">{request.reason}</span>
              </div>
            </div>

            {preview.isPending && <Skeleton className="h-20 w-full" />}
            {!preview.isPending && previewError && (
              <p className="text-xs text-danger">{previewError.message}</p>
            )}
            {!preview.isPending && !previewError && preview.data && (
              <div className="rounded border border-border bg-bg px-3 py-2.5">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Fresh Preview
                </p>
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Current effective value</span>
                    <span className="font-medium text-text">{preview.data.oldValue}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Proposed value</span>
                    <span className="font-medium text-text">{preview.data.newValue}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Net salary</span>
                    <span className="font-medium text-text">
                      {formatMoney(preview.data.oldNetSalary)} → {formatMoney(preview.data.newNetSalary)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5">
                    <span className="text-text-muted">Resulting adjustment</span>
                    <span className="flex items-center gap-1.5">
                      <Badge
                        data-testid="delta-classification"
                        tone={preview.data.delta.classification === 'PAYABLE' ? 'blue' : 'purple'}
                      >
                        {preview.data.delta.classification === 'PAYABLE' ? 'Payable' : 'Recovery'}
                      </Badge>
                      <span className="font-semibold text-text">{formatMoney(preview.data.delta.amount)}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {preview.data?.delta.classification === 'PAYABLE' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="approve-payment-timing">Payment Timing</Label>
                <select
                  id="approve-payment-timing"
                  className={selectClassName}
                  value={paymentTiming}
                  onChange={(e) => setPaymentTiming(e.target.value as 'IMMEDIATE' | 'DEFERRED')}
                >
                  <option value="DEFERRED">Deferred — surfaces in the next Draft cycle</option>
                  <option value="IMMEDIATE">Immediate — settles now</option>
                </select>
              </div>
            )}

            {preview.data?.delta.classification === 'RECOVERY' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="approve-recovery-installment">
                  Recovery Installment Amount (optional — leave blank to recover the full balance next cycle)
                </Label>
                <Input
                  id="approve-recovery-installment"
                  inputMode="decimal"
                  value={recoveryInstallmentAmount}
                  onChange={(e) => setRecoveryInstallmentAmount(e.target.value)}
                  placeholder="e.g. 2000"
                />
              </div>
            )}

            {priorCorrectionsForField.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="approve-reverses">Reverses a Prior Correction (optional)</Label>
                <select
                  id="approve-reverses"
                  className={selectClassName}
                  value={reversesCorrectionId}
                  onChange={(e) => setReversesCorrectionId(e.target.value)}
                >
                  <option value="">Not a reversal</option>
                  {priorCorrectionsForField.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.newValue} — approved {new Date(c.approvedAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded border border-warning bg-warning-light px-3 py-2 text-[11px] text-warning">
              Approving creates an immutable Correction and BalanceAdjustment — neither can be edited or deleted
              afterward.
            </div>

            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={approve.isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleApprove}
                disabled={approve.isPending || preview.isPending || Boolean(previewError)}
              >
                {approve.isPending ? 'Approving…' : 'Approve'}
              </Button>
            </ModalFooter>
          </div>
        </ModalContent>
      )}
    </Modal>
  );
}
