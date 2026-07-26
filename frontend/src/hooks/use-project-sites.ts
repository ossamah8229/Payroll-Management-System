import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_CODES, type CreateProjectSiteInput, type SessionUser, type UpdateProjectSiteInput } from '@payroll/shared';
import { apiRequest, API_BASE_URL, ApiError, getCsrfToken } from '@/lib/api-client';

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

/**
 * `GET /api/v1/sites` deliberately gives a `sites:manage` holder (or Master Admin) unrestricted
 * visibility (docs/architecture/authentication.md's "UAT Defect 1 correction") — correct for the
 * Project Sites *administration* page, and harmless for a general filter/dropdown consumed by a
 * user with no global authority of any kind (they still only get their own assigned sites back).
 * It becomes misleading for a site-scoped *operational* module (Employees, Payroll Entry, Advances,
 * Bank Sheets, Cash Receiving, Payslips, Corrections — every one of which stays strictly scoped to
 * `UserSiteAssignment` rows regardless of `sites:manage`, System-Wide RBAC Consistency remediation's
 * permission/scope matrix) consumed by a user who *also* happens to hold `sites:manage`: they would
 * see every site in the org in that module's own site picker/filter, even though selecting one they
 * aren't assigned to yields zero records — a create-is-broader-than-list hybrid. This hook narrows
 * the shared lookup back down to the user's own real operational scope for exactly those
 * consumers — Master Admin still sees every site (their own bypass is unconditional everywhere);
 * everyone else, including a `sites:manage` holder, sees only `user.siteIds`. The Project Sites
 * admin page and User site-assignment picker intentionally keep using the raw `useProjectSites()`
 * above instead, since both of those genuinely want the unrestricted, `sites:manage`-aware list.
 */
export function useAccessibleProjectSites(user: SessionUser) {
  const sites = useProjectSites();
  const data = useMemo(() => {
    if (!sites.data) return sites.data;
    if (user.roleCode === ROLE_CODES.MASTER_ADMIN) return sites.data;
    return sites.data.filter((site) => user.siteIds.includes(site.id));
  }, [sites.data, user]);

  return { ...sites, data };
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

/** Import Template Contract checkpoint (Project Site extension) — a blank template with the exact
 * required header set, one sample row, and an Instructions sheet
 * (`generateProjectSiteImportTemplate`, backend). Same download mechanics as the Employee
 * Registry's own `downloadEmployeeImportTemplate` (`use-employees.ts`). */
export async function downloadProjectSiteImportTemplate(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sites/import-template`, { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, 'TEMPLATE_DOWNLOAD_FAILED', 'Failed to download the import template');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'project-site-import-template.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}

export interface ProjectSiteImportResult {
  created: number;
  skipped: { row: number; reason: string }[];
}

export function useImportProjectSites() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const csrfToken = getCsrfToken();

      const response = await fetch(`${API_BASE_URL}/api/v1/sites/import`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
        body: formData,
      });

      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new ApiError(response.status, payload?.error?.code ?? 'IMPORT_FAILED', payload?.error?.message ?? 'Import failed');
      }
      return payload as ProjectSiteImportResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECT_SITES_QUERY_KEY });
    },
  });
}
