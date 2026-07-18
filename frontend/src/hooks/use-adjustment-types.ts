import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/** The Corrections domain's own lookup table (`AdjustmentType`) — active types only, matching
 * `useBanks()`'s own "active, generally-selectable" convention. Used by the correction-request
 * creation form's Adjustment Type dropdown (Phase 6 Checkpoint 6). */
export interface AdjustmentType {
  id: string;
  code: string;
  label: string;
}

const ADJUSTMENT_TYPES_QUERY_KEY = ['adjustment-types'] as const;

export function useAdjustmentTypes() {
  return useQuery({
    queryKey: ADJUSTMENT_TYPES_QUERY_KEY,
    queryFn: () =>
      apiRequest<{ adjustmentTypes: AdjustmentType[] }>('/api/v1/adjustment-types').then(
        (res) => res.adjustmentTypes,
      ),
  });
}
