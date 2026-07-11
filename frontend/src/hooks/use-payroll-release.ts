import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/** Per-Unit release status for one cycle/site — what the Salary Release page's unit list and
 * confirmation dialog are both built from (docs/architecture/database/release.md §12b). */
export interface UnitReleaseStatus {
  unit: { id: string; name: string; code: string | null; isActive: boolean };
  released: boolean;
  releasedAt: string | null;
  releasedBy: { id: string; name: string } | null;
  entryCount: number;
  willReleaseCount: number;
}

export interface ReleaseUnitResult {
  release: { id: string; cycleId: string; unitId: string; releasedAt: string; releasedById: string };
  releasedEntryCount: number;
}

const unitReleaseStatusQueryKey = (cycleId: string, siteId: string) =>
  ['payroll-unit-release-status', cycleId, siteId] as const;

export function useUnitReleaseStatus(cycleId: string | undefined, siteId: string | undefined) {
  return useQuery({
    queryKey: unitReleaseStatusQueryKey(cycleId ?? '', siteId ?? ''),
    queryFn: () =>
      apiRequest<{ units: UnitReleaseStatus[] }>(
        `/api/v1/payroll-cycles/${cycleId}/units?siteId=${siteId}`,
      ).then((res) => res.units),
    enabled: Boolean(cycleId) && Boolean(siteId),
  });
}

export function useReleaseProjectUnit(cycleId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (unitId: string) =>
      apiRequest<ReleaseUnitResult>(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: unitReleaseStatusQueryKey(cycleId, siteId) });
    },
  });
}
