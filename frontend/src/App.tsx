import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '@/hooks/use-session';
import { RouteLoadingFallback } from '@/components/layout/route-loading-fallback';
import { RouteErrorBoundary } from '@/components/layout/route-error-boundary';
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
              <RequireSession>{(user) => <ProjectSitesPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/employees"
            element={
              <RequireSession>{(user) => <EmployeesPage user={user} />}</RequireSession>
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
              <RequireSession>{(user) => <PayrollEntryPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/payroll-entry"
            element={
              <RequireSession>{(user) => <PayrollEntryPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/release"
            element={
              <RequireSession>{(user) => <SalaryReleasePage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/release"
            element={
              <RequireSession>{(user) => <SalaryReleasePage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/bank-sheet"
            element={
              <RequireSession>{(user) => <BankSheetPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/bank-sheet"
            element={
              <RequireSession>{(user) => <BankSheetPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/cash-receiving"
            element={
              <RequireSession>{(user) => <CashReceivingPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/cash-receiving"
            element={
              <RequireSession>{(user) => <CashReceivingPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/advances"
            element={
              <RequireSession>{(user) => <AdvancesPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/payslips"
            element={
              <RequireSession>{(user) => <PayslipsPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/payroll-cycles/:cycleId/payslips"
            element={
              <RequireSession>{(user) => <PayslipsPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireSession>{(user) => <SettingsPage user={user} />}</RequireSession>
            }
          />
          <Route
            path="/users"
            element={
              <RequireSession>{(user) => <UsersPage user={user} />}</RequireSession>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
