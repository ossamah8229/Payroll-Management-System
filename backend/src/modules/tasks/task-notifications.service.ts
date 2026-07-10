import type { TaskNotificationType } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';

/**
 * The persisted half of the Tasks Workspace's in-app notification model
 * (docs/architecture/database/tasks.md §27a, Phase 3.5) — one row per discrete event a user should
 * be told about (`ASSIGNED`/`REASSIGNED`/`COMPLETED`, exactly the three the frozen decision names).
 * Due-today/overdue are deliberately NOT written here; they are computed live from
 * `Task.dueDate`/`Task.status` at read time — no cleanup/retention job exists or is needed at this
 * scale (docs/architecture/database/tasks.md §27a's own "row count" note).
 *
 * No WebSockets/SSE — this table exists purely to answer "how many unread" and "which task" cheaply
 * for an ordinary client poll, matching docs/architecture/authentication.md's Postgres-over-Redis
 * reasoning (this system's user count doesn't justify realtime infrastructure).
 */

export interface CreateTaskNotificationInput {
  userId: string;
  taskId: string;
  type: TaskNotificationType;
}

/**
 * Mirrors `recordAuditLog`'s own shape exactly (an optional transaction client, defaulting to the
 * shared `prisma` instance) — every caller writes a task's `AuditLog` entry and its
 * `TaskNotification` row in the same transaction as the `Task` mutation itself, so a notification is
 * never created for a write that ultimately rolled back.
 */
export async function createTaskNotification(
  input: CreateTaskNotificationInput,
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  await client.taskNotification.create({
    data: {
      userId: input.userId,
      taskId: input.taskId,
      type: input.type,
    },
  });
}

/** The one query `(userId, readAt)` index exists to serve — the Tasks panel's notification badge. */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.taskNotification.count({ where: { userId, readAt: null } });
}

/**
 * Marks every unread notification for one specific task, for the current user only, as read — the
 * side effect of `GET /api/v1/tasks/:id` (opening a task clears its own contribution to the badge,
 * a deliberate UX convenience so a separate "mark read" click is never required just to view a
 * task). Never touches another user's notifications for the same task.
 */
export async function markTaskNotificationsRead(taskId: string, userId: string): Promise<void> {
  await prisma.taskNotification.updateMany({
    where: { taskId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

/** The Tasks panel's explicit "clear all" affordance — marks every one of the current user's unread
 * notifications read, regardless of which task each belongs to. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await prisma.taskNotification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
