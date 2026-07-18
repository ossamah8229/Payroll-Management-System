import { lazy, Suspense } from 'react';
import { LogOut, Settings, User as UserIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { SessionUser } from '@payroll/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useLogout } from '@/hooks/use-session';
import { Skeleton } from '@/components/ui/skeleton';

/** AUD-012 (Post-Phase-5 Stabilization Checkpoint 4) — `TasksWorkspace` renders in every
 * authenticated page's topbar (not gated by a route), so it would otherwise sit in the initial
 * bundle regardless of whether a session ever opens it. Lazy-loaded here instead, with a small
 * inline fallback sized to the icon-button trigger it replaces — never the full-screen
 * `RouteLoadingFallback`, which would be visually wrong for a widget this size. */
const TasksWorkspace = lazy(() =>
  import('@/components/tasks/tasks-workspace').then((m) => ({ default: m.TasksWorkspace })),
);

/**
 * docs/design-system.md §2.1: "Topbar: page title + subtitle on the left, contextual global
 * actions on the right." Phase 1 has no per-page contextual actions yet (Import/Export/New
 * Payroll Cycle are later-phase features) — the right side holds only the user menu for now.
 */
export function Topbar({
  title,
  subtitle,
  user,
}: {
  title: string;
  subtitle?: string;
  user: SessionUser;
}) {
  const logout = useLogout();
  const navigate = useNavigate();

  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function handleLogout() {
    try {
      await logout.mutateAsync();
    } catch {
      toast('Logout failed — please try again');
    }
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-surface-2 px-7">
      <div>
        <div className="text-[15px] font-semibold text-text">{title}</div>
        {subtitle && <div className="text-xs text-text-muted">{subtitle}</div>}
      </div>

      <div className="flex items-center gap-3">
        <Suspense fallback={<Skeleton className="h-8 w-8 rounded-full" />}>
          <TasksWorkspace user={user} />
        </Suspense>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-light">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled className="opacity-100">
              <UserIcon className="h-3.5 w-3.5" aria-hidden />
              <div className="flex flex-col">
                <span className="font-medium text-text">{user.name}</span>
                <span className="text-[10px] text-text-muted">{user.email}</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleLogout}>
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
