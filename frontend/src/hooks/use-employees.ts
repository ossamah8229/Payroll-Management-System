import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateEmployeeInput, MarkEmployeeLeftInput, UpdateEmployeeInput } from '@payroll/shared';
import { apiRequest, ApiError, readCookie } from '@/lib/api-client';
import type { ProjectSite } from '@/hooks/use-project-sites';
import type { ProjectUnit } from '@/hooks/use-project-units';
import type { Bank } from '@/hooks/use-banks';

export interface Employee {
  id: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  fatherName: string | null;
  religion: string | null;
  dateOfBirth: string | null;
  mobileNumber: string | null;
  designation: string;
  siteId: string;
  site: ProjectSite;
  unitId: string;
  unit: ProjectUnit;
  dateOfJoining: string | null;
  dateOfLeaving: string | null;
  payType: 'DAILY_WAGE' | 'MONTHLY';
  grossPay: string;
  bankId: string | null;
  bank: Bank | null;
  branchCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  defaultEobiAmount: string;
  defaultEobiApplicable: boolean;
  createdAt: string;
  updatedAt: string;
}

const EMPLOYEES_QUERY_KEY = ['employees'] as const;

export function useEmployees(filters: { siteIds?: string[]; activeOnly?: boolean; search?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.siteIds?.length) params.set('siteIds', filters.siteIds.join(','));
  if (filters.activeOnly) params.set('activeOnly', 'true');
  if (filters.search) params.set('search', filters.search);
  const queryString = params.toString();

  return useQuery({
    queryKey: [...EMPLOYEES_QUERY_KEY, filters],
    queryFn: () =>
      apiRequest<{ employees: Employee[] }>(`/api/v1/employees${queryString ? `?${queryString}` : ''}`).then(
        (res) => res.employees,
      ),
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmployeeInput) =>
      apiRequest<{ employee: Employee }>('/api/v1/employees', { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY_KEY });
    },
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEmployeeInput }) =>
      apiRequest<{ employee: Employee }>(`/api/v1/employees/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY_KEY });
    },
  });
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: [...EMPLOYEES_QUERY_KEY, id],
    queryFn: () => apiRequest<{ employee: Employee }>(`/api/v1/employees/${id}`).then((res) => res.employee),
    enabled: Boolean(id),
  });
}

export interface CnicAvailability {
  exists: boolean;
  employee: {
    id: string;
    name: string;
    employeeCode: string | null;
    siteId: string;
    siteName: string;
    dateOfLeaving: string | null;
    active: boolean;
  } | null;
}

/** The one place the frontend calls the duplicate-check endpoint (docs/architecture/database/schema-invariants.md
 * §26 item 6) — the CNIC field's debounced check and any future consumer share this fetcher rather
 * than each building their own query string/response handling. */
export function checkCnicAvailability(cnic: string, excludeEmployeeId?: string): Promise<CnicAvailability> {
  const params = new URLSearchParams({ cnic });
  if (excludeEmployeeId) params.set('excludeId', excludeEmployeeId);
  return apiRequest<CnicAvailability>(`/api/v1/employees/check-cnic?${params.toString()}`);
}

export function useReactivateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEmployeeInput }) =>
      apiRequest<{ employee: Employee }>(`/api/v1/employees/${id}/reactivate`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY_KEY });
    },
  });
}

/** Triggers a browser download of the export file — bypasses apiRequest since the response is a
 * file, not JSON, and reads the CSRF cookie the same way apiRequest does for consistency. */
export async function downloadEmployeeExport(format: 'csv' | 'xlsx'): Promise<void> {
  const response = await fetch(`/api/v1/employees/export?format=${format}`, { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'Failed to export employees');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `employee-registry.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}

export function useImportEmployees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const csrfToken = readCookie('csrf_token');

      const response = await fetch('/api/v1/employees/import', {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
        body: formData,
      });

      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new ApiError(response.status, payload?.error?.code ?? 'IMPORT_FAILED', payload?.error?.message ?? 'Import failed');
      }
      return payload as ImportResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY_KEY });
    },
  });
}

export function useMarkEmployeeLeft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MarkEmployeeLeftInput }) =>
      apiRequest<{ employee: Employee }>(`/api/v1/employees/${id}/leave`, { method: 'POST', body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY_KEY });
    },
  });
}
