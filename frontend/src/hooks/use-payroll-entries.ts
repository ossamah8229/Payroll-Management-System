import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type {
  AddWorkLineInput,
  BulkUpdatePayrollEntriesInput,
  CalcNetResult,
  UpdatePayrollEntryInput,
  UpdateWorkLineInput,
} from '@payroll/shared';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import type { Employee } from '@/hooks/use-employees';
import type { ProjectSite } from '@/hooks/use-project-sites';
import type { ProjectUnit } from '@/hooks/use-project-units';

export interface PayrollEntryWorkLine {
  id: string;
  payrollEntryId: string;
  siteId: string;
  unitId: string;
  /** The `ProjectUnit` this line is deputed to *for this cycle's entry* — always frozen for a
   * released/archived entry (work lines never change post-release, §12) and the current Draft
   * roster's assignment otherwise. This (specifically `.code`) is the grid's "Deputed Branch"
   * column source — never `employee.unit`, which is the employee's *current* default unit and
   * would silently rewrite a released entry's historical branch onto whatever the employee is
   * deputed to today. */
  unit: ProjectUnit;
  days: string;
  otHours: string;
  otRate: string | null;
  cycleDays: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** One employee's monthly payroll figures for one cycle (docs/architecture/database/payroll-entry.md
 * §12/§12a) — `calc` is always the shared `calcNet` result for this entry's currently-stored
 * figures, computed server-side by `computeEntryCalc` (backend/src/modules/payroll-entry/
 * payroll-entry.service.ts); the frontend never recomputes it differently, only recomputes the
 * same `calcNet` function locally for *live*, not-yet-saved edits (see `use-payroll-entry-editor`). */
export interface PayrollEntry {
  id: string;
  cycleId: string;
  employeeId: string;
  employee: Employee;
  siteId: string;
  site: ProjectSite;
  designation: string;
  bankId: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  grossPay: string;
  allowance: string;
  leaveDays: string;
  leaveRate: string | null;
  eobiAmount: string;
  eobiApplicable: boolean;
  advanceDeduction: string;
  /** Phase 4 Checkpoint 5 (Advances) — the linked Advance, when materialized/manually linked. A
   * light projection (id/outstandingBalance/status), not the full Advance record. */
  advanceId: string | null;
  advance: { id: string; outstandingBalance: string; status: 'ACTIVE' | 'RESERVED' | 'PAID_OFF' } | null;
  eidAdvanceDeduction: string;
  eidAdvanceId: string | null;
  eidAdvance: { id: string; outstandingBalance: string; status: 'ACTIVE' | 'RESERVED' | 'PAID_OFF' } | null;
  fine: string;
  hold: boolean;
  released: boolean;
  releasedAt: string | null;
  releasedBy: string | null;
  /** Negative Payroll Recovery checkpoint (2026-07-26) — set only for a zero/negative-net entry
   * resolved by a Unit release sweep; `null` for an ordinary Draft entry or one released for
   * payment (`released = true` never coincides with a non-null `payoutOutcome`). */
  payoutOutcome: 'NO_PAY_DUE' | 'RECOVERY_DUE' | null;
  /** Pre-release "Needs Attention" visibility (2026-07-27 refinement) — non-empty only for a still
   * unresolved entry (`released: false`, `hold: false`, `payoutOutcome: null`) the backend already
   * knows would be excluded from the next Unit release sweep — duplicate CNIC/Employee Code/
   * Account Number/IBAN, or a bank-paid entry missing its Account Number. Computed server-side by
   * the exact same `evaluatePayrollEntryReleaseReadiness` function the release sweep itself
   * enforces with (`payroll-release-eligibility.ts`) — never reimplemented here. Always `[]` for a
   * resolved entry (released, held, or already `payoutOutcome`-classified). Generic, field-named
   * strings only — never another employee's own identifying details. */
  releaseBlockReasons: string[];
  lateReason: string | null;
  remarks: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  workLines: PayrollEntryWorkLine[];
  calc: CalcNetResult;
}

/** A `PayrollEntry` is editable while unreleased, as long as its cycle is not `ARCHIVED`
 * (docs/architecture/database/payroll-entry.md §12, extended Phase 5 Checkpoint 4) — `hold` has no
 * bearing on this, and a held/unreleased entry stays editable through `RELEASED` (Checkpoint 1's
 * own approved rule), only losing editability once the cycle archives. Mirrors the backend's own
 * `assertEntryEditable` (payroll-entry.service.ts) so the UI never offers an edit affordance the
 * server would reject. **Corrected 2026-07-15 (Phase 5 Checkpoint 4):** before this checkpoint,
 * Payroll Entry only ever showed the Draft cycle, so this function's own stricter-than-the-backend
 * `cycleStatus === 'DRAFT'` check was dormant and harmless; extending the page to show Released
 * cycles would otherwise have wrongly disabled editing a held entry the backend would still accept. */
