import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { normalizeCnic, toIsoDateOnly, type SessionUser } from '@payroll/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Checkbox } from '@/components/ui/checkbox';
import { ApiError } from '@/lib/api-client';
import { useBanks } from '@/hooks/use-banks';
import { SiteUnitSelect } from '@/components/ui/site-unit-select';
import {
  checkCnicAvailability,
  useCreateEmployee,
  useUpdateEmployee,
  type CnicAvailability,
  type Employee,
} from '@/hooks/use-employees';

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light';

/** The one place this form's shape is built from an `Employee` (edit) or blank (create) — used
 * both by the initial `useState` and by the open-triggered reset effect below, so there is exactly
 * one implementation of "what a fresh form looks like," never two definitions that could drift
 * apart. */
function buildEmployeeForm(employee: Employee | undefined, defaultSiteId: string | undefined) {
  return {
    name: employee?.name ?? '',
    employeeCode: employee?.employeeCode ?? '',
    cnic: employee?.cnic ?? '',
    fatherName: employee?.fatherName ?? '',
    religion: employee?.religion ?? '',
    dateOfBirth: toIsoDateOnly(employee?.dateOfBirth),
    mobileNumber: employee?.mobileNumber ?? '',
    designation: employee?.designation ?? '',
    siteId: employee?.siteId ?? defaultSiteId ?? '',
    unitId: employee?.unitId ?? '',
    dateOfJoining: toIsoDateOnly(employee?.dateOfJoining),
    payType: employee?.payType ?? ('DAILY_WAGE' as const),
    grossPay: employee?.grossPay ?? '',
    bankId: employee?.bankId ?? '',
    branchCode: employee?.branchCode ?? '',
    accountNumber: employee?.accountNumber ?? '',
    iban: employee?.iban ?? '',
    defaultEobiAmount: employee?.defaultEobiAmount ?? '',
    defaultEobiApplicable: employee?.defaultEobiApplicable ?? true,
  };
}

/**
 * The single create/edit Employee form, shared by Employee Registry's own "New Employee"/"Edit"
 * actions and Payroll Entry's "New Employee" quick action (UAT 2026-08-10) — one modal, one
 * validation path, one submission path, one permission-gated backend route
 * (`employees.routes.ts`'s `EMPLOYEES_CREATE`/`EMPLOYEES_EDIT`), regardless of which page opened
 * it. Extracted from `employees-page.tsx` (previously page-local) rather than duplicated, so a
 * second caller can never drift into a second implementation of employee creation.
 */
