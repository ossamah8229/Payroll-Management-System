import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { ThemeProvider } from './theme-provider';
import { Toaster } from '@/components/ui/sonner';

// `BrowserRouter` was removed here (Phase 7E, App.tsx's data-router migration) — `<App>` now
// creates its own router via `createBrowserRouter`/`RouterProvider`, which supplies the exact same
// browser-history routing context on its own; wrapping it in a second, outer `BrowserRouter` would
// just be a redundant, unused router instance sitting alongside the real one.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
