import type { Prisma } from '@prisma/client';
import type {
  CreateEmployeeInput,
  MarkEmployeeLeftInput,
  SessionUser,
  UpdateEmployeeInput,
} from '@payroll/shared';
import { isoDateToUtcDate, normalizeCnic, toIsoDateOnly } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { diffFields, omitKeys, type JsonPrimitive } from '../../common/audit-diff';
import type { RequestMeta } from '../../common/request-meta';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { assertSiteAccess, isMasterAdmin } from '../../common/authz-policy';
import { syncEmployeeIntoCurrentDraftCycle } from '../payroll-processing/payroll-processing.service';

export type { RequestMeta };

/**
 * Re-exported for this module's own many existing consumers (`grep -rn "from '\.\./employees/employees.service'"`)
 * — the real definitions now live in `common/authz-policy.ts` (System-Wide RBAC Consistency
 * remediation), the single shared policy module every site-scoped service imports from directly.
 * `employees.service.ts` itself is one such consumer, not the source of truth, despite the
 * historical import path. C11 decision (docs/architecture/authentication.md): Employees is a
 * site-scoped operational domain with no global-administration permission of its own — only
 * Master Admin bypasses it; holding `sites:manage` (Project Sites/Units' own global permission)
 * does not.
 */
export { assertSiteAccess, isMasterAdmin };

/**
 * Application-layer half of the composite-FK guarantee (docs/architecture/database/employee.md §9):
 * a clean 400 here for a mismatched unit/site pair, rather than surfacing a raw Postgres foreign
 * key violation to the operator. The database's own `(unitId, siteId) -> ProjectUnit(id, siteId)`
 * constraint remains the real backstop — this check is a defense-in-depth companion to it, not a
 * substitute (same pattern already established for the Work Line same-site rule).
 */
export async function assertUnitBelongsToSite(
  unitId: string,
  siteId: string,
  client: PrismaTransactionClient = prisma,
): Promise<void> {
  const unit = await client.projectUnit.findUnique({ where: { id: unitId } });
  if (!unit) {
    throw badRequest('Selected unit does not exist');
  }
  if (unit.siteId !== siteId) {
    throw badRequest('Selected unit does not belong to the selected site');
  }
}

export interface CnicAvailability {
  exists: boolean;
  employee: {
    id: string;
    name: string;
    employeeCode: string | null;
    siteId: string;
    siteName: string;
    dateOfLeaving: string | null;
    active: boolean;
  } | null;
}

/**
 * The single lookup implementation for "does an Employee already hold this CNIC" — normalizes the
 * same way `createEmployeeSchema`/`updateEmployeeSchema` do (`normalizeCnic`, shared/src/lib/cnic.ts)
 * and is the one place both the duplicate-check endpoint (`checkCnicAvailability`, below) and the
 * CSV/Excel importer's existing-employee match (`employees-import-export.service.ts`) look a CNIC
 * up. A raw, un-normalized comparison here was a real bug: a dashed CNIC in an import row wouldn't
 * match the digits-only value stored on the existing row, so a rehire's row would silently attempt
 * to *create* a second employee instead of finding the one already on file.
 */
export async function findEmployeeByCnic(
  rawCnic: string,
  options: { excludeEmployeeId?: string; client?: PrismaTransactionClient } = {},
) {
  const normalized = normalizeCnic(rawCnic);
  if (!normalized) return null;
  const client = options.client ?? prisma;
  return client.employee.findFirst({
    where: {
      cnic: normalized,
      ...(options.excludeEmployeeId ? { id: { not: options.excludeEmployeeId } } : {}),
    },
    include: { site: true },
  });
}

/**
 * Debounced pre-submit duplicate-check lookup (docs/architecture/database/schema-invariants.md §26 item 6) —
 * lets an operator learn about a CNIC collision, and which employee owns it, before hitting a raw
 * 409 on submit. RBAC-aware: a Payroll Staff caller learns *that* a duplicate exists (so they know
 * to stop and involve a Master Admin) but never the identity/site of an employee outside their own
 * site assignment (C11, no exceptions) — Master Admin always sees full details.
 */
