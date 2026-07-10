import { Router } from 'express';
import { createTaskSchema, listTasksQuerySchema, PERMISSIONS, updateTaskSchema } from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import {
  cancelTask,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  reopenTask,
  updateTask,
} from './tasks.service';
import { getUnreadNotificationCount, markAllNotificationsRead } from './task-notifications.service';

/**
 * Tasks Workspace (docs/architecture/database/tasks.md §27, Phase 3.5). Route handlers stay thin —
 * parse/validate the request, delegate to the service layer, translate the result to a response.
 * No Prisma call of any kind happens in this file; every mutation goes through
 * `tasks.service.ts`/`task-notifications.service.ts`.
 *
 * Master-User-only actions (create/edit/cancel/reopen/delete) are gated by
 * `requirePermission(PERMISSIONS.TASKS_MANAGE)`. List/get/complete carry no permission gate at
 * all — ownership-based visibility is enforced inside the service layer
 * (`requireTaskAccess`/the list query's own scoping), not by a permission grant, per
 * `docs/architecture/authentication.md`'s "Tasks: ownership-based visibility" section.
 */

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get('/', async (req, res, next) => {
  try {
    const query = listTasksQuerySchema.parse(req.query);
    const result = await listTasks(req.currentUser!, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

tasksRouter.get('/:id', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const task = await getTask(req.currentUser!, id);
    res.status(200).json({ task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/', requirePermission(PERMISSIONS.TASKS_MANAGE), async (req, res, next) => {
  try {
    const input = createTaskSchema.parse(req.body);
    const task = await createTask(req.currentUser!, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

// Reassignment is an implicit part of this same PATCH (a changed `assignedToUserId` in the body),
// never a separate route — see tasks.service.ts's updateTask doc comment.
tasksRouter.patch('/:id', requirePermission(PERMISSIONS.TASKS_MANAGE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updateTaskSchema.parse(req.body);
    const task = await updateTask(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ task });
  } catch (error) {
    next(error);
  }
});

// Assignee-or-Master-User — ownership-checked inside completeTask, not gated by a permission.
tasksRouter.post('/:id/complete', async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const task = await completeTask(req.currentUser!, id, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/:id/cancel', requirePermission(PERMISSIONS.TASKS_MANAGE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const task = await cancelTask(req.currentUser!, id, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/:id/reopen', requirePermission(PERMISSIONS.TASKS_MANAGE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const task = await reopenTask(req.currentUser!, id, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.delete('/:id', requirePermission(PERMISSIONS.TASKS_MANAGE), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    await deleteTask(req.currentUser!, id, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** Mounted separately at /api/v1/task-notifications — a distinct resource from /tasks itself,
 * mirroring how work-line mutations get their own top-level router in the Payroll Entry module. */
export const taskNotificationsRouter = Router();

taskNotificationsRouter.use(requireAuth);

taskNotificationsRouter.get('/unread-count', async (req, res, next) => {
  try {
    const count = await getUnreadNotificationCount(req.currentUser!.id);
    res.status(200).json({ count });
  } catch (error) {
    next(error);
  }
});

taskNotificationsRouter.patch('/read-all', async (req, res, next) => {
  try {
    await markAllNotificationsRead(req.currentUser!.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
