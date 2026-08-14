import { useQuery } from '@tanstack/react-query';
import type { DashboardResponse } from '@payroll/shared';
import { apiRequest } from '@/lib/api-client';

/**
 * Dashboard Checkpoint 1B — the frontend data layer over the frozen Checkpoint 1A backend
 * (`docs/architecture/workflows/dashboard.md`). `GET /api/v1/dashboard` takes no request
 * parameters at all (the backend resolves current-cycle context and Site scope internally, per
 * cycle §3 of the authorizing instruction) — so there is exactly one possible query, hence one
 * fixed, stable query key rather than a params-derived one like every other report hook in this
 * app. This is what makes "exactly one request, no fan-out" fall out of the query key shape itself
 * rather than needing a defensive check: there is only ever one cache entry for this whole page.
 */
export const DASHBOARD_QUERY_KEY = ['dashboard'] as const;

export function useDashboard() {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: () => apiRequest<DashboardResponse>('/api/v1/dashboard'),
  });
}