export function isEntryEditable(entry: Pick<PayrollEntry, 'released'>, cycleStatus: string): boolean {
  return !entry.released && cycleStatus !== 'ARCHIVED';
}

interface ListPayrollEntriesResponse {
  total: number;
  page: number;
  pageSize: number;
  entries: PayrollEntry[];
}

// The backend's own hard cap (backend/src/modules/payroll-entry/payroll-entry.service.ts,
// MAX_PAGE_SIZE) — requesting more than this per page is clamped server-side regardless.
const PAGE_SIZE = 200;

export function payrollEntriesQueryKey(cycleId: string | undefined) {
  return ['payroll-entries', cycleId] as const;
}

// Checkpoint 6 (10,000-employee floor, Decision 1 — "Option A," approved 2026-07-10): capping how
// many pages are ever in flight at once, rather than firing all of them simultaneously — a bare
// `Promise.all` over every remaining page would burst up to 49 concurrent requests against a
// Prisma pool with no explicit `connection_limit` configured. 8 was the batch size measured in
// the backend performance suite (`backend/tests/payroll-entry-performance.test.ts`): a full
// 10,000-row, 50-page fetch went from 2.82s sequential to 1.75s batched-parallel (1.61x) against a
// local Postgres instance, with no connection errors.
const FETCH_CONCURRENCY = 8;

function fetchPage(cycleId: string, page: number): Promise<ListPayrollEntriesResponse> {
  return apiRequest<ListPayrollEntriesResponse>(
    `/api/v1/payroll-cycles/${cycleId}/entries?page=${page}&pageSize=${PAGE_SIZE}`,
  );
}

/**
 * Fetches every `PayrollEntry` for a cycle and flattens it into one sortOrder-ordered array — the
 * shape a virtualized grid needs (it virtualizes over an in-memory row set, not a server-side
 * scroll window; Checkpoint 6's own architecture decision, 2026-07-10, keeps this in-memory model
 * rather than moving to server-side windowed fetching, since `LiveTotalsStore`, Copy to All, the
 * multi-site filter, import/export, and the React Query cache all already assume the whole cycle
 * is resident client-side — see that decision's record for the full reasoning).
 *
 * Page 1 is fetched alone first to learn `total`/confirm the page count, then every remaining page
 * is fetched in `FETCH_CONCURRENCY`-wide parallel batches (measured and tuned in the backend
 * performance suite, not an arbitrary number) rather than the fully sequential one-page-at-a-time
 * loop this replaced — that original loop is exactly what the Checkpoint 6 architecture review
 * measured as the initial-load bottleneck at the 10,000-employee floor. Pages are concatenated in
 * page order, which is correct as long as `sortOrder` doesn't shift mid-fetch — the same assumption
 * the original sequential loop already made.
 */
export function usePayrollEntries(cycleId: string | undefined) {
  return useQuery({
    queryKey: payrollEntriesQueryKey(cycleId),
    queryFn: async () => {
      if (!cycleId) return [];

      const first = await fetchPage(cycleId, 1);
      const all: PayrollEntry[] = [...first.entries];
      const totalPages = Math.ceil(first.total / PAGE_SIZE);

      const remainingPages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 2);
      for (let i = 0; i < remainingPages.length; i += FETCH_CONCURRENCY) {
        const batch = remainingPages.slice(i, i + FETCH_CONCURRENCY);
        const results = await Promise.all(batch.map((page) => fetchPage(cycleId, page)));
        for (const result of results) all.push(...result.entries);
      }

      return all;
    },
    enabled: Boolean(cycleId),
    // The grid manages its own live/optimistic state per row; a background refetch racing with an
    // in-flight autosave would fight the row's own cache writes, so this data is refetched only
    // explicitly (cycle switch, manual reload-row action), never on an interval or window refocus.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

/** Server responses from PATCH /payroll-entries/:id and PATCH /work-lines/:id never include the
 * `employee`/`site` relations (only the list/get endpoints do) — merging preserves whatever is
 * already cached for those two, which never change via this grid (site is permanently
 * non-editable per §12's 2026-07-07 decision; employee identity never changes on an entry). */
type MutationEntryResponse = Omit<PayrollEntry, 'employee' | 'site'>;

function mergeEntry(previous: PayrollEntry, incoming: MutationEntryResponse): PayrollEntry {
  return { ...previous, ...incoming, employee: previous.employee, site: previous.site };
}

function replaceEntry(
  queryClient: QueryClient,
  cycleId: string,
  entryId: string,
  incoming: MutationEntryResponse,
) {
  queryClient.setQueryData<PayrollEntry[]>(payrollEntriesQueryKey(cycleId), (previous) =>
    previous?.map((entry) => (entry.id === entryId ? mergeEntry(entry, incoming) : entry)),
  );
}

export function useUpdatePayrollEntry(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePayrollEntryInput }) =>
      apiRequest<{ entry: MutationEntryResponse }>(`/api/v1/payroll-entries/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: (data, variables) => {
      replaceEntry(queryClient, cycleId, variables.id, data.entry);
    },
  });
}

export function useUpdateWorkLine(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWorkLineInput }) =>
      apiRequest<{ entry: MutationEntryResponse }>(`/api/v1/work-lines/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: (data) => {
      replaceEntry(queryClient, cycleId, data.entry.id, data.entry);
    },
  });
}

