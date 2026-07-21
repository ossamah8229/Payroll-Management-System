import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError, API_BASE_URL } from '@/lib/api-client';
import { formatCyclePeriodSlug, type PayrollCycle } from '@/hooks/use-payroll-cycles';

/** The sentinel bank-filter value for employees with no bank account on file (`bankId IS NULL`)
 * — matches `CASH_BANK_FILTER` on the backend (`bank-sheets.service.ts`). Distinct from any real
 * `Bank.id`, which is always a UUID. */
export const CASH_BANK_FILTER = 'cash';

export interface BankSheetRow {
  entryId: string;
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  employeeName: string;
  siteId: string;
  siteName: string;
  designation: string;
  bankId: string | null;
  /** Bank Code only, not the full Bank Name — the approved Bank display rule (2026-07-13); see
   * `bank-sheets.service.ts`'s identical field for the full reasoning. */
  bankCode: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  /** Derived — never stored (banking refinement, 2026-07-11): always the entry's own frozen
   * `Employee.name` snapshot, matching the frozen client Bank Sheet format's "Title of Account". */
  accountTitle: string;
  netSalary: string;
  releasedAt: string | null;
}

export interface BankSheetResult {
  bankFilter: string;
  bankLabel: string;
  rows: BankSheetRow[];
  totalNetSalary: string;
}

function bankSheetQueryKey(cycleId: string, bankFilter: string, siteIds: string[]) {
  return ['bank-sheet', cycleId, bankFilter, [...siteIds].sort().join(',')] as const;
}

/** Derived, read-only — Bank Sheets have no table of their own (Phase 4 Checkpoint 3). Generated
 * only from released payroll; `bankFilter` is either a real Bank's id or `CASH_BANK_FILTER`. */
export function useBankSheet(
  cycleId: string | undefined,
  bankFilter: string | undefined,
  siteIds: string[] = [],
) {
  return useQuery({
    queryKey: bankSheetQueryKey(cycleId ?? '', bankFilter ?? '', siteIds),
    queryFn: () => {
      const params = new URLSearchParams({ bankId: bankFilter! });
      if (siteIds.length) params.set('siteIds', siteIds.join(','));
      return apiRequest<BankSheetResult>(`/api/v1/payroll-cycles/${cycleId}/bank-sheet?${params.toString()}`);
    },
    enabled: Boolean(cycleId) && Boolean(bankFilter),
  });
}

/** Triggers a browser download of the Bank Sheet export — bypasses `apiRequest` since the response
 * is a file, mirroring `downloadPayrollEntryExport` (`use-payroll-entries.ts`) exactly. The
 * client-side `link.download` filename wins over the server's own `Content-Disposition` for this
 * blob-fetch download path, so it independently includes the same period slug the backend's own
 * filename does (Phase 5 Checkpoint 4) — otherwise the backend's period-aware name would never
 * actually reach the user for this, the primary download path. */
export async function downloadBankSheetExport(
  cycle: Pick<PayrollCycle, 'id' | 'year' | 'month'>,
  bankFilter: string,
  bankLabel: string,
  format: 'csv' | 'xlsx',
  siteIds?: string[],
): Promise<void> {
  const params = new URLSearchParams({ bankId: bankFilter, format });
  if (siteIds?.length) params.set('siteIds', siteIds.join(','));

  const response = await fetch(
    `${API_BASE_URL}/api/v1/payroll-cycles/${cycle.id}/bank-sheet/export?${params.toString()}`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    throw new ApiError(response.status, 'EXPORT_FAILED', 'Failed to export the Bank Sheet');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeLabel = bankLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  link.download = `bank-sheet-${safeLabel}-${formatCyclePeriodSlug(cycle)}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