export async function checkCnicAvailability(
  currentUser: SessionUser,
  rawCnic: string,
  excludeEmployeeId?: string,
): Promise<CnicAvailability> {
  const normalized = normalizeCnic(rawCnic);
  if (!normalized || !/^\d{13}$/.test(normalized)) {
    throw badRequest('CNIC must be exactly 13 digits');
  }

  const existing = await findEmployeeByCnic(normalized, { excludeEmployeeId });

  if (!existing) {
    return { exists: false, employee: null };
  }

  const canSeeDetails = isMasterAdmin(currentUser) || currentUser.siteIds.includes(existing.siteId);
  if (!canSeeDetails) {
    return { exists: true, employee: null };
  }

  return {
    exists: true,
    employee: {
      id: existing.id,
      name: existing.name,
      employeeCode: existing.employeeCode,
      siteId: existing.siteId,
      siteName: existing.site.name,
      dateOfLeaving: existing.dateOfLeaving ? toIsoDateOnly(existing.dateOfLeaving) : null,
      active: !existing.dateOfLeaving,
    },
  };
}

export interface ListEmployeesFilters {
  siteIds?: string[];
  activeOnly?: boolean;
  search?: string;
}

export async function listEmployees(currentUser: SessionUser, filters: ListEmployeesFilters) {
  const allowedSiteIds = isMasterAdmin(currentUser) ? filters.siteIds : currentUser.siteIds;

  // A Payroll Staff user's effective site filter is always the intersection of their assignment
  // and any client-requested filter — never the client filter alone, so a manipulated siteId in
  // the query string can't widen access beyond the assignment.
  const siteIdFilter =
    !isMasterAdmin(currentUser) && filters.siteIds
      ? filters.siteIds.filter((id) => currentUser.siteIds.includes(id))
      : allowedSiteIds;

  // Reusable Employee Lookup search (Corrections/RBAC completion checkpoint) — covers every field
  // the lookup's own documented priority order names (Employee Code, CNIC, Account Number, IBAN,
  // Name, Site, Branch/Unit), not just Name/CNIC/Code. An empty normalized-digits CNIC candidate
  // (the search term contains no digits at all, e.g. a pure-name search) is deliberately omitted
  // from the OR list rather than passed through as an empty-string `contains`, which would
  // otherwise match every row regardless of `dateOfLeaving`/site scope.
  const normalizedCnicSearch = filters.search ? normalizeCnic(filters.search) : null;

  return prisma.employee.findMany({
    where: {
      ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
      ...(filters.activeOnly && { dateOfLeaving: null }),
      ...(filters.search && {
        OR: [
          { employeeCode: { contains: filters.search, mode: 'insensitive' } },
          ...(normalizedCnicSearch ? [{ cnic: { contains: normalizedCnicSearch } }] : []),
          { accountNumber: { contains: filters.search, mode: 'insensitive' } },
          { iban: { contains: filters.search, mode: 'insensitive' } },
          { name: { contains: filters.search, mode: 'insensitive' } },
          { site: { name: { contains: filters.search, mode: 'insensitive' } } },
          { unit: { name: { contains: filters.search, mode: 'insensitive' } } },
        ],
      }),
    },
    include: { site: true, unit: true, bank: true },
    orderBy: { name: 'asc' },
  });
}

export async function getEmployee(currentUser: SessionUser, id: string) {
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { site: true, unit: true, bank: true },
  });

  if (!employee) {
    throw notFound('Employee not found');
  }

  assertSiteAccess(currentUser, employee.siteId);

  return employee;
}

export async function createEmployee(
  currentUser: SessionUser,
  input: CreateEmployeeInput,
  requestMeta: RequestMeta,
) {
  assertSiteAccess(currentUser, input.siteId);
  await assertUnitBelongsToSite(input.unitId, input.siteId);

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        employeeCode: input.employeeCode ?? null,
        cnic: input.cnic ?? null,
        name: input.name,
        fatherName: input.fatherName ?? null,
        religion: input.religion ?? null,
        dateOfBirth: isoDateToUtcDate(input.dateOfBirth),
        mobileNumber: input.mobileNumber ?? null,
        designation: input.designation,
        siteId: input.siteId,
        unitId: input.unitId,
        dateOfJoining: isoDateToUtcDate(input.dateOfJoining),
        payType: input.payType ?? undefined,
        grossPay: input.grossPay,
        bankId: input.bankId ?? null,
        branchCode: input.branchCode ?? null,
        // A cash employee (no bank) never has an Account Number/IBAN on file — enforced here even
        // though `createEmployeeSchema` already rejects "bank set, no Account Number", since the
        // reverse (no bank, but an Account Number/IBAN supplied anyway) is a normalization, not a
        // rejection (docs/architecture/database/employee.md §7's banking-fields note).
        accountNumber: input.bankId ? (input.accountNumber ?? null) : null,
        iban: input.bankId ? (input.iban ?? null) : null,
        ...(input.defaultEobiAmount !== undefined && { defaultEobiAmount: input.defaultEobiAmount ?? undefined }),
        ...(input.defaultEobiApplicable !== undefined && { defaultEobiApplicable: input.defaultEobiApplicable }),
      },
      include: { site: true, unit: true, bank: true },
    });

    // Operational Stabilization Checkpoint (2026-07-24) — a newly created, active employee is
    // immediately eligible for the current Draft cycle, if one exists; see
    // `syncEmployeeIntoCurrentDraftCycle`'s own doc comment for why this was previously missing.
    await syncEmployeeIntoCurrentDraftCycle(tx, employee, currentUser.id, requestMeta);

    return employee;
  });
}

