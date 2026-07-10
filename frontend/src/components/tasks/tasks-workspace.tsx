import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { SessionUser } from '@payroll/shared';
import { useUnreadTaskNotificationCount } from '@/hooks/use-tasks';
import type { Task } from '@/hooks/use-tasks';
import { TasksPanel } from './tasks-panel';
import { TaskFormDialog } from './task-form-dialog';

type FormState = { mode: 'create' } | { mode: 'edit'; task: Task } | null;

/**
 * The Topbar's Tasks entry point (docs/design-system.md's `.team-panel` toggle, repurposed
 * 2026-07-10) — owns the panel-open state, the badge's unread count, and the single shared
 * Create/Edit dialog instance, rendering the panel and the dialog as *siblings*, never one nested
 * inside the other (see `tasks-panel.tsx`'s own doc comment for why that specific nesting is a
 * confirmed bug in this codebase, not just a theoretical risk).
 */
export function TasksWorkspace({ user }: { user: SessionUser }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [formState, setFormState] = useState<FormState>(null);

  const unreadCount = useUnreadTaskNotificationCount(true);
  const count = unreadCount.data ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        aria-label={count > 0 ? `Tasks — ${count} unread` : 'Tasks'}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg hover:text-text"
      >
        <ClipboardList className="h-4 w-4" aria-hidden />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <TasksPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        user={user}
        onCreateClick={() => setFormState({ mode: 'create' })}
        onEditTask={(task) => setFormState({ mode: 'edit', task })}
      />

      <TaskFormDialog
        open={formState !== null}
        onOpenChange={(next) => {
          if (!next) setFormState(null);
        }}
        task={formState?.mode === 'edit' ? formState.task : undefined}
      />
    </>
  );
}
