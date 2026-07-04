import type { Prisma } from '@prisma/client';
import type {
  CreateEmployeeInput,
  MarkEmployeeLeftInput,
  SessionUser,
  UpdateEmployeeInput,
} from '@payroll/shared';
import { ROLE_CODES, isoDateToUtcDate, toIsoDateOnly } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { badRequest, forbidden, notFound } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';

export const isMasterAdmin = (user: SessionUser) => user.roleCode === ROLE_CODES.MASTER_ADMIN;

/**
 * C11 decision (docs/architecture/authentication.md): Payroll Staff are fully site-scoped, with
 * no exceptions, on view/edit/create. Master Admin bypasses this entirely. Called on every read
 * and write path below — never trust a client-supplied siteId without this check.
 */
export function assertSiteAccess(user: SessionUser, siteId: string): void {
  if (isMasterAdmin(user)) return;
  if (!user.siteIds.includes(siteId)) {
    throw forbidden('You do not have access to this project site');
  }
}

/**
 * Application-layer half of the composite-FK guarantee (docs/architecture/database-schema.md §9):
 * a clean 400 here for a mismatched unit/site pair, rather than surfacing a raw Postgres foreign
 * key violation to the operator. The database's own `(unitId, siteId) -> ProjectUnit(id, siteId)`
 * constraint remains the real backstop — this check is a defense-in-depth companion to it, not a
 * substitute (same pattern already established for the Work Line same-site rule).
 */
async function assertUnitBelongsToSite(
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

  return prisma.employee.findMany({
    where: {
      ...(siteIdFilter && { siteId: { in: siteIdFilter } }),
      ...(filters.activeOnly && { dateOfLeaving: null }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { cnic: { contains: filters.search } },
          { employeeCode: { contains: filters.search, mode: 'insensitive' } },
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

export async function createEmployee(currentUser: SessionUser, input: CreateEmployeeInput) {
  assertSiteAccess(currentUser, input.siteId);
  await assertUnitBelongsToSite(input.unitId, input.siteId);

  return prisma.employee.create({
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
      accountNumber: input.accountNumber ?? null,
      accountTitle: input.accountTitle ?? null,
      ...(input.defaultEobiAmount !== undefined && { defaultEobiAmount: input.defaultEobiAmount ?? undefined }),
      ...(input.defaultEobiApplicable !== undefined && { defaultEobiApplicable: input.defaultEobiApplicable }),
    },
    include: { site: true, unit: true, bank: true },
  });
}

type JsonPrimitive = string | number | boolean | null;

function toJsonPrimitive(value: unknown): JsonPrimitive {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/** Field-level diff for the audit log's `metadata` (docs/architecture/database-schema.md §9). */
function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: JsonPrimitive; to: JsonPrimitive }> {
  const changes: Record<string, { from: JsonPrimitive; to: JsonPrimitive }> = {};
  for (const key of Object.keys(after)) {
    const normalizedBefore = toJsonPrimitive(before[key]);
    const normalizedAfter = toJsonPrimitive(after[key]);
    if (normalizedBefore !== normalizedAfter) {
      changes[key] = { from: normalizedBefore, to: normalizedAfter };
    }
  }
  return changes;
}

function omitKeys<V>(obj: Record<string, V>, keys: string[]): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Whenever this update changes `siteId` and/or `unitId`, that is a *transfer*
 * (docs/architecture/database-schema.md §9/§8b) — detected implicitly by comparing the employee's
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

  const data: Prisma.EmployeeUncheckedUpdateInput = {
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
    ...(input.accountTitle !== undefined && { accountTitle: input.accountTitle }),
    ...(input.defaultEobiAmount !== undefined && { defaultEobiAmount: input.defaultEobiAmount }),
    ...(input.defaultEobiApplicable !== undefined && { defaultEobiApplicable: input.defaultEobiApplicable }),
  };

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
      // Kept as the ISO string for the audit metadata below; converted to a UTC-midnight Date
      // only at the Prisma write, since @db.Date rejects a bare YYYY-MM-DD string.
      const effectiveDateIso = input.transferEffectiveDate ?? toIsoDateOnly(new Date());
      const effectiveDate = isoDateToUtcDate(effectiveDateIso);
      if (!effectiveDate) {
        throw badRequest('Invalid transfer effective date');
      }
      const reason = input.transferReason ?? null;
      const remarks = input.transferRemarks ?? null;

      await tx.employeeTransferHistory.create({
        data: {
          employeeId: id,
          fromSiteId: existing.siteId,
          toSiteId: nextSiteId,
          fromUnitId: existing.unitId,
          toUnitId: nextUnitId,
          effectiveDate,
          transferredByUserId: currentUser.id,
          reason,
          remarks,
        },
      });

      await recordAuditLog(
        {
          actorUserId: currentUser.id,
          action: 'employee.transferred',
          entityType: 'Employee',
          entityId: id,
          metadata: {
            fromSiteId: existing.siteId,
            toSiteId: nextSiteId,
            fromUnitId: existing.unitId,
            toUnitId: nextUnitId,
            effectiveDate: effectiveDateIso,
            reason,
            remarks,
          },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        },
        tx,
      );
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
