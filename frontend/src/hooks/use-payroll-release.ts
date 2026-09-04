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
  /** Hold Workflow Verification (Phase 7F, 2026-08-04) — currently-Held, unresolved entries at this
   * Unit; never included in `willReleaseCount`. */
  heldCount: number;
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
  /** Late/Straggler Sweep (Hold Workflow Verification, Phase 7F, 2026-08-04) — `true` when this
   * Unit was already released and this call only swept newly-eligible stragglers (typically: a
   * Hold removed after the Unit's original release). No new release event occurred. */
  isLateSweep: boolean;
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

export interface ReleaseProjectUnitVariables {
  unitId: string;
  /** Phase 7E durability checkpoint (A4) — the `{entryId, version}` pairs of every currently-live
   * release candidate at this Unit, so the backend can reject the release outright if any of them
   * changed since this page last loaded (`payroll-release.service.ts`'s own doc comment on
   * `releaseProjectUnit`). Held/released/resolved entries are not candidates and must not be sent;
   * if a candidate becomes Held after this read, its previously-sent pair still triggers the
   * intended stale-state 409. Optional — omitting it (or an empty array) releases exactly as before
   * this checkpoint. */
  expectedVersions?: { entryId: string; version: number }[];
}

export function useReleaseProjectUnit(cycleId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ unitId, expectedVersions }: ReleaseProjectUnitVariables) =>
      apiRequest<ReleaseUnitResult>(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`, {
        method: 'POST',
        body: expectedVersions && expectedVersions.length > 0 ? { expectedVersions } : undefined,
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

/** Release All (Phase 7F, 2026-08-04) — one entry per employee outcome the sweep produced, summed
 * across every Project Unit this call actually released; see `payroll-release.service.ts`'s
 * `ReleaseAllResult` (the exact same shape, field for field) for the full meaning of each count. */
export interface ReleaseAllResult {
  releasedEntryCount: number;
  noPayDueCount: number;
  recoveryDueCount: number;
  blockedCount: number;
  blockedEntries: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    siteId: string;
    unitId: string;
    unitName: string;
    blockReasons: string[];
  }>;
  heldEntryCount: number;
  unitsReleased: number;
  unitsAlreadyReleased: number;
  unitsFailed: number;
  failedUnits: Array<{ unitId: string; unitName: string; siteId: string; error: string }>;
  correctionSettlementsConsumed: number;
  advancesSettled: number;
}

export interface ReleaseAllVariables {
  /** `undefined` releases every Site the current user can access ("All Sites"); a specific value
   * releases only that one Site. */
  siteId?: string;
}

export function useReleaseAll(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId }: ReleaseAllVariables) =>
      apiRequest<ReleaseAllResult>(`/api/v1/payroll-cycles/${cycleId}/units/release-all`, {
        method: 'POST',
        body: { siteId: siteId ?? null },
      }),
    onSuccess: () => {
      // Release All can touch every Site's own unit-release-status cache at once (not just the
      // currently-filtered one), so this invalidates every cached siteId variant for this cycle —
      // a broader match than useReleaseProjectUnit's own single-site invalidation needs to be.
      queryClient.invalidateQueries({ queryKey: ['payroll-unit-release-status', cycleId] });
      queryClient.invalidateQueries({ queryKey: payrollEntriesQueryKey(cycleId) });
      queryClient.invalidateQueries({ queryKey: ADVANCES_QUERY_KEY });
    },
  });
}
