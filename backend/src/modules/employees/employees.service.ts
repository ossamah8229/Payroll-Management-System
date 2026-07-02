import type { Prisma } from '@prisma/client';
import type {
  CreateEmployeeInput,
  MarkEmployeeLeftInput,
  SessionUser,
  UpdateEmployeeInput,
} from '@payroll/shared';
import { ROLE_CODES } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, forbidden, notFound } from '../../common/http-error';

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
    include: { site: true, bank: true },
    orderBy: { name: 'asc' },
  });
}

export async function getEmployee(currentUser: SessionUser, id: string) {
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { site: true, bank: true },
  });

  if (!employee) {
    throw notFound('Employee not found');
  }

  assertSiteAccess(currentUser, employee.siteId);

  return employee;
}

export async function createEmployee(currentUser: SessionUser, input: CreateEmployeeInput) {
  assertSiteAccess(currentUser, input.siteId);

  return prisma.employee.create({
    data: {
      employeeCode: input.employeeCode ?? null,
      cnic: input.cnic ?? null,
      name: input.name,
      fatherName: input.fatherName ?? null,
      religion: input.religion ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      mobileNumber: input.mobileNumber ?? null,
      designation: input.designation,
      siteId: input.siteId,
      dateOfJoining: input.dateOfJoining ?? null,
      payType: input.payType ?? undefined,
      grossPay: input.grossPay,
      bankId: input.bankId ?? null,
      branchCode: input.branchCode ?? null,
      accountNumber: input.accountNumber ?? null,
      accountTitle: input.accountTitle ?? null,
      ...(input.defaultEobiAmount !== undefined && { defaultEobiAmount: input.defaultEobiAmount ?? undefined }),
      ...(input.defaultEobiApplicable !== undefined && { defaultEobiApplicable: input.defaultEobiApplicable }),
    },
    include: { site: true, bank: true },
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

export async function updateEmployee(
  currentUser: SessionUser,
  id: string,
  input: UpdateEmployeeInput,
): Promise<{
  employee: Awaited<ReturnType<typeof getEmployee>>;
  changes: Record<string, { from: JsonPrimitive; to: JsonPrimitive }>;
}> {
  const existing = await getEmployee(currentUser, id);

  if (input.siteId !== undefined) {
    assertSiteAccess(currentUser, input.siteId);
  }

  const data: Prisma.EmployeeUncheckedUpdateInput = {
    ...(input.employeeCode !== undefined && { employeeCode: input.employeeCode }),
    ...(input.cnic !== undefined && { cnic: input.cnic }),
    ...(input.name !== undefined && { name: input.name }),
    ...(input.fatherName !== undefined && { fatherName: input.fatherName }),
    ...(input.religion !== undefined && { religion: input.religion }),
    ...(input.dateOfBirth !== undefined && { dateOfBirth: input.dateOfBirth }),
    ...(input.mobileNumber !== undefined && { mobileNumber: input.mobileNumber }),
    ...(input.designation !== undefined && { designation: input.designation }),
    ...(input.siteId !== undefined && { siteId: input.siteId }),
    ...(input.dateOfJoining !== undefined && { dateOfJoining: input.dateOfJoining }),
    ...(input.payType !== undefined && { payType: input.payType }),
    ...(input.grossPay !== undefined && { grossPay: input.grossPay }),
    ...(input.bankId !== undefined && { bankId: input.bankId }),
    ...(input.branchCode !== undefined && { branchCode: input.branchCode }),
    ...(input.accountNumber !== undefined && { accountNumber: input.accountNumber }),
    ...(input.accountTitle !== undefined && { accountTitle: input.accountTitle }),
    ...(input.defaultEobiAmount !== undefined && { defaultEobiAmount: input.defaultEobiAmount }),
    ...(input.defaultEobiApplicable !== undefined && { defaultEobiApplicable: input.defaultEobiApplicable }),
  };

  const updated = await prisma.employee.update({
    where: { id },
    data,
    include: { site: true, bank: true },
  });

  const changes = diffFields(
    existing as unknown as Record<string, unknown>,
    data as unknown as Record<string, unknown>,
  );

  return { employee: updated, changes };
}

export async function markEmployeeLeft(currentUser: SessionUser, id: string, input: MarkEmployeeLeftInput) {
  const existing = await getEmployee(currentUser, id);

  if (existing.dateOfLeaving) {
    throw badRequest('Employee has already left');
  }

  return prisma.employee.update({
    where: { id },
    data: { dateOfLeaving: input.dateOfLeaving },
    include: { site: true, bank: true },
  });
}
