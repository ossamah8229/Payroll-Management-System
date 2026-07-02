import { useRef, useState, type FormEvent } from 'react';
import { Download, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError } from '@/lib/api-client';
import { useBanks } from '@/hooks/use-banks';
import { useProjectSites } from '@/hooks/use-project-sites';
import {
  downloadEmployeeExport,
  useCreateEmployee,
  useEmployees,
  useImportEmployees,
  useMarkEmployeeLeft,
  useUpdateEmployee,
  type Employee,
  type ImportResult,
} from '@/hooks/use-employees';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

function EmployeeFormModal({
  open,
  onOpenChange,
  employee,
  defaultSiteId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: Employee;
  defaultSiteId?: string;
}) {
  const sites = useProjectSites();
  const banks = useBanks();
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const isEdit = Boolean(employee);
  const isPending = createEmployee.isPending || updateEmployee.isPending;

  const [form, setForm] = useState({
    name: employee?.name ?? '',
    employeeCode: employee?.employeeCode ?? '',
    cnic: employee?.cnic ?? '',
    fatherName: employee?.fatherName ?? '',
    religion: employee?.religion ?? '',
    dateOfBirth: employee?.dateOfBirth?.slice(0, 10) ?? '',
    mobileNumber: employee?.mobileNumber ?? '',
    designation: employee?.designation ?? '',
    siteId: employee?.siteId ?? defaultSiteId ?? '',
    dateOfJoining: employee?.dateOfJoining?.slice(0, 10) ?? '',
    payType: employee?.payType ?? 'DAILY_WAGE',
    grossPay: employee?.grossPay ?? '',
    bankId: employee?.bankId ?? '',
    branchCode: employee?.branchCode ?? '',
    accountNumber: employee?.accountNumber ?? '',
    accountTitle: employee?.accountTitle ?? '',
    defaultEobiAmount: employee?.defaultEobiAmount ?? '',
    defaultEobiApplicable: employee?.defaultEobiApplicable ?? true,
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const input = {
      name: form.name,
      employeeCode: form.employeeCode || null,
      cnic: form.cnic || null,
      fatherName: form.fatherName || null,
      religion: form.religion || null,
      dateOfBirth: form.dateOfBirth || null,
      mobileNumber: form.mobileNumber || null,
      designation: form.designation,
      siteId: form.siteId,
      dateOfJoining: form.dateOfJoining || null,
      payType: form.payType,
      grossPay: form.grossPay,
      bankId: form.bankId || null,
      branchCode: form.branchCode || null,
      accountNumber: form.accountNumber || null,
      accountTitle: form.accountTitle || null,
      defaultEobiAmount: form.defaultEobiAmount || undefined,
      defaultEobiApplicable: form.defaultEobiApplicable,
    };

    try {
      if (isEdit && employee) {
        await updateEmployee.mutateAsync({ id: employee.id, input });
        toast.success('Employee updated');
      } else {
        await createEmployee.mutateAsync(input);
        toast.success('Employee created');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <ModalContent
        title={isEdit ? 'Edit Employee' : 'New Employee'}
        widthClassName="max-w-[620px] max-h-[85vh] overflow-y-auto"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <section className="flex flex-col gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Identity</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="emp-name">Full name</Label>
                <Input
                  id="emp-name"
                  required
                  maxLength={160}
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-code">Employee code</Label>
                <Input
                  id="emp-code"
                  maxLength={30}
                  value={form.employeeCode}
                  onChange={(e) => setField('employeeCode', e.target.value)}
                  placeholder="e.g. V001"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-cnic">CNIC</Label>
                <Input
                  id="emp-cnic"
                  value={form.cnic}
                  onChange={(e) => setField('cnic', e.target.value)}
                  placeholder="13 digits, optional"
                  maxLength={13}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-father">Father's name</Label>
                <Input id="emp-father" value={form.fatherName} onChange={(e) => setField('fatherName', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-religion">Religion</Label>
                <Input id="emp-religion" value={form.religion} onChange={(e) => setField('religion', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-dob">Date of birth</Label>
                <Input
                  id="emp-dob"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setField('dateOfBirth', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-mobile">Mobile number</Label>
                <Input id="emp-mobile" value={form.mobileNumber} onChange={(e) => setField('mobileNumber', e.target.value)} />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Employment</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-designation">Designation</Label>
                <Input
                  id="emp-designation"
                  required
                  maxLength={80}
                  value={form.designation}
                  onChange={(e) => setField('designation', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-site">Project site</Label>
                <select
                  id="emp-site"
                  required
                  className={selectClassName}
                  value={form.siteId}
                  onChange={(e) => setField('siteId', e.target.value)}
                >
                  <option value="" disabled>
                    Select a site
                  </option>
                  {(sites.data ?? []).map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-doj">Date of joining</Label>
                <Input
                  id="emp-doj"
                  type="date"
                  value={form.dateOfJoining}
                  onChange={(e) => setField('dateOfJoining', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-pay-type">Pay type</Label>
                <select
                  id="emp-pay-type"
                  className={selectClassName}
                  value={form.payType}
                  onChange={(e) => setField('payType', e.target.value as 'DAILY_WAGE' | 'MONTHLY')}
                >
                  <option value="DAILY_WAGE">Daily wage</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-gross-pay">Gross pay (template)</Label>
                <Input
                  id="emp-gross-pay"
                  required
                  value={form.grossPay}
                  onChange={(e) => setField('grossPay', e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Bank &amp; EOBI
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-bank">Bank</Label>
                <select
                  id="emp-bank"
                  className={selectClassName}
                  value={form.bankId}
                  onChange={(e) => setField('bankId', e.target.value)}
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
                <Label htmlFor="emp-branch-code">Branch code</Label>
                <Input id="emp-branch-code" value={form.branchCode} onChange={(e) => setField('branchCode', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-account-number">Account number</Label>
                <Input
                  id="emp-account-number"
                  value={form.accountNumber}
                  onChange={(e) => setField('accountNumber', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-account-title">Account title</Label>
                <Input
                  id="emp-account-title"
                  value={form.accountTitle}
                  onChange={(e) => setField('accountTitle', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-eobi-amount">Default EOBI amount</Label>
                <Input
                  id="emp-eobi-amount"
                  value={form.defaultEobiAmount}
                  onChange={(e) => setField('defaultEobiAmount', e.target.value)}
                  placeholder="400.00"
                />
              </div>
              <label className="flex items-center gap-2 pt-5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={form.defaultEobiApplicable}
                  onChange={(e) => setField('defaultEobiApplicable', e.target.checked)}
                />
                EOBI applicable
              </label>
            </div>
          </section>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? 'Save changes' : 'Create employee'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

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
  const [dateOfLeaving, setDateOfLeaving] = useState(new Date().toISOString().slice(0, 10));

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
          <Input
            id="leave-date"
            type="date"
            value={dateOfLeaving}
            onChange={(e) => setDateOfLeaving(e.target.value)}
          />
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
      <ModalContent title="Import Results" widthClassName="max-w-[520px] max-h-[75vh] overflow-y-auto">
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
  const sites = useProjectSites();
  const [siteFilter, setSiteFilter] = useState('');
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  const { data: employees, isLoading } = useEmployees({
    siteIds: siteFilter ? [siteFilter] : undefined,
    activeOnly,
    search: search || undefined,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | undefined>(undefined);
  const [leavingEmployee, setLeavingEmployee] = useState<Employee | undefined>(undefined);
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
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => downloadEmployeeExport('csv')}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadEmployeeExport('xlsx')}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export Excel
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
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-site">Site</Label>
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-search">Search</Label>
              <Input
                id="filter-search"
                className="w-56"
                placeholder="Name, CNIC, or code"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs text-text-muted">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Active employees only
            </label>
          </div>

          {isLoading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {!isLoading && employees && employees.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <p className="text-xs font-medium text-text">No employees found</p>
              <p className="text-xs text-text-muted">Try adjusting the filters, or add the first employee.</p>
            </div>
          )}

          {!isLoading && employees && employees.length > 0 && (
            <div className="-mx-[18px] overflow-x-auto">
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
                    <TableHead className="w-10" />
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
                      <TableCell>
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
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <EmployeeFormModal open={createOpen} onOpenChange={setCreateOpen} defaultSiteId={siteFilter || undefined} />

      {editingEmployee && (
        <EmployeeFormModal
          open={Boolean(editingEmployee)}
          onOpenChange={(open) => !open && setEditingEmployee(undefined)}
          employee={editingEmployee}
        />
      )}

      {leavingEmployee && (
        <MarkLeftModal
          open={Boolean(leavingEmployee)}
          onOpenChange={(open) => !open && setLeavingEmployee(undefined)}
          employee={leavingEmployee}
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
