import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectSiteInput, UpdateProjectSiteInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** A pure client/location record — no banking properties, no operational-unit properties of its
 * own (see the schema-level note in backend/prisma/schema.prisma). `unitLabel` is the term this
 * site's own business uses for its `ProjectUnit`s (e.g. "Branch", "Department", "Section") —
 * drives every place the UI names a unit for this site. */
export interface ProjectSite {
  id: string;
  name: string;
  address: string | null;
  unitLabel: string;
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
