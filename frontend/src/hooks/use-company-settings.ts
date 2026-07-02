import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateCompanySettingsInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

export interface CompanySettings {
  id: string;
  companyName: string;
  registeredAddress: string | null;
  phone: string | null;
  email: string | null;
  logoStorageKey: string | null;
  updatedAt: string;
}

const COMPANY_SETTINGS_QUERY_KEY = ['company-settings'] as const;

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
