import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 3.5 Checkpoint 2/3 — Tasks Workspace', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.TASKS_MANAGE],
    });
  }

  async function payrollStaffAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [],
    });
  }

  async function createTaskViaApi(
    master: Awaited<ReturnType<typeof masterAdminAgent>>,
    assignedToUserId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await master.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', master.csrfToken)
      .send({ title: 'Test task', assignedToUserId, ...overrides });
    return res;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  it('lets Master User create and assign a task', async () => {
    const master = await masterAdminAgent('tasks-create-master@test.local');
    const staff = await payrollStaffAgent('tasks-create-staff@test.local');

    const res = await createTaskViaApi(master, staff.userId, {
      description: 'Please review this',
      priority: 'HIGH',
      dueDate: '2026-08-01',
    });

    expect(res.status).toBe(201);
    expect(res.body.task.title).toBe('Test task');
    expect(res.body.task.status).toBe('TO_DO');
    expect(res.body.task.priority).toBe('HIGH');
    expect(res.body.task.assignedToUserId).toBe(staff.userId);
    expect(res.body.task.assignedByUserId).toBe(master.userId);
    expect(res.body.task.assignedTo).toMatchObject({ id: staff.userId });
    // The safe-select shape must never leak passwordHash.
    expect(res.body.task.assignedTo.passwordHash).toBeUndefined();

    const auditEntries = await prisma.auditLog.findMany({ where: { action: 'task.created' } });
    expect(auditEntries.some((entry) => entry.entityId === res.body.task.id)).toBe(true);

    const notifications = await prisma.taskNotification.findMany({
      where: { taskId: res.body.task.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ type: 'ASSIGNED', userId: staff.userId, readAt: null });
  });

  it('rejects task creation from a user without tasks:manage', async () => {
    const staffA = await payrollStaffAgent('tasks-create-unauthorized@test.local');
    const staffB = await payrollStaffAgent('tasks-create-unauthorized-target@test.local');

    const res = await staffA.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', staffA.csrfToken)
      .send({ title: 'Should not be created', assignedToUserId: staffB.userId });

    expect(res.status).toBe(403);
  });

  it('rejects assigning a task to a nonexistent user', async () => {
    const master = await masterAdminAgent('tasks-create-badassignee@test.local');

    const res = await createTaskViaApi(master, '00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Ownership boundary
  // ---------------------------------------------------------------------------

  it("blocks a third user from viewing another user's task directly", async () => {
    const master = await masterAdminAgent('tasks-ownership-master@test.local');
    const assignee = await payrollStaffAgent('tasks-ownership-assignee@test.local');
    const outsider = await payrollStaffAgent('tasks-ownership-outsider@test.local');

    const createRes = await createTaskViaApi(master, assignee.userId);
    const taskId = createRes.body.task.id;

    const outsiderRes = await outsider.agent.get(`/api/v1/tasks/${taskId}`);
    expect(outsiderRes.status).toBe(403);

    const assigneeRes = await assignee.agent.get(`/api/v1/tasks/${taskId}`);
    expect(assigneeRes.status).toBe(200);
  });

  it('never returns another user\'s tasks in the list, even via a manipulated assignedToUserId query param (C11 boundary pattern)', async () => {
    const master = await masterAdminAgent('tasks-list-scope-master@test.local');
    const staffA = await payrollStaffAgent('tasks-list-scope-a@test.local');
    const staffB = await payrollStaffAgent('tasks-list-scope-b@test.local');

    await createTaskViaApi(master, staffA.userId, { title: 'Belongs to A' });
    await createTaskViaApi(master, staffB.userId, { title: 'Belongs to B' });

    // staffA tries to see staffB's tasks by manipulating the query param directly.
    const res = await staffA.agent.get(`/api/v1/tasks?assignedToUserId=${staffB.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.tasks.every((t: { title: string }) => t.title === 'Belongs to A')).toBe(true);
    expect(res.body.tasks.some((t: { title: string }) => t.title === 'Belongs to B')).toBe(false);
  });

  it('lets Master User see every task and filter by assignee', async () => {
    const master = await masterAdminAgent('tasks-list-master@test.local');
    const staffA = await payrollStaffAgent('tasks-list-master-a@test.local');
    const staffB = await payrollStaffAgent('tasks-list-master-b@test.local');

    await createTaskViaApi(master, staffA.userId, { title: 'Task A' });
    await createTaskViaApi(master, staffB.userId, { title: 'Task B' });

    const allRes = await master.agent.get('/api/v1/tasks');
    expect(allRes.status).toBe(200);
    expect(allRes.body.tasks.length).toBeGreaterThanOrEqual(2);

    const filteredRes = await master.agent.get(`/api/v1/tasks?assignedToUserId=${staffA.userId}`);
    expect(filteredRes.body.tasks.every((t: { assignedToUserId: string }) => t.assignedToUserId === staffA.userId)).toBe(
      true,
    );
  });

  // ---------------------------------------------------------------------------
  // Notifications: creation, unread count, mark-read
  // ---------------------------------------------------------------------------

  it('increments unread count on assignment and clears it when the task is viewed', async () => {
    const master = await masterAdminAgent('tasks-notif-master@test.local');
    const assignee = await payrollStaffAgent('tasks-notif-assignee@test.local');

    const createRes = await createTaskViaApi(master, assignee.userId);

    const beforeRes = await assignee.agent.get('/api/v1/task-notifications/unread-count');
    expect(beforeRes.body.count).toBe(1);

    await assignee.agent.get(`/api/v1/tasks/${createRes.body.task.id}`);

    const afterRes = await assignee.agent.get('/api/v1/task-notifications/unread-count');
    expect(afterRes.body.count).toBe(0);
  });

  it('mark-all-read clears every unread notification for the current user only', async () => {
    const master = await masterAdminAgent('tasks-notif-all-master@test.local');
    const assignee = await payrollStaffAgent('tasks-notif-all-assignee@test.local');
    const other = await payrollStaffAgent('tasks-notif-all-other@test.local');

    await createTaskViaApi(master, assignee.userId, { title: 'One' });
    await createTaskViaApi(master, assignee.userId, { title: 'Two' });
    await createTaskViaApi(master, other.userId, { title: 'Other person\'s task' });

    expect((await assignee.agent.get('/api/v1/task-notifications/unread-count')).body.count).toBe(2);

    const markRes = await assignee.agent
      .patch('/api/v1/task-notifications/read-all')
      .set('x-csrf-token', assignee.csrfToken);
    expect(markRes.status).toBe(204);

    expect((await assignee.agent.get('/api/v1/task-notifications/unread-count')).body.count).toBe(0);
    // Unrelated user's own unread notification is untouched.
    expect((await other.agent.get('/api/v1/task-notifications/unread-count')).body.count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Update: generic edit, no-op guard, reassignment
  // ---------------------------------------------------------------------------

  it('edits a task and records task.edited with the real field diff', async () => {
    const master = await masterAdminAgent('tasks-edit-master@test.local');
    const assignee = await payrollStaffAgent('tasks-edit-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId, { priority: 'LOW' });

    const updateRes = await master.agent
      .patch(`/api/v1/tasks/${createRes.body.task.id}`)
      .set('x-csrf-token', master.csrfToken)
      .send({ priority: 'HIGH', title: 'Updated title' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.task.priority).toBe('HIGH');
    expect(updateRes.body.task.title).toBe('Updated title');

    const entries = await prisma.auditLog.findMany({
      where: { action: 'task.edited', entityId: createRes.body.task.id },
    });
    expect(entries).toHaveLength(1);
    const changes = entries[0]!.metadata as { changes: Record<string, unknown> };
    expect(changes.changes).toHaveProperty('priority');
    expect(changes.changes).toHaveProperty('title');
  });

  it('does not write an audit entry or bump updatedAt when a PATCH produces no effective change', async () => {
    const master = await masterAdminAgent('tasks-noop-master@test.local');
    const assignee = await payrollStaffAgent('tasks-noop-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId, { priority: 'MEDIUM' });
    const before = await prisma.task.findUniqueOrThrow({ where: { id: createRes.body.task.id } });

    // Wait a tick so a real updatedAt bump (if it happened) would be observably different.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const updateRes = await master.agent
      .patch(`/api/v1/tasks/${createRes.body.task.id}`)
      .set('x-csrf-token', master.csrfToken)
      .send({ priority: 'MEDIUM', title: createRes.body.task.title });

    expect(updateRes.status).toBe(200);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: createRes.body.task.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const entries = await prisma.auditLog.findMany({
      where: { action: 'task.edited', entityId: createRes.body.task.id },
    });
    expect(entries).toHaveLength(0);
  });

  it('reassigns a task via the ordinary PATCH endpoint, producing task.reassigned (not task.edited) plus a REASSIGNED notification', async () => {
    const master = await masterAdminAgent('tasks-reassign-master@test.local');
    const originalAssignee = await payrollStaffAgent('tasks-reassign-original@test.local');
    const newAssignee = await payrollStaffAgent('tasks-reassign-new@test.local');
    const createRes = await createTaskViaApi(master, originalAssignee.userId);
    const taskId = createRes.body.task.id;
    const originalAssignedAt = createRes.body.task.assignedAt;

    await new Promise((resolve) => setTimeout(resolve, 20));

    const updateRes = await master.agent
      .patch(`/api/v1/tasks/${taskId}`)
      .set('x-csrf-token', master.csrfToken)
      .send({ assignedToUserId: newAssignee.userId });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.task.assignedToUserId).toBe(newAssignee.userId);
    expect(updateRes.body.task.assignedByUserId).toBe(master.userId);
    expect(new Date(updateRes.body.task.assignedAt).getTime()).toBeGreaterThan(
      new Date(originalAssignedAt).getTime(),
    );

    const reassignedEntries = await prisma.auditLog.findMany({
      where: { action: 'task.reassigned', entityId: taskId },
    });
    expect(reassignedEntries).toHaveLength(1);
    const editedEntries = await prisma.auditLog.findMany({
      where: { action: 'task.edited', entityId: taskId },
    });
    expect(editedEntries).toHaveLength(0);

    const notifications = await prisma.taskNotification.findMany({
      where: { taskId, type: 'REASSIGNED' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.userId).toBe(newAssignee.userId);

    // The original assignee has lost access; the new assignee has gained it.
    expect((await originalAssignee.agent.get(`/api/v1/tasks/${taskId}`)).status).toBe(403);
    expect((await newAssignee.agent.get(`/api/v1/tasks/${taskId}`)).status).toBe(200);
  });

  it('writes both task.reassigned and task.edited when a single PATCH changes the assignee and another field', async () => {
    const master = await masterAdminAgent('tasks-reassign-combo-master@test.local');
    const originalAssignee = await payrollStaffAgent('tasks-reassign-combo-original@test.local');
    const newAssignee = await payrollStaffAgent('tasks-reassign-combo-new@test.local');
    const createRes = await createTaskViaApi(master, originalAssignee.userId, { priority: 'LOW' });
    const taskId = createRes.body.task.id;

    await master.agent
      .patch(`/api/v1/tasks/${taskId}`)
      .set('x-csrf-token', master.csrfToken)
      .send({ assignedToUserId: newAssignee.userId, priority: 'HIGH' });

    expect(await prisma.auditLog.count({ where: { action: 'task.reassigned', entityId: taskId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'task.edited', entityId: taskId } })).toBe(1);
  });

  it('rejects an assignee editing a task', async () => {
    const master = await masterAdminAgent('tasks-edit-assignee-block-master@test.local');
    const assignee = await payrollStaffAgent('tasks-edit-assignee-block-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);

    const res = await assignee.agent
      .patch(`/api/v1/tasks/${createRes.body.task.id}`)
      .set('x-csrf-token', assignee.csrfToken)
      .send({ title: 'Assignee should not be able to do this' });

    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Lifecycle: complete / cancel / reopen / delete
  // ---------------------------------------------------------------------------

  it('lets the assignee complete their own task, notifying the delegator', async () => {
    const master = await masterAdminAgent('tasks-complete-master@test.local');
    const assignee = await payrollStaffAgent('tasks-complete-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);
    const taskId = createRes.body.task.id;

    const res = await assignee.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set('x-csrf-token', assignee.csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('COMPLETED');
    expect(res.body.task.completedAt).not.toBeNull();

    expect(await prisma.auditLog.count({ where: { action: 'task.completed', entityId: taskId } })).toBe(1);
    const notifications = await prisma.taskNotification.findMany({ where: { taskId, type: 'COMPLETED' } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.userId).toBe(master.userId);
  });

  it('rejects completing an already-completed task', async () => {
    const master = await masterAdminAgent('tasks-complete-twice-master@test.local');
    const assignee = await payrollStaffAgent('tasks-complete-twice-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);
    const taskId = createRes.body.task.id;

    await assignee.agent.post(`/api/v1/tasks/${taskId}/complete`).set('x-csrf-token', assignee.csrfToken);
    const secondRes = await assignee.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set('x-csrf-token', assignee.csrfToken);

    expect(secondRes.status).toBe(400);
  });

  it("rejects a user completing another user's task", async () => {
    const master = await masterAdminAgent('tasks-complete-block-master@test.local');
    const assignee = await payrollStaffAgent('tasks-complete-block-assignee@test.local');
    const outsider = await payrollStaffAgent('tasks-complete-block-outsider@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);

    const res = await outsider.agent
      .post(`/api/v1/tasks/${createRes.body.task.id}/complete`)
      .set('x-csrf-token', outsider.csrfToken);

    expect(res.status).toBe(403);
  });

  it('lets Master User cancel a To Do task; rejects the assignee doing the same', async () => {
    const master = await masterAdminAgent('tasks-cancel-master@test.local');
    const assignee = await payrollStaffAgent('tasks-cancel-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);
    const taskId = createRes.body.task.id;

    const blockedRes = await assignee.agent
      .post(`/api/v1/tasks/${taskId}/cancel`)
      .set('x-csrf-token', assignee.csrfToken);
    expect(blockedRes.status).toBe(403);

    const res = await master.agent.post(`/api/v1/tasks/${taskId}/cancel`).set('x-csrf-token', master.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('CANCELLED');
    expect(await prisma.auditLog.count({ where: { action: 'task.cancelled', entityId: taskId } })).toBe(1);
  });

  it('rejects cancelling a non-To-Do task', async () => {
    const master = await masterAdminAgent('tasks-cancel-nontodo-master@test.local');
    const assignee = await payrollStaffAgent('tasks-cancel-nontodo-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);
    const taskId = createRes.body.task.id;

    await master.agent.post(`/api/v1/tasks/${taskId}/cancel`).set('x-csrf-token', master.csrfToken);
    const res = await master.agent.post(`/api/v1/tasks/${taskId}/cancel`).set('x-csrf-token', master.csrfToken);

    expect(res.status).toBe(400);
  });

  it('lets Master User reopen a completed or cancelled task, clearing completedAt', async () => {
    const master = await masterAdminAgent('tasks-reopen-master@test.local');
    const assignee = await payrollStaffAgent('tasks-reopen-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);
    const taskId = createRes.body.task.id;

    await assignee.agent.post(`/api/v1/tasks/${taskId}/complete`).set('x-csrf-token', assignee.csrfToken);

    const res = await master.agent.post(`/api/v1/tasks/${taskId}/reopen`).set('x-csrf-token', master.csrfToken);
    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('TO_DO');
    expect(res.body.task.completedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'task.reopened', entityId: taskId } })).toBe(1);
  });

  it('rejects reopening a task that is already To Do', async () => {
    const master = await masterAdminAgent('tasks-reopen-todo-master@test.local');
    const assignee = await payrollStaffAgent('tasks-reopen-todo-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);

    const res = await master.agent
      .post(`/api/v1/tasks/${createRes.body.task.id}/reopen`)
      .set('x-csrf-token', master.csrfToken);

    expect(res.status).toBe(400);
  });

  it('lets Master User delete a task, cascading its notifications; rejects the assignee doing the same', async () => {
    const master = await masterAdminAgent('tasks-delete-master@test.local');
    const assignee = await payrollStaffAgent('tasks-delete-assignee@test.local');
    const createRes = await createTaskViaApi(master, assignee.userId);
    const taskId = createRes.body.task.id;

    const blockedRes = await assignee.agent
      .delete(`/api/v1/tasks/${taskId}`)
      .set('x-csrf-token', assignee.csrfToken);
    expect(blockedRes.status).toBe(403);

    const res = await master.agent.delete(`/api/v1/tasks/${taskId}`).set('x-csrf-token', master.csrfToken);
    expect(res.status).toBe(204);

    expect(await prisma.task.findUnique({ where: { id: taskId } })).toBeNull();
    expect(await prisma.taskNotification.findMany({ where: { taskId } })).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: 'task.deleted', entityId: taskId } })).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Filtering, sorting, pagination
  // ---------------------------------------------------------------------------

  it('filters by status and priority', async () => {
    const master = await masterAdminAgent('tasks-filter-master@test.local');
    const assignee = await payrollStaffAgent('tasks-filter-assignee@test.local');
    const lowRes = await createTaskViaApi(master, assignee.userId, { priority: 'LOW', title: 'Low task' });
    await createTaskViaApi(master, assignee.userId, { priority: 'HIGH', title: 'High task' });
    await master.agent
      .post(`/api/v1/tasks/${lowRes.body.task.id}/cancel`)
      .set('x-csrf-token', master.csrfToken);

    const priorityRes = await master.agent.get('/api/v1/tasks?priority=HIGH');
    expect(priorityRes.body.tasks.every((t: { priority: string }) => t.priority === 'HIGH')).toBe(true);

    const statusRes = await master.agent.get('/api/v1/tasks?status=CANCELLED');
    expect(statusRes.body.tasks.every((t: { status: string }) => t.status === 'CANCELLED')).toBe(true);
    expect(statusRes.body.tasks.some((t: { id: string }) => t.id === lowRes.body.task.id)).toBe(true);
  });

  it('sorts by dueDate, priority, and assignedAt in both directions', async () => {
    const master = await masterAdminAgent('tasks-sort-master@test.local');
    const assignee = await payrollStaffAgent('tasks-sort-assignee@test.local');

    await createTaskViaApi(master, assignee.userId, { title: 'Earliest', dueDate: '2026-08-01', priority: 'LOW' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await createTaskViaApi(master, assignee.userId, { title: 'Latest', dueDate: '2026-09-01', priority: 'HIGH' });

    const byDueDateAsc = await master.agent.get('/api/v1/tasks?sortBy=dueDate&sortDir=asc');
    const dueDateTitles = byDueDateAsc.body.tasks.map((t: { title: string }) => t.title);
    expect(dueDateTitles.indexOf('Earliest')).toBeLessThan(dueDateTitles.indexOf('Latest'));

    const byPriorityDesc = await master.agent.get('/api/v1/tasks?sortBy=priority&sortDir=desc');
    const priorityTitles = byPriorityDesc.body.tasks.map((t: { title: string }) => t.title);
    expect(priorityTitles.indexOf('Latest')).toBeLessThan(priorityTitles.indexOf('Earliest'));

    const byAssignedAtDesc = await master.agent.get('/api/v1/tasks?sortBy=assignedAt&sortDir=desc');
    const assignedAtTitles = byAssignedAtDesc.body.tasks.map((t: { title: string }) => t.title);
    expect(assignedAtTitles.indexOf('Latest')).toBeLessThan(assignedAtTitles.indexOf('Earliest'));
  });

  it('paginates results', async () => {
    const master = await masterAdminAgent('tasks-page-master@test.local');
    const assignee = await payrollStaffAgent('tasks-page-assignee@test.local');

    for (let i = 0; i < 5; i += 1) {
      await createTaskViaApi(master, assignee.userId, { title: `Page task ${i}` });
    }

    const page1 = await master.agent.get('/api/v1/tasks?page=1&pageSize=2');
    expect(page1.body.tasks).toHaveLength(2);
    expect(page1.body.total).toBeGreaterThanOrEqual(5);

    const page2 = await master.agent.get('/api/v1/tasks?page=2&pageSize=2');
    expect(page2.body.tasks).toHaveLength(2);
    expect(page2.body.tasks[0].id).not.toBe(page1.body.tasks[0].id);
  });
});
