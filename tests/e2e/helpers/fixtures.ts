import type { BrowserContext } from '@playwright/test';
import { apiGet, apiPost } from './api';

/** Creates one Project Site + Project Unit + Employee through the real API — the minimum fixture
 * every payroll-lifecycle-adjacent spec needs. Each caller passes a unique `label` (e.g. a spec
 * name plus a timestamp) so parallel/repeated runs against the same long-lived E2E database never
 * collide on a site/bank/employee name — the same isolation discipline
 * `backend/tests/helpers.ts`'s own `cleanTestData` relies on, applied here via unique naming
 * instead of a cleanup pass, since this harness's database is itself disposable per run
 * (`tests/e2e/setup/e2e-environment.ts`). */
export async function createSiteWithEmployee(
  context: BrowserContext,
  label: string,
): Promise<{ siteId: string; unitId: string; employeeId: string }> {
  const site = await apiPost<{ site: { id: string } }>(context, '/api/v1/sites', {
    name: `E2E Site ${label}`,
  });
  const unit = await apiPost<{ unit: { id: string } }>(context, `/api/v1/sites/${site.site.id}/units`, {
    name: `E2E Unit ${label}`,
  });
  const employee = await apiPost<{ employee: { id: string } }>(context, '/api/v1/employees', {
    name: `E2E Employee ${label}`,
    designation: 'Guard',
    siteId: site.site.id,
    unitId: unit.unit.id,
    grossPay: '30000',
  });

  return { siteId: site.site.id, unitId: unit.unit.id, employeeId: employee.employee.id };
}

/**
 * `POST /api/v1/payroll-cycles` bootstraps only the very first `PayrollCycle` the whole
 * application ever creates — every cycle after that comes only from rollover
 * (`docs/architecture/workflows/payroll-lifecycle.md`). Several independent specs in this suite
 * just need *some* Draft/Released cycle to exist (to reach a nested `/payroll-cycles/:cycleId/...`
 * route, for instance) without caring whether they or an earlier spec created it — this is the one
 * place that ambiguity is resolved: reuse whatever cycle already exists, and only bootstrap-create
 * one if the database genuinely has none yet. Safe to call from any spec in any order.
 */
export async function ensureAnyPayrollCycleExists(context: BrowserContext): Promise<{ cycleId: string }> {
  const existing = await apiGet<{ cycles: { id: string }[] }>(context, '/api/v1/payroll-cycles');
  if (existing.status === 200 && existing.body.cycles.length > 0) {
    return { cycleId: existing.body.cycles[0]!.id };
  }

  await createSiteWithEmployee(context, `bootstrap-${Date.now()}`);
  const cycle = await apiPost<{ cycle: { id: string } }>(context, '/api/v1/payroll-cycles', {
    year: 2900,
    month: 1,
  });
  return { cycleId: cycle.cycle.id };
}
