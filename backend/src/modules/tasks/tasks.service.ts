import type { Prisma, Task } from '@prisma/client';
import { PERMISSIONS, type CreateTaskInput, type ListTasksQuery, type SessionUser, type UpdateTaskInput } from '@payroll/shared';
import { isoDateToUtcDate } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, forbidden, notFound } from '../../common/http-error';
import { diffFields, omitKeys } from '../../common/audit-diff';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { hasGlobalAuthority } from '../../common/authz-policy';
import { createTaskNotification, markTaskNotificationsRead } from './task-notifications.service';

/**
 * Tasks Workspace (docs/architecture/database/tasks.md §27, Phase 3.5) — the permanent replacement
 * for the previously-planned Team Collaboration/Chat panel. Deliberately lightweight: no subtasks,
 * no dependencies, no recurrence, no comment thread, no optimistic-locking `version` column (see
 * that document's own "Optimistic locking: deliberately NOT required" note — at most two people
 * ever touch one row, writing disjoint fields).
 */

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** Never `include: true` on a `User` relation — that would also serialize `passwordHash`. Every
 * Task response that names an assignee/assigner selects exactly these three safe fields. */
const SAFE_USER_SELECT = { id: true, name: true, email: true } as const;

const TASK_INCLUDE = {
  assignedTo: { select: SAFE_USER_SELECT },
  assignedBy: { select: SAFE_USER_SELECT },
} satisfies Prisma.TaskInclude;

type TaskWithUsers = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

async function getTaskForMutation(id: string): Promise<TaskWithUsers> {
  const task = await prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
  if (!task) {
    throw notFound('Task not found');
  }
  return task;
}

/**
 * Ownership-based visibility (docs/architecture/authentication.md's "Tasks: ownership-based
 * visibility" section) — a genuine exception to this system's role/site RBAC shape, so this is
 * deliberately its own assertion, not a reuse of `assertSiteAccess()`. Named `requireTaskAccess`
 * per the approved architecture review, but implemented as a service-layer assertion (called after
 * the task has already been fetched), not an Express middleware: unlike a site id, which is always
 * available directly from the URL, a task's `assignedToUserId` can only be known once the row
 * itself has been read — the same reason Payroll Entry's own site-scoping check
 * (`assertSiteAccess`) is a post-fetch service call, not `requireSiteAccess` middleware, even though
 * both exist in this codebase. No existing middleware touches Prisma; introducing one that does
 * here would be a real, avoidable deviation from every other middleware's pure request-shape-check
 * role.
 *
 * `TASKS_MANAGE` is this domain's global administrative permission (System-Wide RBAC Consistency
 * remediation) — Tasks has no site-scoping concept at all, so a holder's authority is either
 * "every task" (Master Admin or `TASKS_MANAGE`) or "only tasks assigned to me" (everyone else).
 * Before this fix, only the literal Master Admin role bypassed this check, while `createTask`
 * already let any `TASKS_MANAGE` holder assign a task to anyone — a custom role granted
 * `TASKS_MANAGE` could create and assign a task but then never see it again, an exact instance of
 * "can mutate but cannot list" the RBAC audit was asked to find and close.
 */
export function requireTaskAccess(currentUser: SessionUser, task: Pick<Task, 'assignedToUserId'>): void {
  if (hasGlobalAuthority(currentUser, PERMISSIONS.TASKS_MANAGE)) return;
  if (task.assignedToUserId === currentUser.id) return;
  throw forbidden('You do not have access to this task');
}

async function assertAssignableUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user) {
    throw badRequest('Assignee not found');
  }
  if (!user.isActive) {
    throw badRequest('Cannot assign a task to a deactivated user');
  }
}

/** Fields on `UpdateTaskInput` that map 1:1 onto a Prisma update payload — including
 * `assignedToUserId`, exactly like `updateEmployee`'s own field mapping includes `siteId`/`unitId`
 * even though both are also independently detected as a "transfer." The diff this payload feeds
 * (in `updateTask`, below) is what actually separates the reassignment-specific change from every
 * other field, via `omitKeys` — the same two-step "diff everything, then omit what gets its own
 * dedicated audit entry" shape `updateEmployee` already uses. */
function mapUpdateInputToTaskData(input: UpdateTaskInput): Prisma.TaskUncheckedUpdateInput {
  return {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.assignedToUserId !== undefined && { assignedToUserId: input.assignedToUserId }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.dueDate !== undefined && { dueDate: isoDateToUtcDate(input.dueDate) }),
    ...(input.module !== undefined && { module: input.module }),
    ...(input.relatedEntityType !== undefined && { relatedEntityType: input.relatedEntityType }),
    ...(input.relatedEntityId !== undefined && { relatedEntityId: input.relatedEntityId }),
  };
}