/**
 * Records an Employee site/unit transfer inside an already-open transaction: the
 * `EmployeeTransferHistory` row and the dedicated `employee.transferred` `AuditLog` entry, always
 * together (docs/architecture/database/employee.md §8b/§9). This is the single implementation of
 * that invariant — the ordinary update path (`updateEmployee`) and the CSV/Excel import path
 * (Phase 2.5 Checkpoint 3, the first import that can change an employee's site/unit) both call
 * it. The caller owns the `Employee` row update itself and the enclosing transaction; this only
 * writes the two transfer-trail records, so the three writes commit or roll back as one.
 */
export async function recordEmployeeTransfer(
  tx: PrismaTransactionClient,
  args: {
    employeeId: string;
    fromSiteId: string;
    toSiteId: string;
    fromUnitId: string;
    toUnitId: string;
    actorUserId: string;
    effectiveDateIso?: string | null;
    reason?: string | null;
    remarks?: string | null;
    requestMeta: RequestMeta;
  },
): Promise<void> {
  // Kept as the ISO string for the audit metadata below; converted to a UTC-midnight Date only
  // at the Prisma write, since @db.Date rejects a bare YYYY-MM-DD string.
  const effectiveDateIso = args.effectiveDateIso ?? toIsoDateOnly(new Date());
  const effectiveDate = isoDateToUtcDate(effectiveDateIso);
  if (!effectiveDate) {
    throw badRequest('Invalid transfer effective date');
  }
  const reason = args.reason ?? null;
  const remarks = args.remarks ?? null;

  await tx.employeeTransferHistory.create({
    data: {
      employeeId: args.employeeId,
      fromSiteId: args.fromSiteId,
      toSiteId: args.toSiteId,
      fromUnitId: args.fromUnitId,
      toUnitId: args.toUnitId,
      effectiveDate,
      transferredByUserId: args.actorUserId,
      reason,
      remarks,
    },
  });

  await recordAuditLog(
    {
      actorUserId: args.actorUserId,
      action: 'employee.transferred',
      entityType: 'Employee',
      entityId: args.employeeId,
      metadata: {
        fromSiteId: args.fromSiteId,
        toSiteId: args.toSiteId,
        fromUnitId: args.fromUnitId,
        toUnitId: args.toUnitId,
        effectiveDate: effectiveDateIso,
        reason,
        remarks,
      },
      ipAddress: args.requestMeta.ipAddress,
      userAgent: args.requestMeta.userAgent,
    },
    tx,
  );
}

/**
 * Maps a partial `UpdateEmployeeInput` onto a Prisma update payload — every field is applied only
 * if the caller actually provided it (an omitted field must leave the stored value untouched, the
 * same partial-update semantics `updateEmployeeSchema` is built for). The single implementation of
 * that mapping, shared by `updateEmployee` (an ordinary edit) and `reactivateEmployee` (a rehire,
 * below) — both apply the same field set, differing only in which extra writes/audit entries
 * accompany them.
 */
function mapUpdateInputToData(input: UpdateEmployeeInput): Prisma.EmployeeUncheckedUpdateInput {
  return {
    ...(input.employeeCode !== undefined && { employeeCode: input.employeeCode }),
    ...(input.cnic !== undefined && { cnic: input.cnic }),
    ...(input.name !== undefined && { name: input.name }),
    ...(input.fatherName !== undefined && { fatherName: input.fatherName }),
    ...(input.religion !== undefined && { religion: input.religion }),
    ...(input.dateOfBirth !== undefined && { dateOfBirth: isoDateToUtcDate(input.dateOfBirth) }),
    ...(input.mobileNumber !== undefined && { mobileNumber: input.mobileNumber }),
    ...(input.designation !== undefined && { designation: input.designation }),
    ...(input.siteId !== undefined && { siteId: input.siteId }),
    ...(input.unitId !== undefined && { unitId: input.unitId }),
    ...(input.dateOfJoining !== undefined && { dateOfJoining: isoDateToUtcDate(input.dateOfJoining) }),
    ...(input.payType !== undefined && { payType: input.payType }),
    ...(input.grossPay !== undefined && { grossPay: input.grossPay }),
    ...(input.bankId !== undefined && { bankId: input.bankId }),
    ...(input.branchCode !== undefined && { branchCode: input.branchCode }),
    ...(input.accountNumber !== undefined && { accountNumber: input.accountNumber }),
    ...(input.iban !== undefined && { iban: input.iban }),
    ...(input.defaultEobiAmount !== undefined && { defaultEobiAmount: input.defaultEobiAmount }),
    ...(input.defaultEobiApplicable !== undefined && { defaultEobiApplicable: input.defaultEobiApplicable }),
  };
}

