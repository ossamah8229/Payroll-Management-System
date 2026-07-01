import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '@/hooks/use-session';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginPage } from '@/routes/login-page';
import { HomePage } from '@/routes/home-page';
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
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
