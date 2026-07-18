import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { useRejectCorrectionRequest, type CorrectionRequest } from '@/hooks/use-correction-requests';
import { correctionFieldLabel } from './correction-labels';

/** The rejection workflow (Phase 6 Checkpoint 6) — mandatory reason, explicit confirmation, no
 * reopening/cancellation offered (a rejected request is a closed, immutable outcome). */
export function RejectRequestModal({
  request,
  onOpenChange,
}: {
  request: CorrectionRequest | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const reject = useRejectCorrectionRequest();
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    if (!request) setRejectionReason('');
  }, [request]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!request || !rejectionReason.trim()) return;
    try {
      await reject.mutateAsync({ id: request.id, input: { rejectionReason } });
      toast.success('Correction request rejected');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to reject correction request');
    }
  }

  return (
    <Modal open={Boolean(request)} onOpenChange={(next) => !reject.isPending && onOpenChange(next)}>
      {request && (
        <ModalContent title={`Reject Correction Request — ${correctionFieldLabel(request.field)}`} widthClassName="max-w-[480px]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <p className="text-xs text-text-muted">
              Rejecting this request is final — it creates neither a Correction nor a BalanceAdjustment, and cannot
              be reopened. The requester will see this reason on the request.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reject-reason">Rejection Reason</Label>
              <Input
                id="reject-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
                autoFocus
              />
            </div>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={reject.isPending}>
                Cancel
              </Button>
              <Button type="submit" variant="secondary" disabled={reject.isPending || !rejectionReason.trim()}>
                {reject.isPending ? 'Rejecting…' : 'Reject Request'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      )}
    </Modal>
  );
}