/** The backend capability behind "Split by {unitLabel}" (docs/architecture/database/payroll-entry.md
 * §12a) — adds a new `PayrollEntryWorkLine` to an already-existing entry. Already built server-side
 * since Checkpoint 1 (`payroll-entry.service.ts`'s `addWorkLine`); this is Checkpoint 3's first
 * frontend caller. Returns the full updated entry (fresh `version`, every line), merged into the
 * cache exactly like every other work-line mutation. */
export function useAddWorkLine(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: AddWorkLineInput }) =>
      apiRequest<{ entry: MutationEntryResponse }>(`/api/v1/payroll-entries/${entryId}/work-lines`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => {
      replaceEntry(queryClient, cycleId, data.entry.id, data.entry);
    },
  });
}

/** Removes a `PayrollEntryWorkLine` — rejected server-side (400) if it would leave the entry with
 * zero lines (§12a); the Split by {unitLabel} modal also disables the affordance client-side for
 * that case, so this 400 should be unreachable in practice, the same defense-in-depth pattern as
 * every other client-side-mirrored server guard in this codebase. `version` locks against the
 * *parent* entry, work lines have no version of their own (§22). */
export function useDeleteWorkLine(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      apiRequest<{ entry: MutationEntryResponse }>(`/api/v1/work-lines/${id}?version=${version}`, {
        method: 'DELETE',
      }),
    onSuccess: (data) => {
      replaceEntry(queryClient, cycleId, data.entry.id, data.entry);
    },
  });
}

/** Re-fetches a single entry fresh from the server and replaces it in the cache — the "Reload row"
 * recovery action after a 409 optimistic-locking conflict (docs/architecture/database/schema-invariants.md
 * §22) discards whatever local draft was pending and restores the row to the current server truth. */
export async function reloadPayrollEntry(queryClient: QueryClient, cycleId: string, entryId: string) {
  const { entry } = await apiRequest<{ entry: PayrollEntry }>(`/api/v1/payroll-entries/${entryId}`);
  queryClient.setQueryData<PayrollEntry[]>(payrollEntriesQueryKey(cycleId), (previous) =>
    previous?.map((existing) => (existing.id === entryId ? entry : existing)),
  );
  return entry;
}

export interface BulkUpdatePayrollEntriesResult {
  matchedCount: number;
  appliedCount: number;
}

/**
 * "Copy to All" (Phase 3 Checkpoint 4) — a single bulk request, never a loop of individual
 * mutations (`docs/architecture/database/schema-invariants.md` §23). Cache strategy is deliberately
 * a full refetch on success, not a manual per-row merge: a bulk action can touch far more entries
 * than are ever mounted by the virtualizer at once, so there is no bounded set of rows to merge
 * (unlike `useUpdatePayrollEntry`/`useUpdateWorkLine`'s single-row `replaceEntry`).
 */
export function useBulkUpdatePayrollEntries(cycleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkUpdatePayrollEntriesInput) =>
      apiRequest<BulkUpdatePayrollEntriesResult>(`/api/v1/payroll-cycles/${cycleId}/entries/bulk`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollEntriesQueryKey(cycleId) });
    },
  });
}

/**
 * Triggers a browser download of the Payroll Entry export (Phase 3 Checkpoint 5) — bypasses
 * `apiRequest` since the response is a file, not JSON, mirroring `downloadEmployeeExport`
 * (`use-employees.ts`) exactly. `siteIds` mirrors the grid's own multi-select site filter so
 * "export what's currently filtered" and "export everything this cycle" are both one call.
 */
export async function downloadPayrollEntryExport(
  cycleId: string,
  format: 'csv' | 'xlsx',
  siteIds?: string[],
): Promise<void> {
  const params = new URLSearchParams({ format });
  if (siteIds?.length) params.set('siteIds', siteIds.join(','));

  const response = await fetch(`${API_BASE_URL}/api/v1/payroll-cycles/${cycleId}/entries/export?${params.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'Failed to export payroll entries');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payroll-entry.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

// Payroll Entry import was removed (Payroll Entry usability checkpoint, 2026-07-24) — payroll
// data must never be imported, per the approved product decision. Export (above) is unaffected.
