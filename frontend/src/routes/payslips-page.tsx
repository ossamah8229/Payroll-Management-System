import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { PERMISSIONS } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { PayrollPageToolbar } from '@/components/layout/payroll-page-toolbar';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { FilterField } from '@/components/ui/filter-field';
import { Checkbox } from '@/components/ui/checkbox';
import { ApiError } from '@/lib/api-client';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { useProjectUnits } from '@/hooks/use-project-units';
import { useSelectedPayrollCycle } from '@/hooks/use-selected-payroll-cycle';
import { formatCycleLabel } from '@/hooks/use-payroll-cycles';
import { PayrollCycleSelectField, PayrollCycleStatusBadge } from '@/components/payroll-cycle/payroll-cycle-selector';
import {
  downloadPayslipPdf,
  downloadPayslipsBatch,
  MAX_BATCH_PAYSLIPS_PER_REQUEST,
  payslipPdfUrl,
  usePayslips,
  type PayslipListItem,
} from '@/hooks/use-payslips';

/**
 * Payslips (Phase 4 Checkpoint 6.3.3). Follows the exact page shape Bank Sheet/Cash Receiving
 * already established (cycle select, `MultiSelectFilter` for Site, a table, a document-style
 * layout) — no new page pattern invented for this one.
 *
 * **Individual preview/download reuses the Checkpoint 6.2 PDF endpoint directly — there is no
 * second HTML preview route and no React reimplementation of the Payslip template.** Preview
 * opens the endpoint's `?disposition=inline` URL in a new tab (the browser's own native PDF
 * viewer renders it); Download fetches `?disposition=attachment` and saves it, mirroring every
 * other export in this app.
 *
 * **Selection semantics (this checkpoint's own frozen rule): "select all" means every employee
 * currently loaded by the picker under the active filters — never the whole company, never an
 * employee outside the caller's own site scope.** Changing cycle/site/unit/search always clears
 * the current selection outright, the simplest way to guarantee a stale, no-longer-visible
 * employeeId can never be silently submitted in a later batch request. The backend remains the
 * authoritative check regardless (site scope, released/non-held, the 300 cap) — this page's own
 * bookkeeping is a UX convenience, never trusted as the real control.
 */
