import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTaskInput, TaskPriority, TaskStatus, UpdateTaskInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** Tasks Workspace (docs/architecture/database/tasks.md §27, Phase 3.5) — the permanent
 * replacement for the previously-planned Team Collaboration/Chat panel. Ownership-based
 * visibility: the backend itself enforces "Master User sees every task, the assignee sees only
 * their own" — this hook never re-implements that scoping client-side, it only renders whatever
 * the already-scoped endpoint returns, the same discipline every other module's hooks follow. */

export interface TaskUserRef {
  id: string;
  name: string;
  email: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  assignedToUserId: string;
  assignedByUserId: string;
  assignedAt: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  module: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assignedTo: TaskUserRef;
  assignedBy: TaskUserRef;
}

export type TaskSortBy = 'dueDate' | 'priority' | 'assignedAt';
export type TaskSortDir = 'asc' | 'desc';

export interface TasksFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToUserId?: string;
  sortBy?: TaskSortBy;
  sortDir?: TaskSortDir;
  page?: number;
  pageSize?: number;
}

interface ListTasksResponse {
  total: number;
  page: number;
  pageSize: number;
  tasks: Task[];
}

const TASKS_QUERY_KEY = ['tasks'] as const;
const UNREAD_COUNT_QUERY_KEY = ['tasks', 'unread-count'] as const;

function tasksQueryKey(filters: TasksFilters) {
  return [...TASKS_QUERY_KEY, filters] as const;
}

function buildQueryString(filters: TasksFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.assignedToUserId) params.set('assignedToUserId', filters.assignedToUserId);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortDir) params.set('sortDir', filters.sortDir);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  return params.toString();
}

/** Fetches one page of tasks per the given filters — pagination is "Load more," not numbered
 * pages, to fit the panel's own narrow (340px) width; the caller accumulates pages itself (see
 * `TasksPanel`), this hook only ever fetches exactly the page it's asked for. */
export function useTasks(filters: TasksFilters) {
  return useQuery({
    queryKey: tasksQueryKey(filters),
    queryFn: () => apiRequest<ListTasksResponse>(`/api/v1/tasks?${buildQueryString(filters)}`),
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: [...TASKS_QUERY_KEY, id],
    queryFn: () => apiRequest<{ task: Task }>(`/api/v1/tasks/${id}`).then((res) => res.task),
    enabled: Boolean(id),
  });
}

/** The Tasks panel's notification badge — plain polling, no WebSockets/SSE
 * (`docs/architecture/authentication.md`'s Postgres-over-Redis reasoning applies identically to
 * realtime delivery here). 30s is frequent enough to feel live for a lightweight in-app badge
 * without polling aggressively for a single-digit-to-low-double-digit user base. */
export function useUnreadTaskNotificationCount(enabled: boolean) {
  return useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: () => apiRequest<{ count: number }>('/api/v1/task-notifications/unread-count').then((res) => res.count),
    refetchInterval: 30_000,
    enabled,
  });
}

function invalidateTaskQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
}

/** Master-User-only (the backend rejects anyone else with 403) — create + initial assignment.
 * Invalidates rather than merges: the panel's own "Load more" accumulation has no single bounded
 * row set to patch in place, the same reasoning `useBulkUpdatePayrollEntries` already uses for an
 * analogous "more rows than are ever all in memory at once" case. */
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      apiRequest<{ task: Task }>('/api/v1/tasks', { method: 'POST', body: input }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
}

/** Master-User-only. A reassignment is just a changed `assignedToUserId` in the same body — no
 * separate mutation/endpoint, matching how the backend detects it implicitly. */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      apiRequest<{ task: Task }>(`/api/v1/tasks/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
}

/** Assignee-or-Master-User (ownership-checked server-side). */
export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ task: Task }>(`/api/v1/tasks/${id}/complete`, { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
}

export function useCancelTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ task: Task }>(`/api/v1/tasks/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
}

export function useReopenTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ task: Task }>(`/api/v1/tasks/${id}/reopen`, { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api/v1/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
}

export function useMarkAllTaskNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>('/api/v1/task-notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.setQueryData(UNREAD_COUNT_QUERY_KEY, 0);
    },
  });
}
