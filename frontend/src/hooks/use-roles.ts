import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoleInput, DuplicateRoleInput, UpdateRoleInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/**
 * Administration & Security Management Phase 1 — mirrors `use-users.ts`'s own conventions exactly
 * (same query-key/invalidation shape) for the new `/api/v1/roles` API. `RoleSummary` and
 * `PermissionCatalogEntry` are this hook's own frontend-facing shapes, matching what
 * `roles.routes.ts`/`roles.service.ts` actually return — not re-derived from any hardcoded
 * frontend list.
 */
export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystemRole: boolean;
  permissionCount: number;
  assignedUserCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDetail extends RoleSummary {
  permissionKeys: string[];
}

export interface PermissionCatalogEntry {
  id: string;
  key: string;
  label: string;
  group: string;
  action: string;
}

export interface RoleUserSummary {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

const ROLES_QUERY_KEY = ['roles'] as const;
const ROLE_DETAIL_QUERY_KEY = (id: string) => ['roles', id] as const;
const ROLE_USERS_QUERY_KEY = (id: string) => ['roles', id, 'users'] as const;
const PERMISSION_CATALOG_QUERY_KEY = ['roles', 'permissions'] as const;

export function useRoles(options: { includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: [...ROLES_QUERY_KEY, options.includeInactive ?? false],
    queryFn: () =>
      apiRequest<{ roles: RoleSummary[] }>(
        `/api/v1/roles${options.includeInactive ? '?includeInactive=true' : ''}`,
      ).then((res) => res.roles),
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: ROLE_DETAIL_QUERY_KEY(id ?? ''),
    queryFn: () => apiRequest<{ role: RoleDetail }>(`/api/v1/roles/${id}`).then((res) => res.role),
    enabled: Boolean(id),
  });
}

export function useRoleUsers(id: string | undefined) {
  return useQuery({
    queryKey: ROLE_USERS_QUERY_KEY(id ?? ''),
    queryFn: () => apiRequest<{ users: RoleUserSummary[] }>(`/api/v1/roles/${id}/users`).then((res) => res.users),
    enabled: Boolean(id),
  });
}

/** The permission catalog — every real `Permission` row, grouped for display. Rarely changes
 * within a session, so a long `staleTime` avoids a redundant refetch every time the role editor
 * opens. */
export function usePermissionCatalog() {
  return useQuery({
    queryKey: PERMISSION_CATALOG_QUERY_KEY,
    queryFn: () =>
      apiRequest<{ permissions: PermissionCatalogEntry[] }>('/api/v1/roles/permissions').then((res) => res.permissions),
    staleTime: 5 * 60_000,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoleInput) =>
      apiRequest<{ role: RoleDetail }>('/api/v1/roles', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRoleInput }) =>
      apiRequest<{ role: RoleDetail }>(`/api/v1/roles/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ROLE_DETAIL_QUERY_KEY(variables.id) });
    },
  });
}

export function useDuplicateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DuplicateRoleInput }) =>
      apiRequest<{ role: RoleDetail }>(`/api/v1/roles/${id}/duplicate`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api/v1/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}
