import { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { normalizeCnic } from '@payroll/shared';
import { prisma } from '../lib/prisma';
import { assertSiteAccess, getAccessibleSiteIds } from './authz-policy';

/**
 * Shared historical-payroll employee discovery — extracted (Phase 7 Reports, Employee Payroll
 * History Checkpoint 1A) from `statements.service.ts`'s own `searchStatementEmployees`, once a
 * second caller (this report's own employee lookup) needed the *identical* query, not a similar
 * one. `searchStatementEmployees` is now a thin wrapper around `searchEmployeesByHistoricalPayroll`
 * below, preserving its own exported name/signature/behavior for every existing caller and test —
 * this extraction is behavior-preserving, not a redesign.
 *
 * **The question this answers, and why it's not the ordinary Employee Registry lookup**:
 * `employees.service.ts`'s `listEmployees` (the org-wide Employee Lookup) filters on
 * `Employee.siteId` — the employee's *current* assignment, exactly correct for that lookup's real
 * callers (Advances' Record Advance, Corrections' Request Correction: both create a *new*,
 * forward-looking obligation against an employee *today*). Statements and Employee Payroll
 * History both ask the opposite, *retrospective* question — "which employees does this caller
 * have permitted payroll history for" — so both need an employee discoverable here if and only if
 * the caller can see at least one of that employee's `PayrollEntry` rows at a site the caller is
 * scoped to (`getAccessibleSiteIds`), using the row's own frozen historical `siteId`, never the
 * related `Employee.siteId`. Draft or released entries both count (unlike Payslips, which
 * additionally requires `released = true`) — Statements' own `CYCLE_PENDING` informational rows
 * and this report's own `PENDING` row status both need a still-Draft entry to remain discoverable.
 *
 * **Deliberately does not discover an Advance-only employee** (Advance history but zero
 * `PayrollEntry` rows) — `Advance` has no site attribution of its own anywhere in this schema
 * (`docs/architecture/workflows/statements-ledger.md §7`'s documented limitation), so there is no
 * principled historical mechanism to scope such an employee by site at all. A disclosed, accepted
 * gap for both callers, not an oversight.
 *
 * **A fixed query cost, never N+1**: the site/unit historical scope is expressed as a nested
 * Prisma relation filter (`payrollEntries: { some: { siteId, workLines: { some: { unitId } } } }`),
 * compiling into the count/`findMany` queries themselves as `EXISTS` subqueries — never a
 * per-candidate follow-up query. Exactly three queries regardless of match count (one `COUNT`, one
 * `SELECT`, one Prisma-batched relation fetch for the joined `site.name`) — proven by
 * `statements.test.ts`'s own "No N+1" test, which this extraction must not weaken.
 */

export const HISTORICAL_EMPLOYEE_LOOKUP_MAX_PAGE_SIZE = 200;
export const HISTORICAL_EMPLOYEE_LOOKUP_DEFAULT_PAGE_SIZE = 50;

export interface HistoricalPayrollEmployeeLookupParams {
  search?: string;
  /** Independently validated against the caller's own accessible sites (`assertSiteAccess`)
   * before use — matched against each candidate's *historical* `PayrollEntry.siteId`, never
   * `Employee.siteId`. */
  siteId?: string;
  /** Matched against `PayrollEntryWorkLine.unitId` on the same historically-scoped `PayrollEntry`
   * a `siteId` filter would already require. */
  unitId?: string;
  page?: number;
  pageSize?: number;
}

export interface HistoricalPayrollEmployeeCandidate {
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  currentSiteId: string;
  currentSiteName: string;
}

export interface HistoricalPayrollEmployeeLookupResult {
  total: number;
  page: number;
  pageSize: number;
  employees: HistoricalPayrollEmployeeCandidate[];
}

export async function searchEmployeesByHistoricalPayroll(
  currentUser: SessionUser,
  params: HistoricalPayrollEmployeeLookupParams,
): Promise<HistoricalPayrollEmployeeLookupResult> {
  if (params.siteId) {
    assertSiteAccess(currentUser, params.siteId);
  }

  // `undefined` means "no site restriction at all" (Master Admin, no explicit filter) — the same
  // convention `getAccessibleSiteIds` itself already establishes, never conflated with `[]`
  // ("scoped to zero sites, sees nothing").
  const accessibleSiteIds = getAccessibleSiteIds(currentUser);
  const historicalSiteIds = params.siteId ? [params.siteId] : accessibleSiteIds;

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(
    HISTORICAL_EMPLOYEE_LOOKUP_MAX_PAGE_SIZE,
    Math.max(1, params.pageSize ?? HISTORICAL_EMPLOYEE_LOOKUP_DEFAULT_PAGE_SIZE),
  );

  const search = params.search?.trim();
  const normalizedCnicSearch = search ? normalizeCnic(search) : null;

  const where: Prisma.EmployeeWhereInput = {
    payrollEntries: {
      some: {
        ...(historicalSiteIds && { siteId: { in: historicalSiteIds } }),
        // Nested inside the *same* `some` as the site filter — this must be one PayrollEntry row
        // that is both at an in-scope site AND carries a matching work line, never two
        // independently-matching entries treated as if they were one.
        ...(params.unitId && { workLines: { some: { unitId: params.unitId } } }),
      },
    },
    ...(search && {
      OR: [
        { employeeCode: { contains: search, mode: 'insensitive' } },
        ...(normalizedCnicSearch ? [{ cnic: { contains: normalizedCnicSearch } }] : []),
        { name: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [total, employees] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      select: { id: true, employeeCode: true, cnic: true, name: true, siteId: true, site: { select: { name: true } } },
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    employees: employees.map((employee) => ({
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      cnic: employee.cnic,
      name: employee.name,
      currentSiteId: employee.siteId,
      currentSiteName: employee.site.name,
    })),
  };
}
