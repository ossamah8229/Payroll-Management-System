import type { ReactNode } from 'react';
import type { SessionUser } from '@payroll/shared';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/** docs/design-system.md §2.1: sidebar fixed at 220px, main area offset to match. */
export function AppShell({
  user,
  title,
  subtitle,
  children,
}: {
  user: SessionUser;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <Sidebar user={user} />
      <div className="ml-[220px] flex min-h-screen flex-col">
        <Topbar title={title} subtitle={subtitle} user={user} />
        <main className="flex-1 p-7">{children}</main>
      </div>
    </div>
  );
}
