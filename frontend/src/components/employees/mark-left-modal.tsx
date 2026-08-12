import { useState } from 'react';
import { toast } from 'sonner';
import { toIsoDateOnly } from '@payroll/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { ApiError } from '@/lib/api-client';
import { useMarkEmployeeLeft, type Employee } from '@/hooks/use-employees';

/**
 * The single canonical "Mark Employee as Left" workflow (UAT 2026-08-11, corrected 2026-08-12) —
 * shared by Employee Registry's own row action and Payroll Entry's row-level `⋯` menu, one modal,
 * one confirmation copy, one date field, one mutation (`useMarkEmployeeLeft`,
 * `POST /employees/:id/leave`), one permission (`PAYROLL_ENTRY`, enforced independently
 * server-side — never `EMPLOYEES_EDIT`, which governs Edit Employee alone). Extracted from
 * `employees-page.tsx` (previously page-local) exactly the way `EmployeeFormModal` already was, so
 * a second caller can never drift into a second implementation of "mark as left."
 */
export function MarkLeftModal({
  open,
  onOpenChange,
  employee,
  onMarked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  /** Fires after a successful mark-as-left, in addition to the mutation's own built-in employees
   * query invalidation — lets a caller outside Employee Registry (Payroll Entry) refresh whatever
   * else it needs to. Employee Registry itself has no use for it and omits it. */
  onMarked?: () => void;
}) {
  const markLeft = useMarkEmployeeLeft();
  const [dateOfLeaving, setDateOfLeaving] = useState(() => toIsoDateOnly(new Date()));

  async function handleSubmit() {
    try {
      await markLeft.mutateAsync({ id: employee.id, input: { dateOfLeaving } });
      toast.success(`${employee.name} marked as left`);
      onOpenChange(false);
      onMarked?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !markLeft.isPending && onOpenChange(next)}>
      <ModalContent title="Mark Employee as Left" widthClassName="max-w-[420px]">
        <p className="mb-3 text-xs text-text-muted">
          <span className="font-medium text-text">{employee.name}</span> will be marked as having left.
          This preserves their history rather than deleting the record.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leave-date">Date of leaving</Label>
          <DateInput id="leave-date" value={dateOfLeaving} onChange={setDateOfLeaving} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={markLeft.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-danger hover:brightness-110"
            onClick={handleSubmit}
            disabled={markLeft.isPending}
          >
            Confirm
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
