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
    // print:block/print:ml-0/print:overflow-visible (Standard Print Support checkpoint) — every
    // page in the app shares this one shell, so hiding navigation chrome and letting the printed
    // content flow across pages (rather than stay clipped to the on-screen viewport) is fixed once
    // here rather than per-page. `<main>`'s own overflow-y-auto is what would otherwise clip a
    // page's content to the screen's scrollable height when printed.
    <div className="flex h-screen overflow-hidden bg-bg print:block print:h-auto print:overflow-visible">
      <Sidebar user={user} />
      <div className="ml-[220px] flex flex-1 flex-col overflow-hidden print:ml-0 print:block print:overflow-visible">
        <Topbar title={title} subtitle={subtitle} user={user} />
        <main className="flex-1 overflow-y-auto p-7 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
