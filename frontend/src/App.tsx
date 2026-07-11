import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '@/hooks/use-session';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginPage } from '@/routes/login-page';
import { HomePage } from '@/routes/home-page';
import { ProjectSitesPage } from '@/routes/project-sites-page';
import { EmployeesPage } from '@/routes/employees-page';
import { PayrollEntryPage } from '@/routes/payroll-entry-page';
import { SalaryReleasePage } from '@/routes/salary-release-page';
import { SettingsPage } from '@/routes/settings-page';
import { UsersPage } from '@/routes/users-page';
import { NotFoundPage } from '@/routes/not-found-page';

function FullScreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <Skeleton className="h-8 w-8 rounded-full" />
    </div>
  );
}

/** Gates any route that requires an authenticated session, redirecting to /login otherwise. */
function RequireSession({
  children,
}: {
  children: (user: NonNullable<ReturnType<typeof useSession>['data']>) => ReactNode;
}) {
  const { data: sessionUser, isLoading } = useSession();

  if (isLoading) return <FullScreenLoading />;
  if (!sessionUser) return <Navigate to="/login" replace />;

  return <>{children(sessionUser)}</>;
}

export function App() {
  return (
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
      <Route
        path="/payroll-entry"
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
  );
}