/**
 * Banking rule (2026-07-11 refinement): a bank employee (non-null `bankId`) must have an Account
 * Number on file; a cash employee (`bankId` null) never has an Account Number or IBAN. `update`/
 * `reactivate` are partial patches, so this must be checked against the **merged** effective state
 * (existing row + this request's changes), never the request body alone — a request that only
 * touches `accountNumber` while `bankId` was already set on the existing row must still pass, and a
 * request that clears `bankId` must still force `accountNumber`/`iban` to null even if this request
 * didn't mention them, so a cash employee can never be left with stale bank details on file.
 * Mutates `data` in place to add the forced-null normalization; throws on the "bank with no
 * account number" violation, matching `createEmployeeSchema`'s own rejection for the create path.
 */
function applyBankingInvariant(
  existing: { bankId: string | null; accountNumber: string | null },
  data: Prisma.EmployeeUncheckedUpdateInput,
): void {
  const nextBankId = 'bankId' in data ? (data.bankId as string | null) : existing.bankId;
  const nextAccountNumber = 'accountNumber' in data ? (data.accountNumber as string | null) : existing.accountNumber;

  if (!nextBankId) {
    data.accountNumber = null;
    data.iban = null;
    return;
  }

  if (!nextAccountNumber) {
    throw badRequest('Account Number is required when a bank is selected');
  }
}

/**
 * Whenever this update changes `siteId` and/or `unitId`, that is a *transfer*
 * (docs/architecture/database/employee.md §9/§8b) — detected implicitly by comparing the employee's
 * current site/unit against the submitted one, not via a separate endpoint. A transfer writes the
 * `Employee` update, an `EmployeeTransferHistory` row, and a dedicated `employee.transferred`
 * `AuditLog` entry (never the generic `employee.updated` entry for those two fields specifically)
 * all in one transaction — Principle 3, and the explicit 2026-07-03 Checkpoint 2 requirement that
 * these three writes are atomic. Any *other* fields changed in the same request still produce the
 * ordinary `employee.updated` entry, unaffected.
 */
export async function updateEmployee(
  currentUser: SessionUser,
  id: string,
  input: UpdateEmployeeInput,
  requestMeta: RequestMeta,
): Promise<{
  employee: Awaited<ReturnType<typeof getEmployee>>;
  changes: Record<string, { from: JsonPrimitive; to: JsonPrimitive }>;
  transferred: boolean;
}> {
  const existing = await getEmployee(currentUser, id);

  if (input.siteId !== undefined) {
    assertSiteAccess(currentUser, input.siteId);
  }

  const nextSiteId = input.siteId ?? existing.siteId;
  const nextUnitId = input.unitId ?? existing.unitId;
  const isTransfer = nextSiteId !== existing.siteId || nextUnitId !== existing.unitId;

  if (isTransfer) {
    await assertUnitBelongsToSite(nextUnitId, nextSiteId);
  }

  const data = mapUpdateInputToData(input);
  applyBankingInvariant(existing, data);

  const allChanges = diffFields(
    existing as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  const employee = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id },
      data,
      include: { site: true, unit: true, bank: true },
    });

    if (isTransfer) {
      await recordEmployeeTransfer(tx, {
        employeeId: id,
        fromSiteId: existing.siteId,
        toSiteId: nextSiteId,
        fromUnitId: existing.unitId,
        toUnitId: nextUnitId,
        actorUserId: currentUser.id,
        effectiveDateIso: input.transferEffectiveDate,
        reason: input.transferReason,
        remarks: input.transferRemarks,
        requestMeta,
      });
    }

    // siteId/unitId already have their own dedicated employee.transferred entry above when
    // they're the reason for this update — never double-logged into the generic entry too.
    const genericChanges = omitKeys(allChanges, ['siteId', 'unitId']);
    if (Object.keys(genericChanges).length > 0) {
      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'employee.updated',
          entityType: 'Employee',
          entityId: id,
          metadata: { changes: genericChanges },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
    }

    return updated;
  });

  return { employee, changes: allChanges, transferred: isTransfer };
}

