import { useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowDownAZ, ArrowUpAZ, Plus, X } from 'lucide-react';
import type { SessionUser, TaskPriority, TaskStatus } from '@payroll/shared';
import { cn } from '@/lib/cn';
import { canManageAllTasks } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTasks, type Task, type TaskSortBy, type TaskSortDir } from '@/hooks/use-tasks';
import { useAssignableUsers } from '@/hooks/use-users';
import { TaskListItem } from './task-list-item';

const PAGE_SIZE = 20;

const SORT_OPTIONS: { value: TaskSortBy; label: string }[] = [
  { value: 'assignedAt', label: 'Recently Assigned' },
  { value: 'dueDate', label: 'Due Date' },
  { value: 'priority', label: 'Priority' },
];

/**
 * The Tasks Workspace's right-side slide-out panel (docs/design-system.md's `.team-panel` row,
 * repurposed 2026-07-10 — permanently replaces the previously-planned Chat/To-Do tabs). Built on
 * the same Radix Dialog primitive `Modal` already uses, styled as a right-edge sheet instead of a
 * centered dialog, rather than depending on a new component library for a shape the design system
 * already names as its own category. No tabs — a single-purpose task list is all that remains once
 * Chat is gone.
 *
 * Pure presentation + filtering/sorting/pagination state only — the Create/Edit dialog is owned by
 * the parent (`TasksWorkspace`) and rendered as a *sibling* of this panel's own Dialog root, never
 * nested inside it. Deliberate: a Radix `Dialog.Root` nested inside another was a confirmed,
 * reproduced bug the first time this codebase tried it (Phase 2.5 Checkpoint 1's Manage Units
 * panel) — the outer dialog's overlay stays permanently `aria-hidden`/click-intercepting once the
 * inner one closes. `onCreateClick`/`onEditTask` hand control up to the parent instead.
 *
 * Pagination is "Load more," not numbered pages — a better fit for a 340px-wide panel than
 * page-number controls, and the visibility model means even Master User's "every task" view is
 * realistically a short list for a single-digit-to-low-double-digit staff count, not a scale the
 * Payroll Entry grid's own virtualization was built for.
 */
export function TasksPanel({
  open,
  onOpenChange,
  user,
  onCreateClick,
  onEditTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: SessionUser;
  onCreateClick: () => void;
  onEditTask: (task: Task) => void;
}) {
  const isMasterUser = canManageAllTasks(user);
  // GET /api/v1/users-lookup/assignable is tasks:manage-gated server-side — only fetch it for the
  // assignee filter a `tasks:manage` holder actually sees, and only once the panel is open; an
  // assignee session must never fire this request at all (it would 403).
  const users = useAssignableUsers({ enabled: isMasterUser && open });

  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const [sortBy, setSortBy] = useState<TaskSortBy>('assignedAt');
  const [sortDir, setSortDir] = useState<TaskSortDir>('desc');
  const [pageCount, setPageCount] = useState(1);

  const filters = useMemo(
    () => ({
      status: status || undefined,
      priority: priority || undefined,
      assignedToUserId: isMasterUser ? assignedToUserId || undefined : undefined,
      sortBy,
      sortDir,
      page: 1,
      pageSize: PAGE_SIZE * pageCount,
    }),
    [status, priority, assignedToUserId, isMasterUser, sortBy, sortDir, pageCount],
  );

  const { data, isLoading } = useTasks(filters);
  const tasks = data?.tasks ?? [];
  const hasMore = data ? tasks.length < data.total : false;

  function resetPaging() {
    setPageCount(1);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Deliberately near-transparent, not a full dark backdrop like Modal's — this is a
            persistent utility panel, not a page-blocking dialog; click-outside-to-close and Escape
            still work via the same Radix primitive Modal uses. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/5" />
        <DialogPrimitive.Content
          className={cn(
            'fixed right-0 top-0 z-[60] flex h-full w-[340px] flex-col border-l border-border bg-surface-2 shadow-md',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
            // Responsive: a fixed 340px panel would overlap most of a narrow viewport's own
            // content — full-width below the sm breakpoint instead.
            'max-sm:w-full',
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="text-[13px] font-semibold text-text">Tasks</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text">
              <X className="h-4 w-4" aria-hidden />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
            {isMasterUser && (
              <Button size="sm" onClick={onCreateClick}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create Task
              </Button>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as TaskStatus | '');
                  resetPaging();
                }}
                className="h-8 rounded border border-border bg-surface-2 px-2 text-[11px] text-text outline-none focus:border-accent-mid"
              >
                <option value="">All statuses</option>
                <option value="TO_DO">To Do</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>

              <select
                aria-label="Filter by priority"
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value as TaskPriority | '');
                  resetPaging();
                }}
                className="h-8 rounded border border-border bg-surface-2 px-2 text-[11px] text-text outline-none focus:border-accent-mid"
              >
                <option value="">All priorities</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>

              {isMasterUser && (
                <select
                  aria-label="Filter by assignee"
                  value={assignedToUserId}
                  onChange={(e) => {
                    setAssignedToUserId(e.target.value);
                    resetPaging();
                  }}
                  className="h-8 rounded border border-border bg-surface-2 px-2 text-[11px] text-text outline-none focus:border-accent-mid"
                >
                  <option value="">Everyone</option>
                  {(users.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <select
                aria-label="Sort by"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as TaskSortBy);
                  resetPaging();
                }}
                className="h-8 flex-1 rounded border border-border bg-surface-2 px-2 text-[11px] text-text outline-none focus:border-accent-mid"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                onClick={() => {
                  setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                  resetPaging();
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border text-text-muted transition-colors hover:bg-bg hover:text-text"
              >
                {sortDir === 'asc' ? (
                  <ArrowUpAZ className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ArrowDownAZ className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}

            {!isLoading && tasks.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-14 text-center">
                <p className="text-xs font-medium text-text">No tasks</p>
                <p className="max-w-[220px] text-[11px] text-text-muted">
                  {isMasterUser
                    ? 'Create a task to delegate work to someone on your team.'
                    : "Nothing has been assigned to you yet."}
                </p>
              </div>
            )}

            {tasks.map((task) => (
              <TaskListItem
                key={task.id}
                task={task}
                isMasterUser={isMasterUser}
                isAssignee={task.assignedToUserId === user.id}
                onEdit={onEditTask}
              />
            ))}

            {hasMore && (
              <div className="p-3">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setPageCount((c) => c + 1)}
                >
                  Load more
                </Button>
              </div>
            )}
          </div>

          {data && (
            <div className="border-t border-border px-4 py-2 text-[10.5px] text-text-muted">
              {tasks.length} of {data.total} task{data.total === 1 ? '' : 's'}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
