import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectSiteInput, UpdateProjectSiteInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** A physical client work location — no banking properties (see the schema-level note in
 * backend/prisma/schema.prisma for why ProjectSite has no relationship to Bank). */
export interface ProjectSite {
  id: string;
  name: string;
  branchCode: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const PROJECT_SITES_QUERY_KEY = ['project-sites'] as const;

export function useProjectSites() {
  return useQuery({
    queryKey: PROJECT_SITES_QUERY_KEY,
    queryFn: () => apiRequest<{ sites: ProjectSite[] }>('/api/v1/sites').then((res) => res.sites),
  });
}

export function useCreateProjectSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectSiteInput) =>
      apiRequest<{ site: ProjectSite }>('/api/v1/sites', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECT_SITES_QUERY_KEY });
    },
  });
}

export function useUpdateProjectSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProjectSiteInput }) =>
      apiRequest<{ site: ProjectSite }>(`/api/v1/sites/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECT_SITES_QUERY_KEY });
    },
  });
}

export function useDeleteProjectSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api/v1/sites/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECT_SITES_QUERY_KEY });
    },
  });
}