export function EmployeeFormModal({
  open,
  onOpenChange,
  employee,
  defaultSiteId,
  onReactivateRequested,
  onCreated,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: Employee;
  defaultSiteId?: string;
  onReactivateRequested?: (employeeId: string) => void;
  /** Fires after a successful *create* only (never edit) — Payroll Entry's "New Employee" quick
   * action uses this to re-run its own Draft-cycle roster reconciliation so the new employee can
   * appear in the grid without a full refresh; Employee Registry has no use for it and omits it. */
  onCreated?: () => void;
  user: SessionUser;
}) {
  const banks = useBanks();
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const isEdit = Boolean(employee);
  const isPending = createEmployee.isPending || updateEmployee.isPending;

  const [form, setForm] = useState(() => buildEmployeeForm(employee, defaultSiteId));

  // A modal instance mounted once and only ever toggled via its `open` prop (both callers do
  // this) would otherwise carry the previous submission's field values into the next "New
  // Employee" open — every field (bank, account number, designation, gross pay, etc.) reset here
  // on every open, not just at first mount, is what guarantees a blank/generic create state every
  // time (Phase 4 Checkpoint 3's own real-stack Playwright verification originally found this).
  useEffect(() => {
    if (open) {
      setForm(buildEmployeeForm(employee, defaultSiteId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Banking rule (2026-07-11 refinement): a cash employee (no bank selected) never has an Account
  // Number/IBAN on file — the server normalizes this regardless, but clearing it here too means the
  // form never *displays* a stale value the submission is about to silently drop.
  function setBankField(bankId: string) {
    setForm((prev) => (bankId ? { ...prev, bankId } : { ...prev, bankId: '', accountNumber: '', iban: '' }));
  }

  const [cnicAvailability, setCnicAvailability] = useState<CnicAvailability | undefined>(undefined);

  // Debounced pre-submit duplicate-check (docs/architecture/database/schema-invariants.md §26 item 6) — only
  // fires once the field holds a complete, normalized 13-digit CNIC, and is skipped entirely when
  // editing an employee whose CNIC hasn't changed (excludeId also guards against a same-record
  // false positive if it has).
  useEffect(() => {
    const normalized = normalizeCnic(form.cnic);
    if (!normalized || normalized.length !== 13) {
      setCnicAvailability(undefined);
      return;
    }
    if (isEdit && normalized === normalizeCnic(employee?.cnic ?? '')) {
      setCnicAvailability(undefined);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      checkCnicAvailability(normalized, employee?.id)
        .then((result) => {
          if (!cancelled) setCnicAvailability(result);
        })
        .catch(() => {
          if (!cancelled) setCnicAvailability(undefined);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.cnic, isEdit, employee?.cnic, employee?.id]);

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
      unitId: form.unitId,
      dateOfJoining: form.dateOfJoining || null,
      payType: form.payType,
      grossPay: form.grossPay,
      bankId: form.bankId || null,
      branchCode: form.branchCode || null,
      accountNumber: form.accountNumber || null,
      iban: form.iban || null,
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
        onCreated?.();
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
        widthClassName="max-w-[620px]"
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
                  maxLength={15}
                />
                {cnicAvailability?.exists && (
                  <div className="rounded border border-warning bg-warning-light px-2.5 py-1.5 text-[11px] text-text">
                    {cnicAvailability.employee ? (
                      <>
                        Already registered to <span className="font-medium">{cnicAvailability.employee.name}</span> at{' '}
                        {cnicAvailability.employee.siteName} (
                        {cnicAvailability.employee.active ? 'active' : 'departed'}).
                        {!cnicAvailability.employee.active && onReactivateRequested && (
                          <>
                            {' '}
                            <button
                              type="button"
                              className="font-medium underline underline-offset-2 hover:no-underline"
                              onClick={() => {
                                onReactivateRequested(cnicAvailability.employee!.id);
                                onOpenChange(false);
                              }}
                            >
                              Reactivate instead
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      'This CNIC is already registered to an employee outside your assigned sites — contact a Master User.'
                    )}
                  </div>
                )}
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
                <DateInput
                  id="emp-dob"
                  value={form.dateOfBirth}
                  onChange={(iso) => setField('dateOfBirth', iso)}
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
              <SiteUnitSelect
                siteId={form.siteId}
                unitId={form.unitId}
                onSiteChange={(siteId) => setField('siteId', siteId)}
                onUnitChange={(unitId) => setField('unitId', unitId)}
                user={user}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-doj">Date of joining</Label>
                <DateInput
                  id="emp-doj"
                  value={form.dateOfJoining}
                  onChange={(iso) => setField('dateOfJoining', iso)}
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
                <Label htmlFor="emp-gross-pay">Default Gross Pay</Label>
                <Input
                  id="emp-gross-pay"
                  required
                  value={form.grossPay}
                  onChange={(e) => setField('grossPay', e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-xs text-text-muted">
                  Used as the starting gross pay in new payroll cycles.
                </p>
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
                <Label htmlFor="emp-branch-code">Branch code</Label>
                <Input id="emp-branch-code" value={form.branchCode} onChange={(e) => setField('branchCode', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-account-number">
                  Account number{form.bankId && <span className="text-danger"> *</span>}
                </Label>
                <Input
                  id="emp-account-number"
                  required={Boolean(form.bankId)}
                  value={form.accountNumber}
                  onChange={(e) => setField('accountNumber', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="emp-iban">IBAN</Label>
                <Input
                  id="emp-iban"
                  value={form.iban}
                  onChange={(e) => setField('iban', e.target.value)}
                  placeholder="Optional — e.g. PK36SCBL0000001123456702"
                  maxLength={34}
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
                <Checkbox
                  checked={form.defaultEobiApplicable}
                  onCheckedChange={(checked) => setField('defaultEobiApplicable', checked === true)}
                />
                EOBI applicable
              </label>
            </div>
          </section>

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || (!isEdit && cnicAvailability?.exists)}>
              {isEdit ? 'Save changes' : 'Create employee'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