export interface ListTasksResult {
  total: number;
  page: number;
  pageSize: number;
  tasks: TaskWithUsers[];
}

/**
 * Master User or a `TASKS_MANAGE` holder sees every task (optionally filtered to one assignee);
 * everyone else is forced to `assignedToUserId = currentUser.id` regardless of what the client
 * sends — the ownership analogue of `listPayrollEntries`'s own "a Payroll Staff user with no
 * explicit siteId filter is scoped to every site they're assigned to" dual-scope shape, just keyed
 * by a single id instead of a site list. `sortBy` is a closed, three-value set (Due Date / Priority
 * / Recently Assigned, frozen decision 2026-07-10) — never an arbitrary client-supplied column.
 */
export async function listTasks(currentUser: SessionUser, query: ListTasksQuery): Promise<ListTasksResult> {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

  const assignedToUserId = hasGlobalAuthority(currentUser, PERMISSIONS.TASKS_MANAGE)
    ? query.assignedToUserId
    : currentUser.id;

  const where: Prisma.TaskWhereInput = {
    ...(assignedToUserId && { assignedToUserId }),
    ...(query.status && { status: query.status }),
    ...(query.priority && { priority: query.priority }),
  };

  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: { [query.sortBy]: query.sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { total, page, pageSize, tasks };
}

/** Ownership-checked single fetch — also marks this task's unread notifications read for the
 * current user, as a side effect (opening a task clears its own contribution to the badge; see
 * `task-notifications.service.ts`'s doc comment for the reasoning). */
export async function getTask(currentUser: SessionUser, id: string): Promise<TaskWithUsers> {
  const task = await getTaskForMutation(id);
  requireTaskAccess(currentUser, task);

  await markTaskNotificationsRead(id, currentUser.id);

  return task;
}

/**
 * Master-User-only (gated at the route layer via `PERMISSIONS.TASKS_MANAGE`, not re-checked here —
 * this function has no other caller). Creates the task and its initial assignment atomically with
 * the `task.created` audit entry and the `ASSIGNED` notification, so a failure partway never leaves
 * a task with no audit trail or a notification for a task that doesn't exist.
 */
export async function createTask(
  currentUser: SessionUser,
  input: CreateTaskInput,
  requestMeta: RequestMeta,
): Promise<TaskWithUsers> {
  await assertAssignableUser(input.assignedToUserId);

  return prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        assignedToUserId: input.assignedToUserId,
        assignedByUserId: currentUser.id,
        priority: input.priority,
        dueDate: isoDateToUtcDate(input.dueDate),
        module: input.module ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
      },
      include: TASK_INCLUDE,
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'task.created',
        entityType: 'Task',
        entityId: created.id,
        metadata: { title: created.title, assignedToUserId: created.assignedToUserId },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    await createTaskNotification(
      { userId: created.assignedToUserId, taskId: created.id, type: 'ASSIGNED' },
      tx,
    );

    return created;
  });
}

/**
 * Master-User-only. Edits title/description/priority/due date/module/related entity, and/or
 * reassigns — a reassignment is detected implicitly by comparing the submitted `assignedToUserId`
 * against the task's current one (mirrors `updateEmployee`'s own site/unit transfer detection),
 * never a separate endpoint. A reassignment writes `task.reassigned` (+ a `REASSIGNED`
 * notification, + updates `assignedAt`/`assignedByUserId` to reflect the new, current assignment)
 * instead of the generic `task.edited` entry for that specific field; any other fields changed in
 * the same request still produce `task.edited`.
 *
 * **No-op guard**: if the request produces no actual value change (every submitted field already
 * matches the task's current value, and no reassignment), this returns the task unchanged without
 * calling `.update()` at all — `@updatedAt` only fires when Prisma's `.update()` is actually
 * invoked, so skipping the call is what keeps `updatedAt` (and the audit log) honest about a PATCH
 * that changed nothing.
 */
