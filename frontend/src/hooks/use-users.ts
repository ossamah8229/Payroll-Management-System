import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUserInput, ResetUserPasswordInput, UpdateUserInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';
import type { ProjectSite } from '@/hooks/use-project-sites';

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  role: { id: string; code: string; name: string };
  siteAssignments: { siteId: string; site: ProjectSite }[];
}

const USERS_QUERY_KEY = ['users'] as const;

/** `GET /api/v1/users` is gated by `users:manage` server-side — a caller that only conditionally
 * needs the list (e.g. the Tasks Workspace's Master-User-only "Assign to" picker, Phase 3.5) should
 * pass `enabled: false` for any session that doesn't hold that permission, rather than let the
 * request fire and 403. Defaults to `true` so every existing caller (User Management itself) is
 * unaffected. */
export function useUsers(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: () => apiRequest<{ users: ManagedUser[] }>('/api/v1/users').then((res) => res.users),
    enabled: options.enabled ?? true,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiRequest<{ user: ManagedUser }>('/api/v1/users', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      apiRequest<{ user: ManagedUser }>(`/api/v1/users/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResetUserPasswordInput }) =>
      apiRequest<void>(`/api/v1/users/${id}/reset-password`, { method: 'POST', body: input }),
  });
}
