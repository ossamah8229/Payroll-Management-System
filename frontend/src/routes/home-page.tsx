import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AppShell } from '@/components/layout/app-shell';
import { Greeting } from '@/components/greeting';
import type { SessionUser } from '@payroll/shared';

/**
 * A deliberate placeholder — Dashboard business logic (summary stats, per-site payroll summary,
 * release progress) is out of scope for Phase 1 per docs/IMPLEMENTATION_PLAN.md. This page exists
 * so the navigation shell and authenticated layout have a real destination to prove out the
 * app shell/theme/routing foundation end to end.
 */
export function HomePage({ user }: { user: SessionUser }) {
  return (
    <AppShell user={user} title="Dashboard" subtitle="Payroll Management System">
      <Card>
        <CardHeader>
          <CardTitle>
            <Greeting name={user.name.split(' ')[0] ?? user.name} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-text-muted">
            Signed in as <span className="font-medium text-text">{user.roleName}</span>. This is a
            Phase 1 foundation placeholder — payroll features are built in the phases that follow
            (see <code className="text-[11px]">docs/IMPLEMENTATION_PLAN.md</code>).
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
