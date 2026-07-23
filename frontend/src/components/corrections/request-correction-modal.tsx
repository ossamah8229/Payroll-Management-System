import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { formatMoney, type CorrectionField } from '@payroll/shared';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ApiError } from '@/lib/api-client';
import { useAdjustmentTypes } from '@/hooks/use-adjustment-types';
import { useCreateCorrectionRequest, usePreviewCorrection } from '@/hooks/use-correction-requests';
import { isBooleanCorrectionField, correctionFieldLabel } from './correction-labels';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

const CORRECTION_FIELDS: CorrectionField[] = [
  'GROSS_PAY', 'DAYS', 'OT_HOURS', 'OT_RATE', 'ALLOWANCE', 'LEAVE_DAYS', 'LEAVE_RATE',
  'CYCLE_DAYS', 'EOBI_AMOUNT', 'EOBI_APPLICABLE', 'ADVANCE_DEDUCTION', 'EID_ADVANCE_DEDUCTION', 'FINE',
];

const PREVIEW_DEBOUNCE_MS = 400;

/**
 * The correction-request creation workflow (Phase 6 Checkpoint 6) — opened from a Released or
 * Archived Payroll Entry view. Only ever submits an absolute replacement value (the backend model,
 * never a delta) and only ever previews via the real backend engine — no financial recalculation
 * happens in this component. Approval, not this form, is what actually creates a `Correction`/
 * `BalanceAdjustment`; this only ever creates a `PENDING` `CorrectionRequest`.
 */
export function RequestCorrectionModal({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: PayrollEntry[];
}) {
  const navigate = useNavigate();
  const adjustmentTypes = useAdjustmentTypes();
  const [entryId, setEntryId] = useState('');
  const [field, setField] = useState<CorrectionField>('GROSS_PAY');
  const [proposedNewValue, setProposedNewValue] = useState('');
  const [adjustmentTypeId, setAdjustmentTypeId] = useState('');
  const [reason, setReason] = useState('');

  const preview = usePreviewCorrection(entryId || undefined);
  const createRequest = useCreateCorrectionRequest(entryId || undefined);
  const previewRequestId = useRef(0);

  useEffect(() => {
    if (!open) {
      setEntryId('');
      setField('GROSS_PAY');
      setProposedNewValue('');
      setAdjustmentTypeId('');
      setReason('');
    }
  }, [open]);

  // Debounced, race-safe preview: fired on every field/value change, cancelling/ignoring any
  // still-in-flight older call rather than letting it clobber a newer response (Checkpoint 6's own
  // "cancel or supersede outdated preview requests" requirement).
  useEffect(() => {
    if (!entryId || !proposedNewValue.trim() || !adjustmentTypeId) {
      preview.reset();
      return;
    }
    const requestId = ++previewRequestId.current;
    const timer = setTimeout(() => {
      preview.mutate(
        { field, proposedNewValue, adjustmentTypeId },
        {
          onSuccess: () => {
            if (requestId !== previewRequestId.current) return; // superseded — ignore
          },
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, field, proposedNewValue, adjustmentTypeId]);

  const selectedEntry = entries.find((e) => e.id === entryId);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!entryId || !proposedNewValue.trim() || !adjustmentTypeId || !reason.trim()) {
      toast.error('Every field is required');
      return;
    }
    try {
      const result = await createRequest.mutateAsync({ field, proposedNewValue, adjustmentTypeId, reason });
      toast.success('Correction request submitted');
      onOpenChange(false);
      navigate(`/corrections/requests/${result.correctionRequest.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to submit correction request');
    }
  }

  const previewError = preview.error instanceof ApiError ? preview.error : null;
  const isZeroDelta = previewError?.code === 'ZERO_DELTA';

  return (
    <Modal open={open} onOpenChange={(next) => !createRequest.isPending && onOpenChange(next)}>
      <ModalContent title="Request Correction" widthClassName="max-w-[560px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="correction-entry">Employee</Label>
            <select
              id="correction-entry"
              className={selectClassName}
              value={entryId}
              onChange={(e) => setEntryId(e.target.value)}
              required
            >
              <option value="">Select an employee…</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.employee.name} {entry.employee.employeeCode ? `(${entry.employee.employeeCode})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correction-field">Field</Label>
              <select
                id="correction-field"
                className={selectClassName}
                value={field}
                onChange={(e) => setField(e.target.value as CorrectionField)}
              >
                {CORRECTION_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {correctionFieldLabel(f)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correction-adjustment-type">Adjustment Type</Label>
              <select
                id="correction-adjustment-type"
                className={selectClassName}
                value={adjustmentTypeId}
                onChange={(e) => setAdjustmentTypeId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {(adjustmentTypes.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="correction-proposed-value">
              Proposed Value{isBooleanCorrectionField(field) ? ' (true or false)' : ''}
            </Label>
            <Input
              id="correction-proposed-value"
              value={proposedNewValue}
              onChange={(e) => setProposedNewValue(e.target.value)}
              placeholder={isBooleanCorrectionField(field) ? 'true' : 'e.g. 35000'}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="correction-reason">Reason</Label>
            <Input id="correction-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>

          {entryId && proposedNewValue.trim() && adjustmentTypeId && (
            <div className="rounded border border-border bg-bg px-3 py-2.5">
              {preview.isPending && <Skeleton className="h-16 w-full" />}
              {!preview.isPending && previewError && (
                <p className="text-xs text-danger">{previewError.message}</p>
              )}
              {!preview.isPending && !previewError && preview.data && (
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
                    <span className="text-text-muted">Expected adjustment</span>
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
              )}
              {isZeroDelta && (
                <p className="mt-1 text-xs text-text-muted">
                  This value equals the current effective value — there is nothing to correct.
                </p>
              )}
            </div>
          )}

          {selectedEntry && (
            <p className="text-[11px] text-text-muted">
              Submitting creates a PENDING request only — it does not change any figure until a reviewer approves
              it.
            </p>
          )}

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={createRequest.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRequest.isPending || isZeroDelta}>
              {createRequest.isPending ? 'Submitting…' : 'Submit Request'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
