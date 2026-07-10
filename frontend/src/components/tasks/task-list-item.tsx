import { MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCancelTask, useCompleteTask, useDeleteTask, useReopenTask, type Task } from '@/hooks/use-tasks';

const PRIORITY_TONE: Record<Task['priority'], BadgeProps['tone']> = {
  LOW: 'gray',
  MEDIUM: 'amber',
  HIGH: 'red',
};

const STATUS_TONE: Record<Task['status'], BadgeProps['tone']> = {
  TO_DO: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'gray',
};

const STATUS_LABEL: Record<Task['status'], string> = {
  TO_DO: 'To Do',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status !== 'TO_DO') return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}

function isDueToday(task: Task): boolean {
  if (!task.dueDate || task.status !== 'TO_DO') return false;
  return task.dueDate === new Date().toISOString().slice(0, 10);
}

/**
 * One row in the Tasks panel. `isMasterUser`/`isAssignee` are passed down rather than re-derived
 * from a raw role check here, so this component stays a pure function of "what can the current
 * viewer do with this specific task" — the same shape ownership-based visibility already takes at
 * the API layer (docs/architecture/authentication.md's "Tasks: ownership-based visibility").
 *
 * Owns no dialog state of its own — `onEdit` is a callback into the parent (`TasksWorkspace`),
 * which renders the single shared `TaskFormDialog` instance as a sibling of the panel's own Dialog
 * root, never nested inside it (a nested Radix `Dialog.Root` inside another was a confirmed,
 * reproduced bug the first time this codebase tried it — Phase 2.5 Checkpoint 1's Manage Units
 * panel — the outer dialog's overlay stays permanently `aria-hidden`/click-intercepting once the
 * inner one closes; the fix there was the same one applied here: one dialog instance, not two
 * nested ones).
 */
export function TaskListItem({
  task,
  isMasterUser,
  isAssignee,
  onEdit,
}: {
  task: Task;
  isMasterUser: boolean;
  isAssignee: boolean;
  onEdit: (task: Task) => void;
}) {
  const completeTask = useCompleteTask();
  const cancelTask = useCancelTask();
  const reopenTask = useReopenTask();
  const deleteTask = useDeleteTask();

  async function handleComplete() {
    try {
      await completeTask.mutateAsync(task.id);
      toast.success('Task marked complete');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not complete the task');
    }
  }

  async function handleCancel() {
    try {
      await cancelTask.mutateAsync(task.id);
      toast.success('Task cancelled');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel the task');
    }
  }

  async function handleReopen() {
    try {
      await reopenTask.mutateAsync(task.id);
      toast.success('Task reopened');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not reopen the task');
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    try {
      await deleteTask.mutateAsync(task.id);
      toast.success('Task deleted');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the task');
    }
  }

  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-text">{task.title}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
          <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
        </div>
      </div>

      {task.description && <p className="text-text-muted">{task.description}</p>}

      <div className="flex items-center justify-between gap-2 text-[10.5px] text-text-muted">
        <span>
          {isMasterUser ? `Assigned to ${task.assignedTo.name}` : `From ${task.assignedBy.name}`}
        </span>
        {task.dueDate && (
          <span className={overdue ? 'font-semibold text-danger' : dueToday ? 'font-semibold text-warning' : ''}>
            {overdue ? 'Overdue: ' : dueToday ? 'Due today: ' : 'Due '}
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>

      <div className="mt-0.5 flex items-center justify-end gap-1.5">
        {isAssignee && task.status === 'TO_DO' && (
          <Button size="sm" variant="green" onClick={handleComplete} disabled={completeTask.isPending}>
            Mark Complete
          </Button>
        )}

        {isMasterUser && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                aria-label={`Actions for ${task.title}`}
              >
                <MoreVertical className="h-3.5 w-3.5" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(task)}>Edit / Reassign</DropdownMenuItem>
              {task.status === 'TO_DO' && <DropdownMenuItem onSelect={handleCancel}>Cancel</DropdownMenuItem>}
              {task.status !== 'TO_DO' && <DropdownMenuItem onSelect={handleReopen}>Reopen</DropdownMenuItem>}
              <DropdownMenuItem onSelect={handleDelete} className="text-danger">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
