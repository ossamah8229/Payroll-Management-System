import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectUnitInput, UpdateProjectUnitInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** The operational sub-division of a ProjectSite an employee is deputed to (a specific branch,
 * department, section, etc.) — always displayed using the owning site's own `unitLabel`, never
 * the literal word "Unit" (docs/architecture/database/sites-and-units.md §8a). */
export interface ProjectUnit {
  id: string;
  siteId: string;
  name: string;
  code: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const projectUnitsQueryKey = (siteId: string) => ['project-units', siteId] as const;

export function useProjectUnits(siteId: string | undefined) {
  return useQuery({
    queryKey: projectUnitsQueryKey(siteId ?? ''),
    queryFn: () =>
      apiRequest<{ units: ProjectUnit[] }>(`/api/v1/sites/${siteId}/units`).then((res) => res.units),
    enabled: Boolean(siteId),
  });
}

export function useCreateProjectUnit(siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectUnitInput) =>
      apiRequest<{ unit: ProjectUnit }>(`/api/v1/sites/${siteId}/units`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectUnitsQueryKey(siteId) });
    },
  });
}

export function useUpdateProjectUnit(siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProjectUnitInput }) =>
      apiRequest<{ unit: ProjectUnit }>(`/api/v1/units/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectUnitsQueryKey(siteId) });
    },
  });
}

export function useDeleteProjectUnit(siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api/v1/units/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectUnitsQueryKey(siteId) });
    },
  });
}
