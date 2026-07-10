import { z } from 'zod';
import { emptyToNull, optionalDate, optionalTrimmedString } from './common';

/**
 * Tasks Workspace (docs/architecture/database/tasks.md §27–§27a, Phase 3.5) — the permanent
 * replacement for the previously-planned Team Collaboration/Chat panel. Deliberately lightweight:
 * no subtasks, no dependencies, no recurrence, no comment thread.
 */

export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** Deliberately no `IN_PROGRESS` value — evaluated and rejected as unnecessary granularity for a
 * lightweight delegation list (frozen decision, 2026-07-10). */
export const taskStatusSchema = z.enum(['TO_DO', 'COMPLETED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * Master-User-only (create/assign — `docs/architecture/authentication.md`'s "Tasks: ownership-based
 * visibility" section). `assignedToUserId` is the sole viewer besides Master User once created.
 */
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: optionalTrimmedString(4000),
  assignedToUserId: z.string().uuid('An assignee is required'),
  priority: taskPrioritySchema.default('MEDIUM'),
  dueDate: optionalDate,
  /** Free text, not a native enum — mirrors `AuditLog.entityType`'s own convention (see
   * `docs/architecture/database/tasks.md` §27). */
  module: optionalTrimmedString(60),
  relatedEntityType: optionalTrimmedString(60),
  relatedEntityId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Master-User-only field edit — title/description/priority/due date/module/related entity, and/or
 * a reassignment (`assignedToUserId`), detected implicitly by comparing the submitted value against
 * the task's current one (mirrors `updateEmployeeSchema`'s own site/unit transfer detection) rather
 * than a separate endpoint/schema. An assignee's only mutation is completion, which does not go
 * through this schema at all — see the dedicated complete/cancel/reopen actions (Checkpoint 2).
 */
export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  description: optionalTrimmedString(4000),
  assignedToUserId: z.string().uuid().optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: optionalDate,
  module: optionalTrimmedString(60),
  relatedEntityType: optionalTrimmedString(60),
  relatedEntityId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * `GET /api/v1/tasks` query parameters. `assignedToUserId` is a Master-User-only filter (everyone
 * else is forced to their own id server-side regardless of what's sent here — ownership-based
 * visibility is enforced at the service layer, never trusted from this query alone). `sortBy` is a
 * closed, three-value set (Due Date / Priority / Recently Assigned, frozen decision 2026-07-10) —
 * deliberately not an arbitrary-field sorter.
 */
export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignedToUserId: z.string().uuid().optional(),
  sortBy: z.enum(['dueDate', 'priority', 'assignedAt']).default('assignedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
