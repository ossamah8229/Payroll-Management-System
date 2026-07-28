import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/**
 * Phase 7A Checkpoint 2 correction — the Statements-specific employee discovery hook, backed by
 * `GET /api/v1/statements/employees` (`backend/src/modules/statements/statements.routes.ts`'s
 * `statementEmployeesRouter`). Deliberately **not** `use-employees.ts`'s `useEmployees` — that
 * hook's own backend (`listEmployees`) scopes by `Employee.siteId` (current), which is correct for
 * its real callers (Advances' Record Advance, Corrections' Request Correction) and must stay
 * untouched. This hook's backend instead discovers employees via *historical*
 * `PayrollEntry.siteId` attribution — see the service's own doc comment for the full reasoning —
 * so a site-scoped user can find an employee who has since transferred away from their site, for
 * the specific slice of history that transfer doesn't erase.
 */

export interface StatementEmployeeCandidate {
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  currentSiteId: string;
  currentSiteName: string;
}

export interface SearchStatementEmployeesParams {
  search?: string;
  /** Optional narrowing filter — matched against historical `PayrollEntry.siteId`, never the
   * candidate's current site. */
  siteId?: string;
  /** Optional narrowing filter — matched against historical `PayrollEntryWorkLine.unitId`. */
  unitId?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchStatementEmployeesResult {
  total: number;
  page: number;
  pageSize: number;
  employees: StatementEmployeeCandidate[];
}

export function statementEmployeesUrl(params: SearchStatementEmployeesParams): string {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.siteId) query.set('siteId', params.siteId);
  if (params.unitId) query.set('unitId', params.unitId);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return `/api/v1/statements/employees${qs ? `?${qs}` : ''}`;
}

/** Only ever fetches once a search term is present (`enabled`) — mirrors `EmployeeLookup`'s own
 * established "don't fetch an unbounded org-wide list" discipline (Corrections/RBAC completion
 * checkpoint), applied here to a historical query instead of a current-site one. */
export function useStatementEmployeeSearch(params: SearchStatementEmployeesParams, enabled: boolean) {
  return useQuery({
    queryKey: [
      'statement-employees',
      params.search?.trim() ?? '',
      params.siteId ?? '',
      params.unitId ?? '',
      params.page ?? 1,
      params.pageSize ?? '',
    ],
    queryFn: () => apiRequest<SearchStatementEmployeesResult>(statementEmployeesUrl(params)),
    enabled,
  });
}
