import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { isNavItemVisible, navSections } from './nav-config';
import type { SessionUser } from '@payroll/shared';

/**
 * docs/design-system.md §2.1 App Shell: fixed 220px sidebar, solid accent background, company
 * block, grouped nav, pinned user footer. Nav item states (default 70% white / hover 8% white bg
 * / active 12% white bg + left accent border + full white + medium weight) are reproduced exactly
 * as specified, not approximated.
 */
export function Sidebar({ user }: { user: SessionUser }) {
  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col bg-accent">
      <div className="border-b border-white/10 px-4 pb-4 pt-5">
        <div className="text-[13px] font-bold leading-tight text-white">
          Payroll Management
          <br />
          System
        </div>
        <div className="mt-0.5 text-[11px] text-white/55">HR &amp; Payroll</div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {navSections.map((section) => {
          const visibleItems = section.items.filter((item) => isNavItemVisible(item, user));

          if (visibleItems.length === 0) return null;

          return (
            <div key={section.label}>
              <div
                className="px-4 pb-1 pt-3.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--sidebar-section-label)]"
              >
                {section.label}
              </div>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 border-l-2 border-transparent px-4 py-2 text-[13px] text-white/70 transition-colors',
                      'hover:bg-white/[0.08] hover:text-white',
                      isActive && 'border-l-white/70 bg-white/[0.12] font-medium text-white',
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-white/20 text-[11px] text-white">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-white">{user.name}</div>
            <div className="truncate text-[10px] text-white/50">{user.roleName}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
