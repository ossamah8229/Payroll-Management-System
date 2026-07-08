import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { useCreatePayrollCycle } from '@/hooks/use-payroll-cycles';

/**
 * Minimal "Start New Payroll Cycle" entry point — backed entirely by Phase 3 Checkpoint 1's
 * already-built `createPayrollCycle` (bootstrap or carry-forward, one implementation either way).
 * Deliberately thin: no Finalize/Release/Archive affordance lives here — this checkpoint's scope
 * is the Payroll Entry grid, and creating the Draft cycle it operates against is the one piece of
 * chrome without which the grid has nothing to render in a fresh environment.
 */
export function NewCycleModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createCycle = useCreatePayrollCycle();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await createCycle.mutateAsync({ year: Number(year), month: Number(month) });
      toast.success('Payroll cycle created');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not create the payroll cycle');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !createCycle.isPending && onOpenChange(next)}>
      <ModalContent title="Start New Payroll Cycle" widthClassName="max-w-[420px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">
            Creates a new Draft cycle — continuing employees carry their payroll figures forward from
            the most recent cycle; attendance always starts fresh.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-cycle-year">Year</Label>
              <Input
                id="new-cycle-year"
                type="number"
                required
                min={2000}
                max={2999}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-cycle-month">Month</Label>
              <Input
                id="new-cycle-month"
                type="number"
                required
                min={1}
                max={12}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={createCycle.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createCycle.isPending}>
              {createCycle.isPending ? 'Creating…' : 'Create Cycle'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
