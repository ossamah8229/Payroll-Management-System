import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PERMISSIONS } from '@payroll/shared';
import { useSession } from '@/hooks/use-session';
import { RouteLoadingFallback } from '@/components/layout/route-loading-fallback';
import { RouteErrorBoundary } from '@/components/layout/route-error-boundary';
import { RequirePermission } from '@/components/layout/require-permission';
import { LoginPage } from '@/routes/login-page';
import { NotFoundPage } from '@/routes/not-found-page';

/**
 * AUD-012 (Post-Phase-5 Stabilization Checkpoint 4) — every authenticated page-level route is
 * lazy-loaded, so its own code (and whatever it pulls in — grids, PDF-adjacent Payslips code,
 * import/export builders, etc.) is fetched only when that route is actually navigated to, not as
 * part of the initial bundle every session pays for regardless of which pages it ever visits.
 * `LoginPage` and `NotFoundPage` are deliberately NOT lazy — `LoginPage` is the very first screen
 * an unauthenticated session renders, so lazy-loading it would insert a network round trip before
 * a user can even see the login form; `NotFoundPage` is tiny and needed for the catch-all `*` route
 * to resolve immediately. Each `.then(module => ...)` adapts this codebase's own named-export
 * convention (`export function XPage`) to `React.lazy`'s required default-export shape — no route
 * component's own export style changed.
 */
const HomePage = lazy(() => import('@/routes/home-page').then((m) => ({ default: m.HomePage })));
const ProjectSitesPage = lazy(() =>
  import('@/routes/project-sites-page').then((m) => ({ default: m.ProjectSitesPage })),
);
const EmployeesPage = lazy(() => import('@/routes/employees-page').then((m) => ({ default: m.EmployeesPage })));
const PayrollEntryPage = lazy(() =>
  import('@/routes/payroll-entry-page').then((m) => ({ default: m.PayrollEntryPage })),
);
const SalaryReleasePage = lazy(() =>
  import('@/routes/salary-release-page').then((m) => ({ default: m.SalaryReleasePage })),
);
const BankSheetPage = lazy(() => import('@/routes/bank-sheet-page').then((m) => ({ default: m.BankSheetPage })));
const CashReceivingPage = lazy(() =>
  import('@/routes/cash-receiving-page').then((m) => ({ default: m.CashReceivingPage })),
);
const AdvancesPage = lazy(() => import('@/routes/advances-page').then((m) => ({ default: m.AdvancesPage })));
const PayslipsPage = lazy(() => import('@/routes/payslips-page').then((m) => ({ default: m.PayslipsPage })));
const SettingsPage = lazy(() => import('@/routes/settings-page').then((m) => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import('@/routes/users-page').then((m) => ({ default: m.UsersPage })));
const RolesPage = lazy(() => import('@/routes/roles-page').then((m) => ({ default: m.RolesPage })));
const CorrectionsPage = lazy(() =>
  import('@/routes/corrections-page').then((m) => ({ default: m.CorrectionsPage })),
);
const CorrectionRequestDetailPage = lazy(() =>
  import('@/routes/correction-request-detail-page').then((m) => ({ default: m.CorrectionRequestDetailPage })),
);
const BalanceAdjustmentDetailPage = lazy(() =>
  import('@/routes/balance-adjustment-detail-page').then((m) => ({ default: m.BalanceAdjustmentDetailPage })),
);

/** Gates any route that requires an authenticated session, redirecting to /login otherwise. This
 * loading state (the session fetch) is unrelated to a lazy route's own code-loading state (handled
 * by the `<Suspense>` boundary in `App`, below) but reuses the identical fallback for visual
 * consistency — a user should never be able to tell which kind of "loading" they're seeing. */
function RequireSession({
  children,
}: {
  children: (user: NonNullable<ReturnType<typeof useSession>['data']>) => ReactNode;
}) {
  const { data: sessionUser, isLoading } = useSession();

  if (isLoading) return <RouteLoadingFallback />;
  if (!sessionUser) return <Navigate to="/login" replace />;

  return <>{children(sessionUser)}</>;
}

export function App() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireSession>{(user) => <HomePage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/sites"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.SITES_MANAGE}>
                    <ProjectSitesPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/employees"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.EMPLOYEES_VIEW}>
                    <EmployeesPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          {/*
           * Historical Payroll Cycle Selector routing (Phase 5 Checkpoint 4) — every cycle-aware
           * page is mounted at two paths, both rendering the exact same component: the original
           * flat path (kept as a compatibility redirect — `useSelectedPayrollCycle` resolves the
           * default cycle and navigates to the canonical URL below) and the canonical
           * `/payroll-cycles/:cycleId/...` path a bookmark/refresh/back-forward can target
           * directly. `useParams` returns `undefined` for `cycleId` on the flat route and the
           * actual value on the nested one — the same page component handles both via one shared
           * hook, not two separate implementations.
           */}
          <Route
            path="/payroll-entry"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_ENTRY}>
                    <PayrollEntryPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/payroll-entry"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_ENTRY}>
                    <PayrollEntryPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/release"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_VIEW}>
                    <SalaryReleasePage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/release"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.PAYROLL_VIEW}>
                    <SalaryReleasePage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/bank-sheet"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
                    <BankSheetPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/bank-sheet"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
                    <BankSheetPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/cash-receiving"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
                    <CashReceivingPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/cash-receiving"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.BANK_SHEETS_VIEW}>
                    <CashReceivingPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/advances"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.ADVANCES_MANAGE}>
                    <AdvancesPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/payslips"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.PAYSLIPS_VIEW}>
                    <PayslipsPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/payslips"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.PAYSLIPS_VIEW}>
                    <PayslipsPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/corrections"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission
                    user={user}
                    permission={[PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE]}
                  >
                    <CorrectionsPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/corrections/requests/:id"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission
                    user={user}
                    permission={[PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE]}
                  >
                    <CorrectionRequestDetailPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/corrections/ledger/:id"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission
                    user={user}
                    permission={[PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.CORRECTIONS_APPROVE]}
                  >
                    <BalanceAdjustmentDetailPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/settings"
            element={
              // No permission requirement — GET /settings/company is intentionally unrestricted to
              // any authenticated user (settings.routes.ts's own documented decision: company
              // name/address appears throughout the app, not just this page). SettingsPage already
              // gates its own edit controls per-section (canManage/canManageBanks) — Fix 3's
              // action-level gating, not a route-level concern.
              <RequireSession>{(user) => <SettingsPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/users"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.USERS_MANAGE}>
                    <UsersPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route
            path="/roles"
            element={
              <RequireSession>
                {(user) => (
                  <RequirePermission user={user} permission={PERMISSIONS.USERS_MANAGE}>
                    <RolesPage user={user} />
                  </RequirePermission>
                )}
              </RequireSession>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
