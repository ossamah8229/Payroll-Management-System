import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { formatMoney } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { ApiError } from '@/lib/api-client';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useProjectSites } from '@/hooks/use-project-sites';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import { downloadCashReceivingExport, useCashReceivingSheet } from '@/hooks/use-cash-receiving';

function formatGeneratedAt(date: Date): string {
  return date.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Cash Receiving Sheet (Phase 4 Checkpoint 4) — a dedicated page, not a tab or filter state inside
 * Bank Sheet (approved architecture decision), even though it shares the same layout shell/filter-
 * row/export-button pattern as `bank-sheet-page.tsx` and the same underlying released/non-held
 * query boundary. Cash-only: there is no bank filter here, unlike Bank Sheet — every row is,
 * by construction, an employee with no bank account on file (`bankId IS NULL`, the exact rule
 * already shipped and tested for Bank Sheets' own Cash filter).
 *
 * Simplified document layout, per the approved decision — no attendance/OT/allowance/deduction
 * breakdown, no Project Unit column, matching the original historical prototype's format was
 * explicitly rejected in favor of this shorter, physical-signature-oriented sheet.
 */
export function CashReceivingPage({ user }: { user: SessionUser }) {
  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('cash-receiving');
  const hasAnyCycle = cycles.length > 0;
  const sites = useProjectSites();
  const companySettings = useCompanySettings();

  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date());

  const cashSheet = useCashReceivingSheet(cycleId, selectedSiteIds);

  // The document's own "Generated On" timestamp refreshes whenever the underlying data is
  // (re)fetched — this is a generated-on-demand document (never cached/persisted), so the
  // timestamp shown always reflects the moment it was actually derived, not a stale value.
  useEffect(() => {
    if (cashSheet.data) setGeneratedAt(new Date());
  }, [cashSheet.data]);

  const siteOptions = useMemo(
    () => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })),
    [sites.data],
  );

  const cycleLabel = cycle ? formatCycleLabel(cycle) : '';

  async function handleExport(format: 'csv' | 'xlsx') {
    if (!cycle || !cashSheet.data) return;
    setIsExporting(true);
    try {
      await downloadCashReceivingExport(cycle, format, selectedSiteIds);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }

  const isLoading = cycleLoading || sites.isLoading;

  return (
    <AppShell user={user} title="Cash Receiving Sheet" subtitle="Generate and export released Cash payroll">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <CardTitle>Cash Receiving Sheet</CardTitle>
            {cycle && <PayrollCycleStatusBadge cycle={cycle} />}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {hasAnyCycle && (
              <PayrollCycleSelectField
                id="cash-receiving-cycle"
                cycles={cycles}
                selectedCycleId={cycleId}
                onSelect={selectCycle}
              />
            )}
            <MultiSelectFilter
              id="cash-receiving-site-filter"
              label="Site"
              options={siteOptions}
              selectedIds={selectedSiteIds}
              onChange={setSelectedSiteIds}
            />
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleExport('csv')}
                disabled={isExporting || !cashSheet.data || cashSheet.data.rows.length === 0}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleExport('xlsx')}
                disabled={isExporting || !cashSheet.data || cashSheet.data.rows.length === 0}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
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
              <p className="text-xs text-text-muted">
                A Cash Receiving Sheet can only be generated once a cycle exists.
              </p>
            </div>
          )}

          {!isLoading && !cycleError && hasAnyCycle && cashSheet.error && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load the Cash Receiving Sheet</p>
              <p className="text-xs text-text-muted">
                {cashSheet.error instanceof ApiError ? cashSheet.error.message : 'Something went wrong'}
              </p>
            </div>
          )}

          {!isLoading && !cashSheet.error && cashSheet.isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {!isLoading && !cashSheet.error && !cashSheet.isLoading && cashSheet.data && cashSheet.data.rows.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No released Cash payroll for this selection</p>
              <p className="max-w-sm text-xs text-text-muted">
                Cash Receiving Sheets are generated only from released payroll for employees with no
                bank account on file — release the relevant Project Unit(s) first (Salary Release), or
                try a different Site filter.
              </p>
            </div>
          )}

          {!isLoading && !cashSheet.error && !cashSheet.isLoading && cashSheet.data && cashSheet.data.rows.length > 0 && (
            <>
              {/* Document header — Company / Payroll Cycle / Generation Date / Generated By, per
                  the approved document layout. Printable-document typography (design-system.md
                  §1.2) applies here even without a PDF pipeline, since this block is what actually
                  gets printed today via the browser's own print. */}
              <div
                className="border-b border-border px-[18px] py-3.5 text-center"
                style={{ fontFamily: '"Times New Roman", serif' }}
              >
                <div className="text-sm font-bold text-text">
                  {companySettings.data?.companyName ?? 'Company'}
                </div>
                <div className="text-xs text-text-muted">Cash Receiving Sheet — {cycleLabel}</div>
                <div className="mt-1 text-[11px] text-text-faint">
                  Generated By: {user.name} · Generated On: {formatGeneratedAt(generatedAt)}
                </div>
              </div>

              {/* Layout Integrity (permanent rule): never compress financial data or identity
                  columns (name, CNIC, designation) — this wraps in its own horizontal-scroll
                  container rather than shrinking columns, matching Bank Sheet's own established
                  pattern exactly. The Signature/Thumb Impression column additionally needs a
                  reserved minimum width to stay physically usable once printed, not just wide
                  enough for its own header text. */}
              <div className="overflow-x-auto">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Serial No.</TableHead>
                      <TableHead className="whitespace-nowrap">Employee Code</TableHead>
                      <TableHead className="whitespace-nowrap">Employee Name</TableHead>
                      <TableHead className="whitespace-nowrap">CNIC</TableHead>
                      <TableHead className="whitespace-nowrap">Designation</TableHead>
                      <TableHead className="whitespace-nowrap">Site</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Net Salary</TableHead>
                      {/* A true fixed width, the Dynamic Width Rule's own stated exception
                          (2026-07-13): this column holds no text content to measure at all — it's
                          blank physical space reserved for a printed, handwritten signature. */}
                      <TableHead className="whitespace-nowrap" style={{ minWidth: 160 }}>
                        Signature / Thumb Impression
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashSheet.data.rows.map((row, index) => (
                      <TableRow key={row.entryId}>
                        <TableCell className="whitespace-nowrap tabular-nums">{index + 1}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.employeeCode ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{row.employeeName}</TableCell>
                        {/* CNIC must never truncate — whitespace-nowrap plus the table's own
                            horizontal scroll container guarantees this. */}
                        <TableCell className="whitespace-nowrap tabular-nums">{row.cnic ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.designation}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.siteName}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {formatMoney(row.netSalary)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap" style={{ minWidth: 160 }} />
                        <TableCell className="whitespace-nowrap">{row.remarks ?? ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {/* Totals must always remain visible — a plain footer row, not `position:
                      sticky` (Bank Sheets' own Playwright pass already found and fixed that bug;
                      not reintroduced here). Document footer — Total Employees / Total Cash
                      Amount, per the approved layout. */}
                  <tfoot className="border-t-2 border-border bg-surface-2">
                    <TableRow>
                      <TableCell colSpan={6} className="whitespace-nowrap text-right font-semibold">
                        Total Employees: {cashSheet.data.totalEmployees}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                        {formatMoney(cashSheet.data.totalNetSalary)}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </tfoot>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