export async function markEmployeeLeft(currentUser: SessionUser, id: string, input: MarkEmployeeLeftInput) {
  const existing = await getEmployee(currentUser, id);

  if (existing.dateOfLeaving) {
    throw badRequest('Employee has already left');
  }

  return prisma.employee.update({
    where: { id },
    data: { dateOfLeaving: isoDateToUtcDate(input.dateOfLeaving) },
    include: { site: true, unit: true, bank: true },
  });
}

/**
 * The Reactivate Employee action (docs/architecture/database/schema-invariants.md §26 item 6, finalized
 * 2026-07-03/04) — the *only* path in the system that clears `dateOfLeaving`. CNIC stays globally
 * unique with no override: a rehire is never a second `Employee` row, it is this same existing row
 * reactivated in place, so every historical `PayrollEntry` keeps referencing the one, unchanged
 * `employeeId` (Principle 2). **Single source of truth**: every caller that can reactivate an
 * employee — the UI's Reactivate action and the CSV/Excel importer's rehire-via-import case
 * (`employees-import-export.service.ts`) — calls this function; neither reimplements the guard,
 * the field update, or the audit trail.
 *
 * Reuses the exact same partial-update field set as an ordinary edit (`mapUpdateInputToData`) —
 * "updates the employee's current employment details (site, unit, designation, bank details, etc.)"
 * is simply whichever of those fields the caller supplies, same as `updateEmployee`. If the
 * supplied `siteId`/`unitId` also differs from what's on file, that is an independent fact (a
 * transfer) and fires alongside reactivation exactly as `updateEmployee` already does — the same
 * `recordEmployeeTransfer()` helper, not a reimplementation.
 */
export async function reactivateEmployee(
  currentUser: SessionUser,
  id: string,
  input: UpdateEmployeeInput,
  requestMeta: RequestMeta,
): Promise<{
  employee: Awaited<ReturnType<typeof getEmployee>>;
  changes: Record<string, { from: JsonPrimitive; to: JsonPrimitive }>;
  transferred: boolean;
}> {
  const existing = await getEmployee(currentUser, id);

  if (!existing.dateOfLeaving) {
    throw badRequest('Employee is already active');
  }

  if (input.siteId !== undefined) {
    assertSiteAccess(currentUser, input.siteId);
  }

  const nextSiteId = input.siteId ?? existing.siteId;
  const nextUnitId = input.unitId ?? existing.unitId;
  const isTransfer = nextSiteId !== existing.siteId || nextUnitId !== existing.unitId;

  if (isTransfer) {
    await assertUnitBelongsToSite(nextUnitId, nextSiteId);
  }

  const previousDateOfLeaving = toIsoDateOnly(existing.dateOfLeaving);

  const data: Prisma.EmployeeUncheckedUpdateInput = {
    ...mapUpdateInputToData(input),
    dateOfLeaving: null,
  };
  applyBankingInvariant(existing, data);

  const allChanges = diffFields(
    existing as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  const employee = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id },
      data,
      include: { site: true, unit: true, bank: true },
    });

    if (isTransfer) {
      await recordEmployeeTransfer(tx, {
        employeeId: id,
        fromSiteId: existing.siteId,
        toSiteId: nextSiteId,
        fromUnitId: existing.unitId,
        toUnitId: nextUnitId,
        actorUserId: currentUser.id,
        effectiveDateIso: input.transferEffectiveDate,
        reason: input.transferReason,
        remarks: input.transferRemarks,
        requestMeta,
      });
    }

    // Distinct from `employee.updated` (and never accompanied by it) — reactivation is a business
    // event in its own right, same treatment as `employee.left` (markEmployeeLeft) and
    // `employee.transferred` above. siteId/unitId changes are already covered by that transfer
    // entry, so they're excluded here the same way updateEmployee excludes them from its generic
    // employee.updated entry.
    const fieldChanges = omitKeys(allChanges, ['siteId', 'unitId', 'dateOfLeaving']);
    await recordAuditLog(
      {
        actorUserId: currentUser.id,
        action: 'employee.reactivated',
        entityType: 'Employee',
        entityId: id,
        metadata: { previousDateOfLeaving, changes: fieldChanges },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      },
      tx,
    );

    // Operational Stabilization Checkpoint (2026-07-24) — a rehire is immediately eligible for the
    // current Draft cycle again, same as a genuinely new employee; see
    // `syncEmployeeIntoCurrentDraftCycle`'s own doc comment.
    await syncEmployeeIntoCurrentDraftCycle(tx, updated, currentUser.id, requestMeta);

    return updated;
  });

  return { employee, changes: allChanges, transferred: isTransfer };
}