export function PayslipsPage({ user }: { user: SessionUser }) {
  const {
    cycleId,
    cycle,
    cycles,
    isLoading: cycleLoading,
    error: cycleError,
    selectCycle,
  } = useSelectedPayrollCycle('payslips');
  const hasAnyCycle = cycles.length > 0;
  // Scoped to this user's own accessible sites (System-Wide RBAC Consistency remediation) — Payslips
  // stays a strictly site-scoped operational domain; holding sites:manage does not widen it.
  const sites = useAccessibleProjectSites(user);

  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [batchGenerating, setBatchGenerating] = useState(false);
  const batchAbortRef = useRef<AbortController | null>(null);

  // Filter changes — including a cycle switch — always clear the current selection outright (this
  // page's own frozen rule, above; extended to cycle switches by Phase 5 Checkpoint 4's own
  // frontend-safety requirement that a batch selection never silently carries across cycles).
  useEffect(() => {
    setSelectedEmployeeIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId, selectedSiteIds.join(','), selectedUnitIds.join(','), search]);

  // Unit filtering is only meaningful (and only fetched) when exactly one Site is selected — a
  // cascading Site -> Unit relationship, same as `SiteUnitSelect`'s own established pattern.
  // Multiple/zero selected sites disable the Unit filter rather than attempting to merge units
  // across sites, which `useProjectUnits` (one site at a time) isn't shaped for and this
  // checkpoint's own scope doesn't require.
  const singleSelectedSiteId = selectedSiteIds.length === 1 ? selectedSiteIds[0] : undefined;
  const units = useProjectUnits(singleSelectedSiteId);

  const payslips = usePayslips(cycleId, {
    siteIds: selectedSiteIds.length ? selectedSiteIds : undefined,
    unitIds: selectedUnitIds.length ? selectedUnitIds : undefined,
    search: search.trim() ? search.trim() : undefined,
  });

  const siteOptions = useMemo(() => (sites.data ?? []).map((site) => ({ id: site.id, label: site.name })), [sites.data]);
  const unitOptions = useMemo(() => (units.data ?? []).map((unit) => ({ id: unit.id, label: unit.name })), [units.data]);

  const loadedEmployees = useMemo(() => payslips.data?.employees ?? [], [payslips.data]);
  const loadedIds = useMemo(() => loadedEmployees.map((e) => e.employeeId), [loadedEmployees]);
  const allLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selectedEmployeeIds.has(id));
  const someLoadedSelected = loadedIds.some((id) => selectedEmployeeIds.has(id));

  function toggleOne(employeeId: string) {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function toggleAllLoaded() {
    setSelectedEmployeeIds((prev) => {
      if (allLoadedSelected) {
        const next = new Set(prev);
        for (const id of loadedIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...loadedIds]);
    });
  }

  async function handlePreview(employee: PayslipListItem) {
    if (!cycleId) return;
    window.open(payslipPdfUrl(cycleId, employee.employeeId, 'inline'), '_blank', 'noopener,noreferrer');
  }

  async function handleDownloadOne(employee: PayslipListItem) {
    if (!cycle) return;
    try {
      await downloadPayslipPdf(cycle, employee.employeeId, employee.employeeName);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Payslip download failed');
    }
  }

  async function handleBatchDownload() {
    if (!cycle || selectedEmployeeIds.size === 0) return;
    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchGenerating(true);
    try {
      await downloadPayslipsBatch(cycle, [...selectedEmployeeIds], controller.signal);
      toast.success(`Generated ${selectedEmployeeIds.size} Payslip${selectedEmployeeIds.size === 1 ? '' : 's'}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        toast.info('Batch Payslip generation cancelled');
      } else {
        toast.error(error instanceof ApiError ? error.message : 'Batch Payslip generation failed');
      }
    } finally {
      setBatchGenerating(false);
      batchAbortRef.current = null;
    }
  }

  function handleCancelBatch() {
    batchAbortRef.current?.abort();
  }

  const canViewPayslips = user.permissions.includes(PERMISSIONS.PAYSLIPS_VIEW);
  const isLoading = cycleLoading || sites.isLoading;
  const selectedCount = selectedEmployeeIds.size;
  const overBatchLimit = selectedCount > MAX_BATCH_PAYSLIPS_PER_REQUEST;

  if (!canViewPayslips) {
    return (
      <AppShell user={user} title="Payslips" subtitle="Generate and download employee Payslips">
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-14 text-center">
            <p className="text-xs font-medium text-text">You don't have access to Payslips</p>
            <p className="text-xs text-text-muted">Contact a Master User if you believe this is a mistake.</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell user={user} title="Payslips" subtitle="Generate and download employee Payslips">
      <Card>
        <CardHeader>
          <PayrollPageToolbar
            title="Payslips"
            badge={cycle && <PayrollCycleStatusBadge cycle={cycle} />}
            filters={
              <>
                {hasAnyCycle && (
                  <PayrollCycleSelectField
                    id="payslips-cycle"
                    cycles={cycles}
                    selectedCycleId={cycleId}
                    onSelect={selectCycle}
                  />
                )}
                <MultiSelectFilter
                  id="payslips-site-filter"
                  label="Site"
                  options={siteOptions}
                  selectedIds={selectedSiteIds}
                  onChange={(ids) => {
                    setSelectedSiteIds(ids);
                    setSelectedUnitIds([]); // the unit list itself changes with the site selection
                  }}
                />
                <MultiSelectFilter
                  id="payslips-unit-filter"
                  label="Unit"
                  options={unitOptions}
                  selectedIds={selectedUnitIds}
                  onChange={setSelectedUnitIds}
                  disabled={!singleSelectedSiteId}
                  disabledReason="Select one Site to filter by Unit"
                />
                <FilterField id="payslips-search" label="Search">
                  <Input
                    id="payslips-search"
                    className="w-48"
                    placeholder="Name, code, or CNIC"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </FilterField>
              </>
            }
            actions={
              <>
                <PrintButton />
                {selectedCount > 0 && (
                  <span className="text-xs text-text-muted">
                    {selectedCount} selected
                    {overBatchLimit && (
                      <span className="text-danger"> — exceeds the {MAX_BATCH_PAYSLIPS_PER_REQUEST} limit, deselect some</span>
                    )}
                  </span>
                )}
                {!batchGenerating ? (
                  <Button onClick={handleBatchDownload} disabled={selectedCount === 0 || overBatchLimit}>
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Download Selected Payslips
                  </Button>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-xs text-text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Generating {selectedCount} Payslip{selectedCount === 1 ? '' : 's'}…
                    </span>
                    <Button variant="secondary" onClick={handleCancelBatch}>
                      <X className="h-3.5 w-3.5" aria-hidden />
                      Cancel
                    </Button>
                  </>
                )}
              </>
            }
          />
        </CardHeader>
        <CardContent className="p-0">
          {cycle && (
            <div className="px-[18px] pt-[18px]">
              <PrintContextHeader title="Payslips" context={formatCycleLabel(cycle)} />
            </div>
          )}
          {isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
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
              <p className="text-xs text-text-muted">Payslips can only be generated once a cycle exists and has released payroll.</p>
            </div>
          )}

          {!isLoading && !cycleError && hasAnyCycle && payslips.error && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-danger">Could not load Payslips</p>
              <p className="text-xs text-text-muted">
                {payslips.error instanceof ApiError ? payslips.error.message : 'Something went wrong'}
              </p>
            </div>
          )}

          {!isLoading && !payslips.error && payslips.isLoading && (
            <div className="flex flex-col gap-2 p-[18px]">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!isLoading && !payslips.error && !payslips.isLoading && payslips.data && loadedEmployees.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No released Payslips for this selection</p>
              <p className="max-w-sm text-xs text-text-muted">
                Payslips are only available for released, non-held payroll — release the relevant Project
                Unit(s) first (Salary Release), or try a different filter.
              </p>
            </div>
          )}

          {!isLoading && !payslips.error && !payslips.isLoading && payslips.data && loadedEmployees.length > 0 && (
            <>
              {payslips.data.total > loadedEmployees.length && (
                <div className="border-b border-border bg-surface-2 px-[18px] py-2 text-[11px] text-text-muted">
                  Showing {loadedEmployees.length} of {payslips.data.total} matching employees — narrow the Site/Unit/
                  Search filters to see and select the rest.
                </div>
              )}
              <div className="print-flow overflow-x-auto">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      {/* Selection checkbox and row actions are screen-only (Professional
                          Printing checkpoint B3/final verification pass) — hidden on both the
                          header and body cells below, the same pattern already applied to
                          Employees/Advances. */}
                      <TableHead className="w-10 print:hidden">
                        <Checkbox
                          aria-label="Select all currently loaded employees"
                          checked={someLoadedSelected && !allLoadedSelected ? 'indeterminate' : allLoadedSelected}
                          onCheckedChange={toggleAllLoaded}
                        />
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Employee Code</TableHead>
                      <TableHead className="whitespace-nowrap">Employee Name</TableHead>
                      <TableHead className="whitespace-nowrap">Designation</TableHead>
                      <TableHead className="whitespace-nowrap">Site</TableHead>
                      <TableHead className="whitespace-nowrap text-right print:hidden">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadedEmployees.map((employee) => (
                      <TableRow key={employee.entryId}>
                        <TableCell className="print:hidden">
                          <Checkbox
                            aria-label={`Select ${employee.employeeName}`}
                            checked={selectedEmployeeIds.has(employee.employeeId)}
                            onCheckedChange={() => toggleOne(employee.employeeId)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{employee.employeeCode ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{employee.employeeName}</TableCell>
                        <TableCell className="whitespace-nowrap">{employee.designation}</TableCell>
                        <TableCell className="whitespace-nowrap">{employee.siteName}</TableCell>
                        <TableCell className="whitespace-nowrap text-right print:hidden">
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => handlePreview(employee)}>
                              <Eye className="h-3.5 w-3.5" aria-hidden />
                              Preview
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => handleDownloadOne(employee)}>
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              Download
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
