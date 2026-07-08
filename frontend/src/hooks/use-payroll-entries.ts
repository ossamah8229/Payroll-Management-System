import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type { CalcNetResult, UpdatePayrollEntryInput, UpdateWorkLineInput } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';
import type { Employee } from '@/hooks/use-employees';
import type { ProjectSite } from '@/hooks/use-project-sites';

export interface PayrollEntryWorkLine {
  id: string;
  payrollEntryId: string;
  siteId: string;
  unitId: string;
  days: string;
  otHours: string;
  otRate: string | null;
  cycleDays: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** One employee's monthly payroll figures for one cycle (docs/architecture/database-schema.md
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
  accountTitle: string | null;
  grossPay: string;
  allowance: string;
  leaveDays: string;
  leaveRate: string | null;
  eobiAmount: string;
  eobiApplicable: boolean;
  advanceDeduction: string;
  eidAdvanceDeduction: string;
  fine: string;
  hold: boolean;
  released: boolean;
  releasedAt: string | null;
  releasedBy: string | null;
  lateReason: string | null;
  remarks: string | null;
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  workLines: PayrollEntryWorkLine[];
  calc: CalcNetResult;
}

/** A `PayrollEntry` is editable only while unreleased and its cycle is still Draft
 * (docs/architecture/database-schema.md §12) — `hold` has no bearing on this. Mirrors the
 * backend's own `assertEntryEditable` (payroll-entry.service.ts) so the UI never offers an edit
 * affordance the server would reject. */
export function isEntryEditable(entry: Pick<PayrollEntry, 'released'>, cycleStatus: string): boolean {
  return !entry.released && cycleStatus === 'DRAFT';
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

/**
 * Fetches every `PayrollEntry` for a cycle, paging through the backend's own paginated endpoint to
 * completion and flattening into one sortOrder-ordered array — the shape a virtualized grid needs
 * (it virtualizes over an in-memory row set, not a server-side scroll window). This is ordinary
 * page-to-completion client fetching, not the incremental/windowed-fetch optimization Checkpoint 6
 * owns for the 10,000-employee floor; at today's ~1,500 employees this is at most 8 requests.
 */
export function usePayrollEntries(cycleId: string | undefined) {
  return useQuery({
    queryKey: payrollEntriesQueryKey(cycleId),
    queryFn: async () => {
      if (!cycleId) return [];
      const all: PayrollEntry[] = [];
      let page = 1;
      for (;;) {
        const result = await apiRequest<ListPayrollEntriesResponse>(
          `/api/v1/payroll-cycles/${cycleId}/entries?page=${page}&pageSize=${PAGE_SIZE}`,
        );
        all.push(...result.entries);
        if (all.length >= result.total || result.entries.length < PAGE_SIZE) break;
        page += 1;
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

/** Re-fetches a single entry fresh from the server and replaces it in the cache — the "Reload row"
 * recovery action after a 409 optimistic-locking conflict (docs/architecture/database-schema.md
 * §22) discards whatever local draft was pending and restores the row to the current server truth. */
export async function reloadPayrollEntry(queryClient: QueryClient, cycleId: string, entryId: string) {
  const { entry } = await apiRequest<{ entry: PayrollEntry }>(`/api/v1/payroll-entries/${entryId}`);
  queryClient.setQueryData<PayrollEntry[]>(payrollEntriesQueryKey(cycleId), (previous) =>
    previous?.map((existing) => (existing.id === entryId ? entry : existing)),
  );
  return entry;
}
