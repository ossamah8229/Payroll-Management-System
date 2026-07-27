import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { payrollEntriesQueryKey } from '@/hooks/use-payroll-entries';
import { ADVANCES_QUERY_KEY } from '@/hooks/use-advances';

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
  /** Entries actually paid — `netSalary > 0` (Negative Payroll Recovery checkpoint, 2026-07-26). */
  releasedEntryCount: number;
  /** `netSalary = 0` — no payment due. */
  noPayDueCount: number;
  /** `netSalary < 0` — a `BalanceAdjustment(type: RECOVERY)` was created for each. */
  recoveryDueCount: number;
  /** Excluded from this release entirely — duplicate identity/payment-destination data or missing
   * required banking details. Still blocks Finalize until fixed or manually held. */
  blockedCount: number;
  /** Salary Release visibility (2026-07-27 refinement) — one entry per `blockedCount`, so the
   * operator can see which employees were excluded and why, rather than a bare number with nothing
   * to act on. `blockReasons` are generic, field-named strings — never another employee's own
   * identifying details. */
  blockedEntries: Array<{ id: string; employeeId: string; employeeName: string; blockReasons: string[] }>;
  correctionSettlementsConsumed: number;
  /** How many `RESERVED` Advances/Eid Advances this release settled to `PAID_OFF` (Presentation &
   * Workflow Stabilization Checkpoint, 2026-07-25, Issue 5). */
  advancesSettled: number;
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
      // The Payroll Entry grid's own cache (`staleTime: Infinity`, see use-payroll-entries.ts) is a
      // separate query key from unit-release-status and is never touched by a background refetch —
      // without this, a released entry's `released`/`releasedAt` flip is invisible in Payroll Entry
      // until an unrelated action (cycle switch, manual row reload) happens to refetch it, even
      // though the Payslip and Salary Release page (reading the same DB column via their own
      // queries) already reflect the release.
      queryClient.invalidateQueries({ queryKey: payrollEntriesQueryKey(cycleId) });
      // A release can settle a RESERVED Advance to PAID_OFF (Issue 5) — the Advances page's own
      // cache needs the same treatment as Payroll Entry's above, for the identical reason.
      queryClient.invalidateQueries({ queryKey: ADVANCES_QUERY_KEY });
    },
  });
}
