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
  role: { code: string; name: string };
  siteAssignments: { siteId: string; site: ProjectSite }[];
}

const USERS_QUERY_KEY = ['users'] as const;

export function useUsers() {
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: () => apiRequest<{ users: ManagedUser[] }>('/api/v1/users').then((res) => res.users),
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
