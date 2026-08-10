import { useEffect, useRef, useState } from 'react';
import { Download, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, ROLE_CODES, toIsoDateOnly, type SessionUser } from '@payroll/shared';
import { hasPermission } from '@/lib/permissions';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterField } from '@/components/ui/filter-field';
import { PrintButton } from '@/components/ui/print-button';
import { PrintContextHeader } from '@/components/ui/print-context-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api-client';
import { useBanks } from '@/hooks/use-banks';
import { useAccessibleProjectSites } from '@/hooks/use-project-sites';
import { SiteUnitSelect } from '@/components/ui/site-unit-select';
import { EmployeeFormModal } from '@/components/employees/employee-form-modal';
import {
  downloadEmployeeExport,
  downloadEmployeeImportTemplate,
  useEmployee,
  useEmployees,
  useImportEmployees,
  useMarkEmployeeLeft,
  useReactivateEmployee,
  type Employee,
  type ImportResult,
} from '@/hooks/use-employees';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

function MarkLeftModal({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
}) {
  const markLeft = useMarkEmployeeLeft();
  const [dateOfLeaving, setDateOfLeaving] = useState(() => toIsoDateOnly(new Date()));

  async function handleSubmit() {
    try {
      await markLeft.mutateAsync({ id: employee.id, input: { dateOfLeaving } });
      toast.success(`${employee.name} marked as left`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !markLeft.isPending && onOpenChange(next)}>
      <ModalContent title="Mark Employee as Left" widthClassName="max-w-[420px]">
        <p className="mb-3 text-xs text-text-muted">
          <span className="font-medium text-text">{employee.name}</span> will be marked as having left.
          This preserves their history rather than deleting the record.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leave-date">Date of leaving</Label>
          <DateInput id="leave-date" value={dateOfLeaving} onChange={setDateOfLeaving} />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={markLeft.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-danger hover:brightness-110"
            onClick={handleSubmit}
            disabled={markLeft.isPending}
          >
            Confirm
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * The Reactivate Employee action (docs/architecture/database/schema-invariants.md §26 item 6) — symmetric to
 * `MarkLeftModal` above. Fetches the full current record (rather than relying on whatever partial
 * detail the CNIC duplicate-check surfaced) so every current-employment field can be reviewed and,
 * if needed, updated in the same call that clears `dateOfLeaving`, via the single `reactivateEmployee`
 * workflow the backend exposes at `POST /employees/:id/reactivate`.
 */
function ReactivateEmployeeModal({
  open,
  onOpenChange,
  employeeId,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  user: SessionUser;
}) {
  const { data: employee, isLoading } = useEmployee(employeeId);
  const banks = useBanks();
  const reactivateEmployee = useReactivateEmployee();

  const [form, setForm] = useState({
    siteId: '',
    unitId: '',
    designation: '',
    payType: 'DAILY_WAGE' as 'DAILY_WAGE' | 'MONTHLY',
    grossPay: '',
    bankId: '',
    branchCode: '',
    accountNumber: '',
    iban: '',
  });

  useEffect(() => {
    if (!employee) return;
    setForm({
      siteId: employee.siteId,
      unitId: employee.unitId,
      designation: employee.designation,
      payType: employee.payType,
      grossPay: employee.grossPay,
      bankId: employee.bankId ?? '',
      branchCode: employee.branchCode ?? '',
      accountNumber: employee.accountNumber ?? '',
      iban: employee.iban ?? '',
    });
  }, [employee]);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Banking rule (2026-07-11 refinement): see EmployeeFormModal's identical helper above.
  function setBankField(bankId: string) {
    setForm((prev) => (bankId ? { ...prev, bankId } : { ...prev, bankId: '', accountNumber: '', iban: '' }));
  }

  async function handleSubmit() {
    try {
      await reactivateEmployee.mutateAsync({
        id: employeeId,
        input: {
          siteId: form.siteId,
          unitId: form.unitId,
          designation: form.designation,
          payType: form.payType,
          grossPay: form.grossPay,
          bankId: form.bankId || null,
          branchCode: form.branchCode || null,
          accountNumber: form.accountNumber || null,
          iban: form.iban || null,
        },
      });
      toast.success(`${employee?.name ?? 'Employee'} reactivated`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !reactivateEmployee.isPending && onOpenChange(next)}>
      <ModalContent title="Reactivate Employee" widthClassName="max-w-[520px]">
        {isLoading || !employee ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-text-muted">
              <span className="font-medium text-text">{employee.name}</span> left on{' '}
              {employee.dateOfLeaving ?? 'an earlier date'}. Reactivating clears that and restores them to
              the active roster on this same record — review or update their current details below.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reactivate-designation">Designation</Label>
                <Input
                  id="reactivate-designation"
                  required
                  maxLength={80}
                  value={form.designation}
                  onChange={(e) => setField('designation', e.target.value)}
                />
              </div>
              <SiteUnitSelect
                siteId={form.siteId}
                unitId={form.unitId}
                onSiteChange={(siteId) => setField('siteId', siteId)}
                onUnitChange={(unitId) => setField('unitId', unitId)}
                user={user}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reactivate-pay-type">Pay type</Label>
                <select
                  id="reactivate-pay-type"
                  className={selectClassName}
                  value={form.payType}
                  onChange={(e) => setField('payType', e.target.value as 'DAILY_WAGE' | 'MONTHLY')}
                >
                  <option value="DAILY_WAGE">Daily wage</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reactivate-gross-pay">Gross pay</Label>
                <Input
                  id="reactivate-gross-pay"
                  required
                  value={form.grossPay}
                  onChange={(e) => setField('grossPay', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reactivate-bank">Bank</Label>
                <select
                  id="reactivate-bank"
                  className={selectClassName}
                  value={form.bankId}
                  onChange={(e) => setBankField(e.target.value)}
                >
                  <option value="">None (cash payment)</option>
                  {(banks.data ?? []).map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name} ({bank.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reactivate-branch-code">Branch code</Label>
                <Input
                  id="reactivate-branch-code"
                  value={form.branchCode}
                  onChange={(e) => setField('branchCode', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reactivate-account-number">
                  Account number{form.bankId && <span className="text-danger"> *</span>}
                </Label>
                <Input
                  id="reactivate-account-number"
                  required={Boolean(form.bankId)}
                  value={form.accountNumber}
                  onChange={(e) => setField('accountNumber', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reactivate-iban">IBAN</Label>
                <Input
                  id="reactivate-iban"
                  value={form.iban}
                  onChange={(e) => setField('iban', e.target.value)}
                  placeholder="Optional — e.g. PK36SCBL0000001123456702"
                  maxLength={34}
                />
              </div>
            </div>
          </>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={reactivateEmployee.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={reactivateEmployee.isPending || isLoading || !employee}>
            Reactivate
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ImportResultModal({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ImportResult;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title="Import Results" widthClassName="max-w-[520px] max-h-[75vh]">
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex gap-4">
            <Badge tone="green">{result.created} created</Badge>
            <Badge tone="blue">{result.updated} updated</Badge>
            {result.skipped.length > 0 && <Badge tone="red">{result.skipped.length} skipped</Badge>}
          </div>
          {result.skipped.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-text">Skipped rows</p>
              {result.skipped.map((skip) => (
                <div key={skip.row} className="rounded border border-border bg-bg px-2.5 py-1.5">
                  Row {skip.row}: {skip.reason}
                </div>
              ))}
            </div>
          )}
        </div>
        <ModalFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function EmployeesPage({ user }: { user: SessionUser }) {
  // Scoped to this user's own accessible sites (System-Wide RBAC Consistency remediation) — never
  // the raw, `sites:manage`-aware unrestricted `useProjectSites()` list. Employees stays a strictly
  // site-scoped operational domain (docs/architecture/authentication.md's permission/scope matrix):
  // holding `sites:manage` widens Project Site/Unit administration, never Employee visibility, so
  // this filter must never offer a site the Employee Registry itself would return zero records for.
  const sites = useAccessibleProjectSites(user);
  const [siteFilter, setSiteFilter] = useState('');
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  // Action-control gating (Post-Phase-5 Stabilization Checkpoint 4B remediation) — a usability
  // layer only; the backend's own employees.routes.ts independently enforces every one of these
  // (employees:create for New Employee/Import, employees:edit for Edit/Mark as left/Reactivate).
  const canCreate = hasPermission(user, PERMISSIONS.EMPLOYEES_CREATE);
  const canEdit = hasPermission(user, PERMISSIONS.EMPLOYEES_EDIT);
  // Distinguishes "genuinely zero employees at your accessible sites" from "you have no accessible
  // sites at all" (System-Wide RBAC Consistency remediation) — the latter previously rendered as
  // the same generic "No employees found" empty state, indistinguishable from an actual empty
  // registry, even though the underlying cause (no `UserSiteAssignment` rows) is a scope/setup
  // problem an administrator needs to fix, not a filter the employee should "try adjusting."
  const hasNoAssignedSites = user.roleCode !== ROLE_CODES.MASTER_ADMIN && user.siteIds.length === 0;

  const { data: employees, isLoading } = useEmployees({
    siteIds: siteFilter ? [siteFilter] : undefined,
    activeOnly,
    search: search || undefined,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | undefined>(undefined);
  const [leavingEmployee, setLeavingEmployee] = useState<Employee | undefined>(undefined);
  const [reactivatingEmployeeId, setReactivatingEmployeeId] = useState<string | undefined>(undefined);
  const [importResult, setImportResult] = useState<ImportResult | undefined>(undefined);
  const importEmployees = useImportEmployees();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const result = await importEmployees.mutateAsync(file);
      setImportResult(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Import failed');
    }
  }

  return (
    <AppShell user={user} title="Employee Registry" subtitle="Identity, employment, and bank details">
      <Card>
        <CardHeader>
          <CardTitle>All Employees</CardTitle>
          <div className="flex gap-2 print:hidden">
            <PrintButton />
            <Button size="sm" variant="secondary" onClick={() => downloadEmployeeExport('csv')}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadEmployeeExport('xlsx')}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export Excel
            </Button>
            {canCreate && (
              <>
                <Button size="sm" variant="secondary" onClick={() => downloadEmployeeImportTemplate()}>
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Download Import Template
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importEmployees.isPending}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  {importEmployees.isPending ? 'Importing…' : 'Import'}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={handleFileSelected}
                />
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New Employee
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <PrintContextHeader title="Employee Registry" />
          <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
            <FilterField id="filter-site" label="Site">
              <select
                id="filter-site"
                className={`${selectClassName} w-48`}
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
              >
                <option value="">All assigned sites</option>
                {(sites.data ?? []).map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField id="filter-search" label="Search">
              <Input
                id="filter-search"
                className="w-56"
                placeholder="Name, CNIC, or code"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </FilterField>
            {/* Matches the row's own control height (h-9) rather than the label+control columns'
             * full height either side — with items-end, that keeps this checkbox visually centered
             * against the select/input controls' own 36px band instead of merely bottom-flush with
             * their taller (label+gap+control) columns. */}
            <label className="flex h-9 items-center gap-2 text-xs text-text-muted">
              <Checkbox checked={activeOnly} onCheckedChange={(checked) => setActiveOnly(checked === true)} />
              Active employees only
            </label>
          </div>

          {isLoading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!isLoading && employees && employees.length === 0 && hasNoAssignedSites && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">You have no assigned project sites</p>
              <p className="text-xs text-text-muted">
                Contact an administrator to get site access — this is not the same as an empty registry.
              </p>
            </div>
          )}

          {!isLoading && employees && employees.length === 0 && !hasNoAssignedSites && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No employees found</p>
              <p className="text-xs text-text-muted">Try adjusting the filters, or add the first employee.</p>
            </div>
          )}

          {!isLoading && employees && employees.length > 0 && (
            <div className="print-flow -mx-[18px] overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Pay type</TableHead>
                    <TableHead className="text-right">Gross pay</TableHead>
                    <TableHead>Status</TableHead>
                    {/* Row actions column is screen-only (Professional Printing checkpoint B3) —
                        previously printed as an empty header cell with a live dropdown trigger
                        underneath it. */}
                    <TableHead className="w-10 print:hidden" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="text-text-muted">{employee.employeeCode ?? '—'}</TableCell>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell className="text-text-muted">{employee.designation}</TableCell>
                      <TableCell className="text-text-muted">{employee.site.name}</TableCell>
                      <TableCell className="text-text-muted">
                        {employee.payType === 'DAILY_WAGE' ? 'Daily wage' : 'Monthly'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{employee.grossPay}</TableCell>
                      <TableCell>
                        <Badge tone={employee.dateOfLeaving ? 'gray' : 'green'}>
                          {employee.dateOfLeaving ? 'Left' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell className="print:hidden">
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                                aria-label={`Actions for ${employee.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setEditingEmployee(employee)}>Edit</DropdownMenuItem>
                              {!employee.dateOfLeaving && (
                                <DropdownMenuItem onSelect={() => setLeavingEmployee(employee)}>
                                  Mark as left
                                </DropdownMenuItem>
                              )}
                              {employee.dateOfLeaving && (
                                <DropdownMenuItem onSelect={() => setReactivatingEmployeeId(employee.id)}>
                                  Reactivate
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EmployeeFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultSiteId={siteFilter || undefined}
        onReactivateRequested={setReactivatingEmployeeId}
        user={user}
      />

      {editingEmployee && (
        <EmployeeFormModal
          open={Boolean(editingEmployee)}
          onOpenChange={(open) => !open && setEditingEmployee(undefined)}
          employee={editingEmployee}
          user={user}
        />
      )}

      {leavingEmployee && (
        <MarkLeftModal
          open={Boolean(leavingEmployee)}
          onOpenChange={(open) => !open && setLeavingEmployee(undefined)}
          employee={leavingEmployee}
        />
      )}

      {reactivatingEmployeeId && (
        <ReactivateEmployeeModal
          open={Boolean(reactivatingEmployeeId)}
          onOpenChange={(open) => !open && setReactivatingEmployeeId(undefined)}
          employeeId={reactivatingEmployeeId}
          user={user}
        />
      )}

      {importResult && (
        <ImportResultModal
          open={Boolean(importResult)}
          onOpenChange={(open) => !open && setImportResult(undefined)}
          result={importResult}
        />
      )}
    </AppShell>
  );
}