export async function updateTask(
  currentUser: SessionUser,
  id: string,
  input: UpdateTaskInput,
  requestMeta: RequestMeta,
): Promise<TaskWithUsers> {
  const existing = await getTaskForMutation(id);

  const data = mapUpdateInputToTaskData(input);
  const allChanges = diffFields(
    existing as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );
  // `assignedToUserId` gets its own dedicated task.reassigned entry below, exactly like
  // `updateEmployee` omits siteId/unitId from its generic diff for the same reason — never
  // double-logged into the generic task.edited entry too.
  const genericChanges = omitKeys(allChanges, ['assignedToUserId']);
  const isReassignment = 'assignedToUserId' in allChanges;

  if (Object.keys(allChanges).length === 0) {
    // No submitted field actually differs from the task's current value — including this check
    // (rather than checking `data`'s own key count) is what correctly treats "PATCHed with the
    // same value it already had" as a no-op, not just "PATCHed with nothing at all."
    return existing;
  }

  if (isReassignment) {
    await assertAssignableUser(data.assignedToUserId as string);
  }

  return prisma.$transaction(async (tx) => {
    const updateData: Prisma.TaskUncheckedUpdateInput = { ...data };
    if (isReassignment) {
      updateData.assignedByUserId = currentUser.id;
      updateData.assignedAt = new Date();
    }

    const updated = await tx.task.update({ where: { id }, data: updateData, include: TASK_INCLUDE });

    if (isReassignment) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'task.reassigned',
          entityType: 'Task',
          entityId: id,
          metadata: { fromUserId: existing.assignedToUserId, toUserId: data.assignedToUserId },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );

      await createTaskNotification(
        { userId: data.assignedToUserId as string, taskId: id, type: 'REASSIGNED' },
        tx,
      );
    }

    if (Object.keys(genericChanges).length > 0) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'task.edited',
          entityType: 'Task',
          entityId: id,
          metadata: { changes: genericChanges },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    return updated;
  });
}

/** Assignee-or-Master-User (ownership-checked by the caller/route, not re-checked here). Rejects a
 * task that isn't currently `TO_DO` — mirrors `markEmployeeLeft`'s own "already left" 400 guard for
 * an already-terminal state. Notifies `assignedByUserId` (the delegator) that the work is done. */
export async function completeTask(
  currentUser: SessionUser,
  id: string,
  requestMeta: RequestMeta,
): Promise<TaskWithUsers> {
  const existing = await getTaskForMutation(id);
  requireTaskAccess(currentUser, existing);

  if (existing.status !== 'TO_DO') {
    throw badRequest('This task is not To Do — it has already been completed or cancelled');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
      include: TASK_INCLUDE,
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'task.completed',
        entityType: 'Task',
        entityId: id,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    await createTaskNotification(
      { userId: existing.assignedByUserId, taskId: id, type: 'COMPLETED' },
      tx,
    );

    return updated;
  });
}

/** Master-User-only. Only a `TO_DO` task can be cancelled — an already-terminal task (`COMPLETED`
 * or `CANCELLED`) must be reopened first. No notification event exists for cancellation (only
 * ASSIGNED/REASSIGNED/COMPLETED are persisted, per the frozen decision). */
export async function cancelTask(
  currentUser: SessionUser,
  id: string,
  requestMeta: RequestMeta,
): Promise<TaskWithUsers> {
  const existing = await getTaskForMutation(id);

  if (existing.status !== 'TO_DO') {
    throw badRequest('Only a To Do task can be cancelled');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: TASK_INCLUDE,
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'task.cancelled',
        entityType: 'Task',
        entityId: id,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return updated;
  });
}

/** Master-User-only. Reverses `completeTask`/`cancelTask` — only a terminal task (`COMPLETED` or
 * `CANCELLED`) can be reopened; clears `completedAt` unconditionally (a no-op if it was already
 * null, i.e. the task was `CANCELLED` rather than `COMPLETED`). No notification event exists for
 * reopening, per the frozen decision. */
export async function reopenTask(
  currentUser: SessionUser,
  id: string,
  requestMeta: RequestMeta,
): Promise<TaskWithUsers> {
  const existing = await getTaskForMutation(id);

  if (existing.status === 'TO_DO') {
    throw badRequest('This task is already To Do');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: { status: 'TO_DO', completedAt: null },
      include: TASK_INCLUDE,
    });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'task.reopened',
        entityType: 'Task',
        entityId: id,
        metadata: { fromStatus: existing.status },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    return updated;
  });
}

/** Master-User-only. `TaskNotification` rows cascade-delete at the database level (§27a) — no
 * separate cleanup needed here. */
export async function deleteTask(currentUser: SessionUser, id: string, requestMeta: RequestMeta): Promise<void> {
  const existing = await getTaskForMutation(id);

  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id } });

    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'task.deleted',
        entityType: 'Task',
        entityId: id,
        metadata: { title: existing.title, assignedToUserId: existing.assignedToUserId },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );
  });
}
