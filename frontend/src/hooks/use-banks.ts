import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateBankInput, UpdateBankInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/** An employee's own receiving bank — not related to ProjectSite (see use-project-sites.ts).
 * `isReferenced` is only ever populated by `useAllBanks()` (the admin listing) — it's `false` on
 * `useBanks()`'s plain active list, which callers other than the Bank Registry screen never read. */
export interface Bank {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isReferenced: boolean;
}

const BANKS_QUERY_KEY = ['banks'] as const;
const ALL_BANKS_QUERY_KEY = ['banks', 'all'] as const;

/** Active, generally-selectable banks — Employee Registry / Payroll Entry dropdowns. The reserved
 * Cash record is deliberately excluded server-side (banks.routes.ts/banks.service.ts) since those
 * screens already have their own "Cash"/"None (cash payment)" option; unchanged behavior from
 * before the Bank Registry existed. */
export function useBanks() {
  return useQuery({
    queryKey: BANKS_QUERY_KEY,
    queryFn: () => apiRequest<{ banks: Bank[] }>('/api/v1/banks').then((res) => res.banks),
  });
}

/** Every bank, active or not, including the reserved Cash record — the Bank Registry admin screen
 * (Settings → Banks). The backend independently enforces `banks:manage` for this query mode. */
export function useAllBanks() {
  return useQuery({
    queryKey: ALL_BANKS_QUERY_KEY,
    queryFn: () =>
      apiRequest<{ banks: Bank[] }>('/api/v1/banks?includeInactive=true').then((res) => res.banks),
  });
}

function invalidateBankQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: BANKS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: ALL_BANKS_QUERY_KEY });
}

export function useCreateBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBankInput) =>
      apiRequest<{ bank: Bank }>('/api/v1/banks', { method: 'POST', body: input }),
    onSuccess: () => invalidateBankQueries(queryClient),
  });
}

export function useUpdateBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBankInput }) =>
      apiRequest<{ bank: Bank }>(`/api/v1/banks/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateBankQueries(queryClient),
  });
}

export function useDeleteBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api/v1/banks/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateBankQueries(queryClient),
  });
}
