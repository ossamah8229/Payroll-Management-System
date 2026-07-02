import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { ChangePasswordInput, LoginInput, SessionUser, UpdateProfileInput } from '@payroll/shared';
import { apiRequest, ApiError } from '@/lib/api-client';

const SESSION_QUERY_KEY = ['session', 'me'] as const;

/**
 * The frontend's session bootstrap query — GET /api/v1/auth/me. A 401 is a normal, expected
 * outcome (not logged in yet), not an error state the UI should display, so it's translated to
 * `null` here rather than left for the caller to special-case.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        const { user } = await apiRequest<{ user: SessionUser }>('/api/v1/auth/me');
        return user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiRequest<{ user: SessionUser }>('/api/v1/auth/login', { method: 'POST', body: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, data.user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiRequest<void>('/api/v1/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      apiRequest<{ user: SessionUser }>('/api/v1/auth/me', { method: 'PATCH', body: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, data.user);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiRequest<void>('/api/v1/auth/change-password', { method: 'POST', body: input }),
  });
}
