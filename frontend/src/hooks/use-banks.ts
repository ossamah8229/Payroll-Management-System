import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/** An employee's own receiving bank — not related to ProjectSite (see use-project-sites.ts). */
export interface Bank {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export function useBanks() {
  return useQuery({
    queryKey: ['banks'] as const,
    queryFn: () => apiRequest<{ banks: Bank[] }>('/api/v1/banks').then((res) => res.banks),
  });
}
