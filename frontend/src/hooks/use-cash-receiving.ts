import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';

export interface CashReceivingRow {
  entryId: string;
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  employeeName: string;
  siteId: string;
  siteName: string;
  designation: string;
  netSalary: string;
  remarks: string | null;
}

export interface CashReceivingSheetResult {
  rows: CashReceivingRow[];
  totalNetSalary: string;
  totalEmployees: number;
}

function cashReceivingQueryKey(cycleId: string, siteIds: string[]) {
  return ['cash-receiving', cycleId, [...siteIds].sort().join(',')] as const;
}

/** Derived, read-only — Cash Receiving Sheets have no table of their own (Phase 4 Checkpoint 4), a
 * dedicated module separate from Bank Sheets. Cash identification reuses Bank Sheets' own shipped
 * rule exactly (`bankId IS NULL`) — no bank filter exists here, unlike `useBankSheet`, since this
 * page is always Cash-only. */
export function useCashReceivingSheet(cycleId: string | undefined, siteIds: string[] = []) {
  return useQuery({
    queryKey: cashReceivingQueryKey(cycleId ?? '', siteIds),
    queryFn: () => {
      const params = new URLSearchParams();
      if (siteIds.length) params.set('siteIds', siteIds.join(','));
      const query = params.toString();
      return apiRequest<CashReceivingSheetResult>(
        `/api/v1/payroll-cycles/${cycleId}/cash-receiving${query ? `?${query}` : ''}`,
      );
    },
    enabled: Boolean(cycleId),
  });
}

/** Triggers a browser download of the Cash Receiving Sheet export — bypasses `apiRequest` since the
 * response is a file, mirroring `downloadBankSheetExport` (`use-bank-sheet.ts`) exactly. The
 * client-side `link.download` filename wins over the server's own `Content-Disposition` for this
 * blob-fetch download path, so it independently includes the same period slug the backend's own
 * filename already did (Phase 5 Checkpoint 4 closes the one place that period was previously lost). */
export async function downloadCashReceivingExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  format: 'csv' | 'xlsx',
  siteIds?: string[],
): Promise<void> {
  const params = new URLSearchParams({ format });
  if (siteIds?.length) params.set('siteIds', siteIds.join(','));

  const response = await fetch(
    `${API_BASE_URL}/api/v1/payroll-cycles/${cycle.id}/cash-receiving/export?${params.toString()}`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'Failed to export the Cash Receiving Sheet');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cash-receiving-sheet-${formatCyclePeriodSlug(cycle)}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
