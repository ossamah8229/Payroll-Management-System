import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { formatMoney } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { FilterField } from '@/components/ui/filter-field';
import { ApiError } from '@/lib/api-client';
import { useBanks } from '@/hooks/use-banks';
import { useProjectSites } from '@/hooks/use-project-sites';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import { CASH_BANK_FILTER, downloadBankSheetExport, useBankSheet } from '@/hooks/use-bank-sheet';

const selectClassName =
  'flex h-9 w-full max-w-xs rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

export function BankSheetPage({ user }: { user: SessionUser }) {
  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('bank-sheet');
  const hasAnyCycle = cycles.length > 0;
  const sites = useProjectSites();
  const banks = useBanks();

  const [bankFilter, setBankFilter] = useState<string | undefined>(undefined);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!bankFilter && banks.data) {
      setBankFilter(banks.data[0]?.id ?? CASH_BANK_FILTER);
    }
  }, [bankFilter, banks.data]);

  const bankSheet = useBankSheet(cycleId, bankFilter, selectedSiteIds);

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  async function handleExport(format: 'csv' | 'xlsx') {
    if (!cycle || !bankFilter || !bankSheet.data) return;
    setIsExporting(true);
    try {
      await downloadBankSheetExport(cycle, bankFilter, bankSheet.data.bankLabel, format, selectedSiteIds);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }

  const isLoading = cycleLoading || banks.isLoading || sites.isLoading;

  return (
    <AppShell user={user} title="Bank Sheet" subtitle="Generate and export released payroll by bank">
      <Card>
        <CardHeader>
          <PayrollPageToolbar
            title="Bank Sheet"
            badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
            filters={
              <>
                {hasAnyCycle && (
                  <PayrollCycleSelectField
                    id="bank-sheet-cycle"
                    cycles={cycles}
                    selectedCycleId={cycleId}
                    onSelect={selectCycle}
                  />
                )}
                <FilterField id="bank-sheet-bank" label="Bank">
                  <select
                    id="bank-sheet-bank"
                    className={selectClassName}
                    value={bankFilter ?? ''}
                    onChange={(e) => setBankFilter(e.target.value)}
                  >
                    {(banks.data ?? []).map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name}
                      </option>
                    ))}
                    <option value={CASH_BANK_FILTER}>Cash</option>
                  </select>
                </FilterField>
                <MultiSelectFilter
                  id="bank-sheet-site-filter"
                  label="Site"
                  options={siteOptions}
                  selectedIds={selectedSiteIds}
                  onChange={setSelectedSiteIds}
                />
              </>
            }
            actions={
              <>
                <Button
                  variant="secondary"
                  onClick={() => handleExport('csv')}
                  disabled={isExporting || !bankSheet.data || bankSheet.data.rows.length === 0}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Export CSV
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleExport('xlsx')}
                  disabled={isExporting || !bankSheet.data || bankSheet.data.rows.length === 0}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Export Excel
                </Button>
              </>
            }
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!isLoading && cycleError && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load the payroll cycle</p>
              <p className="text-xs text-text-muted">{cycleError.message}</p>
            </div>
          )}

          {!isLoading && !cycleError && !hasAnyCycle && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No payroll cycles exist yet</p>
              <p className="text-xs text-text-muted">A Bank Sheet can only be generated once a cycle exists.</p>
            </div>
          )}

          {!isLoading && !cycleError && hasAnyCycle && bankSheet.error && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load the Bank Sheet</p>
              <p className="text-xs text-text-muted">
                {bankSheet.error instanceof ApiError ? bankSheet.error.message : 'Something went wrong'}
              </p>
            </div>
          )}

          {!isLoading && !bankSheet.error && bankSheet.isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!isLoading && !bankSheet.error && !bankSheet.isLoading && bankSheet.data && bankSheet.data.rows.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No released payroll for this selection</p>
              <p className="max-w-sm text-xs text-text-muted">
                Bank Sheets are generated only from released payroll — release the relevant Project
                Unit(s) first (Salary Release), or try a different Bank/Cash or Site filter.
              </p>
            </div>
          )}

          {!isLoading && !bankSheet.error && !bankSheet.isLoading && bankSheet.data && bankSheet.data.rows.length > 0 && (
            // Layout Integrity (permanent rule): never compress a business-critical identifier —
            // this wraps in its own horizontal-scroll container rather than shrinking columns, so
            // Employee Code, CNIC, Bank, Account Number, IBAN, and amounts always render at full
            // width regardless of viewport.
            <div className="overflow-x-auto">
              <Table className="min-w-full" density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Employee Code</TableHead>
                    <TableHead className="whitespace-nowrap">CNIC</TableHead>
                    <TableHead className="whitespace-nowrap">Employee Name</TableHead>
                    <TableHead className="whitespace-nowrap">Site</TableHead>
                    <TableHead className="whitespace-nowrap">Designation</TableHead>
                    <TableHead className="whitespace-nowrap">Bank</TableHead>
                    <TableHead className="whitespace-nowrap">Branch Code</TableHead>
                    <TableHead className="whitespace-nowrap">Account Number</TableHead>
                    <TableHead className="whitespace-nowrap">IBAN</TableHead>
                    <TableHead className="whitespace-nowrap">Account Title</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Net Salary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bankSheet.data.rows.map((row) => (
                    <TableRow key={row.entryId}>
                      <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.cnic ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.siteName}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.designation}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.bankCode ?? 'Cash'}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.branchCode ?? '—'}</TableCell>
                      {/* Business-critical identifiers must never truncate — the permanent Layout
                          Integrity Rule (2026-07-11) — whitespace-nowrap plus the table's own
                          horizontal scroll container is what guarantees this, not a fixed column
                          width that could clip a longer value. */}
                      <TableCell className="whitespace-nowrap tabular-nums">{row.accountNumber ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{row.iban ?? '—'}</TableCell>
                      {/* Account Title is derived, never stored (banking refinement, 2026-07-11) —
                          always the entry's own frozen Employee.name snapshot; see
                          bank-sheets.service.ts's buildRow. */}
                      <TableCell className="whitespace-nowrap">{row.accountTitle}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formatMoney(row.netSalary)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {/* Totals must always remain visible — a plain footer row, not `position: sticky`:
                    this table's only scroll container is horizontal (`overflow-x-auto`, for wide
                    columns/account numbers), not vertical, so there is no bounded scrolling
                    ancestor for a sticky-bottom row to attach to. An earlier attempt at `sticky
                    bottom-0` here detached from the table entirely and floated at the page's own
                    viewport edge instead — found via this checkpoint's own Playwright pass. A
                    plain trailing row is simpler and correct: it's always reachable at the bottom
                    of the table, exactly where a reader expects a total. */}
                <tfoot className="border-t-2 border-border bg-surface-2">
                  <TableRow>
                    <TableCell colSpan={10} className="whitespace-nowrap text-right font-semibold">
                      Total ({bankSheet.data.rows.length} employee{bankSheet.data.rows.length === 1 ? '' : 's'})
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                      {formatMoney(bankSheet.data.totalNetSalary)}
                    </TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
