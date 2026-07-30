import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateCompanySettingsInput } from '@payroll/shared';
import { API_BASE_URL, apiRequest, getCsrfToken, ApiError } from '@/lib/api-client';

export interface CompanySettings {
  id: string;
  companyName: string;
  registeredAddress: string | null;
  phone: string | null;
  email: string | null;
  /** Never a storage key (Phase 7C — backend's own `serializeCompanySettings` strips it before
   * this ever reaches the frontend). Whether to attempt loading the real logo image (the public
   * `/company/logo/ui` or `/company/logo/print` routes) or fall back to `LogoPlaceholder`. */
  hasLogo: boolean;
  updatedAt: string;
}

const COMPANY_SETTINGS_QUERY_KEY = ['company-settings'] as const;

/** The public, unauthenticated image routes (`backend/src/modules/settings/company-logo-public.routes.ts`)
 * — safe to reference directly in an `<img src>` from anywhere, including the pre-session Login
 * page. `ui` is for on-screen display (login, sidebar, Settings preview); `print` is for the
 * print-only document headers (`PrintContextHeader`, Cash Receiving's own document header). */
export const COMPANY_LOGO_UI_URL = `${API_BASE_URL}/api/v1/settings/company/logo/ui`;
export const COMPANY_LOGO_PRINT_URL = `${API_BASE_URL}/api/v1/settings/company/logo/print`;

export function useCompanySettings() {
  return useQuery({
    queryKey: COMPANY_SETTINGS_QUERY_KEY,
    queryFn: () =>
      apiRequest<{ settings: CompanySettings }>('/api/v1/settings/company').then((res) => res.settings),
  });
}

export function useUpdateCompanySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCompanySettingsInput) =>
      apiRequest<{ settings: CompanySettings }>('/api/v1/settings/company', {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
    },
  });
}

/**
 * Multipart upload bypasses `apiRequest` (JSON-only, per its own doc comment) exactly the way
 * `use-employees.ts`'s CSV import already does — same pattern: attach the CSRF token manually via
 * `getCsrfToken()`, always send credentials, and normalize the backend's `{ error: { code,
 * message } }` shape into the same `ApiError` `apiRequest` throws so every caller's existing
 * `error instanceof ApiError` handling keeps working unchanged.
 */
export function useUploadCompanyLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const csrfToken = getCsrfToken();
      const response = await fetch(`${API_BASE_URL}/api/v1/settings/company/logo`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
        body: formData,
      });

      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new ApiError(
          response.status,
          payload?.error?.code ?? 'UNKNOWN_ERROR',
          payload?.error?.message ?? `Request failed with status ${response.status}`,
        );
      }
      return payload as { settings: CompanySettings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
    },
  });
}

export function useRemoveCompanyLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ settings: CompanySettings }>('/api/v1/settings/company/logo', { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
    },
  });
}
