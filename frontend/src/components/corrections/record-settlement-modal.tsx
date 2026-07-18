import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatMoney } from '@payroll/shared';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FilterField } from '@/components/ui/filter-field';
import { ApiError } from '@/lib/api-client';
import { useBanks } from '@/hooks/use-banks';
import { usePayrollCycles } from '@/hooks/use-payroll-cycles';
import { PayrollCycleSelectField } from '@/components/payroll-cycle/payroll-cycle-selector';
import {
  useRecordBalanceAdjustmentSettlement,
  useRecordCorrectionPayment,
  type BalanceAdjustment,
} from '@/hooks/use-balance-adjustments';
import { availableForStandaloneSettlement } from './correction-labels';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

/**
 * The standalone-payment / cycle-scoped-settlement recording workflow (Phase 6 Checkpoint 4,
 * exposed to the frontend by Checkpoint 6). Honors the reservation ceiling Checkpoint 5A's
 * `RESERVED_AMOUNT_UNAVAILABLE` guard enforces server-side: a standalone payment is disabled
 * outright while any amount is actively reserved into a Draft cycle, and a cycle-scoped amount is
 * capped by `availableForStandaloneSettlement` for display — the server's own fresh check remains
 * the sole authority (this is a UX ceiling, not a security boundary).
 */
export function RecordSettlementModal({
  balanceAdjustment,
  activeReservedAmount,
  onOpenChange,
}: {
  balanceAdjustment: BalanceAdjustment | undefined;
  activeReservedAmount: string;
  onOpenChange: (open: boolean) => void;
}) {
  const banks = useBanks();
  const cycles = usePayrollCycles();
  const [mode, setMode] = useState<'STANDALONE' | 'CYCLE_SCOPED'>('STANDALONE');
  const [amount, setAmount] = useState('');
  const [cycleId, setCycleId] = useState('');
  const [bankId, setBankId] = useState('');

  const recordPayment = useRecordCorrectionPayment(balanceAdjustment?.id ?? '');
  const recordSettlement = useRecordBalanceAdjustmentSettlement(balanceAdjustment?.id ?? '');
  const isPending = recordPayment.isPending || recordSettlement.isPending;

  useEffect(() => {
    if (balanceAdjustment) {
      setMode(balanceAdjustment.type === 'RECOVERY' ? 'CYCLE_SCOPED' : 'STANDALONE');
      setAmount('');
      setCycleId('');
      setBankId('');
    }
    // Re-runs only when the adjustment identity changes (a new modal target), not on every
    // re-fetch of the same one — intentionally narrower than the full object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceAdjustment?.id]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (mode === 'STANDALONE') {
        await recordPayment.mutateAsync({ bankId: bankId || null, branchCode: null, accountNumber: null, iban: null });
        toast.success('Standalone payment recorded');
      } else {
        if (!cycleId || !amount) {
          toast.error('A cycle and amount are required');
          return;
        }
        await recordSettlement.mutateAsync({ cycleId, amount });
        toast.success('Settlement recorded');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RESERVED_AMOUNT_UNAVAILABLE') {
        toast.error(`Unavailable: ${error.message}`);
        return;
      }
      toast.error(error instanceof ApiError ? error.message : 'Failed to record settlement');
    }
  }

  return (
    <Modal open={Boolean(balanceAdjustment)} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      {balanceAdjustment && (
        <ModalContent title="Record Settlement" widthClassName="max-w-[520px]">
          {(() => {
            const available = availableForStandaloneSettlement(balanceAdjustment.remainingAmount, activeReservedAmount);
            const isFullyReserved = Number(available) <= 0;
            const isRecoveryOnly = balanceAdjustment.type === 'RECOVERY';

            return (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div className="rounded border border-border bg-bg px-3 py-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Remaining obligation</span>
                    <span className="font-medium text-text">{formatMoney(balanceAdjustment.remainingAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Reserved in payroll (active)</span>
                    <span className="font-medium text-text">{formatMoney(activeReservedAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5">
                    <span className="text-text-muted">Available outside payroll</span>
                    <span className="font-semibold text-text">{formatMoney(available)}</span>
                  </div>
                </div>

                {!isRecoveryOnly && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMode('STANDALONE')}
                      className={`h-9 flex-1 rounded border px-3 text-xs font-medium transition-colors ${mode === 'STANDALONE' ? 'border-accent-mid bg-accent-light text-accent' : 'border-border bg-surface text-text-muted hover:text-text'}`}
                    >
                      Standalone Payment
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('CYCLE_SCOPED')}
                      className={`h-9 flex-1 rounded border px-3 text-xs font-medium transition-colors ${mode === 'CYCLE_SCOPED' ? 'border-accent-mid bg-accent-light text-accent' : 'border-border bg-surface text-text-muted hover:text-text'}`}
                    >
                      Cycle-Scoped Settlement
                    </button>
                  </div>
                )}

                {mode === 'STANDALONE' && (
                  <>
                    {isFullyReserved ? (
                      <p className="rounded border border-warning bg-warning-light px-3 py-2 text-xs text-warning">
                        The full remaining balance is currently reserved in an active Draft-cycle materialization
                        — a standalone payment is unavailable until that reservation is resolved.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-text-muted">
                          Settles the full remaining balance ({formatMoney(available)}) in one payment, outside
                          any payroll cycle.
                        </p>
                        <FilterField id="settlement-bank" label="Bank (optional — leave blank for cash)">
                          <select
                            id="settlement-bank"
                            className={selectClassName}
                            value={bankId}
                            onChange={(e) => setBankId(e.target.value)}
                          >
                            <option value="">Cash</option>
                            {(banks.data ?? []).map((bank) => (
                              <option key={bank.id} value={bank.id}>
                                {bank.name} ({bank.code})
                              </option>
                            ))}
                          </select>
                        </FilterField>
                      </>
                    )}
                  </>
                )}

                {mode === 'CYCLE_SCOPED' && (
                  <>
                    <PayrollCycleSelectField
                      id="settlement-cycle"
                      cycles={cycles.data ?? []}
                      selectedCycleId={cycleId || undefined}
                      onSelect={setCycleId}
                    />
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="settlement-amount">Amount (max {formatMoney(available)})</Label>
                      <Input
                        id="settlement-amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={available}
                        required
                      />
                    </div>
                  </>
                )}

                <ModalFooter>
                  <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending || (mode === 'STANDALONE' && isFullyReserved)}>
                    {isPending ? 'Recording…' : 'Record Settlement'}
                  </Button>
                </ModalFooter>
              </form>
            );
          })()}
        </ModalContent>
      )}
    </Modal>
  );
}
