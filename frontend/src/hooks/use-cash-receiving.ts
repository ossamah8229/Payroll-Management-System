import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api-client';

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
 * response is a file, mirroring `downloadBankSheetExport` (`use-bank-sheet.ts`) exactly. */
export async function downloadCashReceivingExport(
  cycleId: string,
  format: 'csv' | 'xlsx',
  siteIds?: string[],
): Promise<void> {
  const params = new URLSearchParams({ format });
  if (siteIds?.length) params.set('siteIds', siteIds.join(','));

  const response = await fetch(`/api/v1/payroll-cycles/${cycleId}/cash-receiving/export?${params.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'Failed to export the Cash Receiving Sheet');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cash-receiving-sheet.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
