import { useQuery } from '@tanstack/react-query';
import { MAX_BATCH_PAYSLIPS_PER_REQUEST } from '@payroll/shared';
import { apiRequest, ApiError, readCookie } from '@/lib/api-client';

export { MAX_BATCH_PAYSLIPS_PER_REQUEST };

export interface PayslipListItem {
  entryId: string;
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  employeeName: string;
  designation: string;
  siteId: string;
  siteName: string;
}

export interface ListPayslipsResult {
  total: number;
  page: number;
  pageSize: number;
  employees: PayslipListItem[];
}

export interface PayslipListFilters {
  siteIds?: string[];
  unitIds?: string[];
  search?: string;
}

/** The picker/list endpoint's own hard page-size ceiling (Phase 4 Checkpoint 6.1's
 * `MAX_PAGE_SIZE`) — requested directly, so "select all currently loaded" always means every row
 * the picker is capable of showing in one page. Comfortably below `MAX_BATCH_PAYSLIPS_PER_REQUEST`
 * (300), so a full "select all" can never itself exceed the batch cap — the cap only matters if a
 * future page-size increase ever changes that relationship. */
const PICKER_PAGE_SIZE = 200;

function payslipsQueryKey(cycleId: string, filters: PayslipListFilters) {
  return [
    'payslips',
    cycleId,
    [...(filters.siteIds ?? [])].sort().join(','),
    [...(filters.unitIds ?? [])].sort().join(','),
    filters.search?.trim() ?? '',
  ] as const;
}

/** The Payslip picker — released, non-held employees only (server-enforced; this hook trusts
 * nothing client-side). Mirrors `useBankSheet`/`useCashReceivingSheet`'s own query-hook shape. */
export function usePayslips(cycleId: string | undefined, filters: PayslipListFilters = {}) {
  return useQuery({
    queryKey: payslipsQueryKey(cycleId ?? '', filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.siteIds?.length) params.set('siteIds', filters.siteIds.join(','));
      if (filters.unitIds?.length) params.set('unitIds', filters.unitIds.join(','));
      if (filters.search?.trim()) params.set('search', filters.search.trim());
      params.set('pageSize', String(PICKER_PAGE_SIZE));
      const query = params.toString();
      return apiRequest<ListPayslipsResult>(`/api/v1/payroll-cycles/${cycleId}/payslips${query ? `?${query}` : ''}`);
    },
    enabled: Boolean(cycleId),
  });
}

/** The single-PDF endpoint's own URL — `inline` for the browser's native PDF viewer (preview,
 * opened in a new tab, never a second HTML template — Checkpoint 6.2's own architecture
 * decision), `attachment` to force a save dialog. Same bytes either way. */
export function payslipPdfUrl(cycleId: string, employeeId: string, disposition: 'inline' | 'attachment'): string {
  const params = new URLSearchParams({ disposition });
  return `/api/v1/payroll-cycles/${cycleId}/payslips/${employeeId}/pdf?${params.toString()}`;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Triggers a browser download of one employee's Payslip PDF — bypasses `apiRequest` since the
 * response is a file, mirroring `downloadCashReceivingExport` (`use-cash-receiving.ts`) exactly. */
export async function downloadPayslipPdf(cycleId: string, employeeId: string, employeeName: string): Promise<void> {
  const response = await fetch(payslipPdfUrl(cycleId, employeeId, 'attachment'), { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'Failed to download the Payslip');
  }
  const blob = await response.blob();
  triggerBlobDownload(blob, `payslip-${employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
}

/**
 * Triggers the batch PDF/ZIP download — a real streamed HTTP response, not a polled job (Phase 4
 * Checkpoint 6.3's own architecture decision: bounded, stateless streaming). Accepts an
 * `AbortSignal` so the caller can cancel a slow batch; an aborted `fetch` rejects with a
 * `DOMException` named `AbortError`, which the caller distinguishes from a genuine failure.
 */
export async function downloadPayslipsBatch(cycleId: string, employeeIds: string[], signal: AbortSignal): Promise<void> {
  const csrfToken = readCookie('csrf_token');
  const response = await fetch(`/api/v1/payroll-cycles/${cycleId}/payslips/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ employeeIds }),
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'BATCH_FAILED',
      payload?.error?.message ?? 'Batch Payslip generation failed',
    );
  }

  const blob = await response.blob();
  triggerBlobDownload(blob, 'payslips-batch.zip');
}
