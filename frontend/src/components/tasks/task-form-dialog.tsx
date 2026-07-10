import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { toIsoDateOnly, type TaskPriority } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { DateInput } from '@/components/ui/date-input';
import { cn } from '@/lib/cn';
import { useCreateTask, useUpdateTask, type Task } from '@/hooks/use-tasks';
import { useUsers } from '@/hooks/use-users';

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];

/**
 * Master-User-only create/edit form (docs/architecture/database/tasks.md §27 — only Master User
 * edits title/description/priority/due date/assignment; an assignee's only mutation is marking
 * their own task complete, which never goes through this dialog). One shared component for both
 * modes rather than two near-identical ones — `task` present means edit (including reassignment,
 * a plain field change in this same form, never a separate flow), absent means create.
 */
export function TaskFormDialog({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task;
}) {
  const isEdit = Boolean(task);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  // This dialog only ever opens for Master User in practice (the assignee never gets a
  // create/edit trigger anywhere in the UI) — gating by `open` rather than a role check both
  // avoids firing GET /api/v1/users (users:manage-gated) before the dialog is shown at all, and,
  // as a direct consequence, means it's never fetched for a session that would 403 on it either.
  const users = useUsers({ enabled: open });
  const isPending = createTask.isPending || updateTask.isPending;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');

  // Re-seed the form whenever a different task is opened for editing, or the dialog is reopened
  // fresh for creation — mirrors DateInput's own "sync display when the external value changes"
  // pattern, just for the whole form at once.
  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setAssignedToUserId(task?.assignedToUserId ?? '');
    setPriority(task?.priority ?? 'MEDIUM');
    // The API returns `dueDate` as a full ISO datetime (a Prisma `@db.Date` column serializes to
    // JSON as e.g. "2026-08-01T00:00:00.000Z", not a bare "2026-08-01") — `toIsoDateOnly` is the
    // shared utility built exactly for this normalization (shared/src/lib/date.ts). Without it, an
    // untouched due date silently round-trips back through the update schema's `z.string().date()`
    // validation as an invalid value the moment any *other* field is edited and the form resaves.
    setDueDate(toIsoDateOnly(task?.dueDate));
  }, [open, task]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      if (isEdit && task) {
        await updateTask.mutateAsync({
          id: task.id,
          input: {
            title,
            description: description || null,
            assignedToUserId,
            priority,
            dueDate: dueDate || null,
          },
        });
        toast.success('Task updated');
      } else {
        await createTask.mutateAsync({
          title,
          description: description || null,
          assignedToUserId,
          priority,
          dueDate: dueDate || null,
        });
        toast.success('Task created');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save the task');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent title={isEdit ? 'Edit Task' : 'Create Task'} widthClassName="max-w-[480px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Review fines before release"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-description">Description</Label>
            <textarea
              id="task-description"
              maxLength={4000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional detail"
              className={cn(
                'flex w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-text-faint transition-colors',
                'focus:border-accent-mid focus:ring-2 focus:ring-accent-light',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-assignee">
              {isEdit ? 'Reassign to' : 'Assign to'}
            </Label>
            <select
              id="task-assignee"
              required
              value={assignedToUserId}
              onChange={(e) => setAssignedToUserId(e.target.value)}
              className="flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none transition-colors focus:border-accent-mid focus:ring-2 focus:ring-accent-light"
            >
              <option value="" disabled>
                Select a user…
              </option>
              {(users.data ?? [])
                .filter((u) => u.isActive)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <select
                id="task-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none transition-colors focus:border-accent-mid focus:ring-2 focus:ring-accent-light"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-due-date">Due date</Label>
              <DateInput id="task-due-date" value={dueDate} onChange={setDueDate} />
            </div>
          </div>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Task'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
