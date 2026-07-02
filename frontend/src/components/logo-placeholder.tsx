import { Building2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Standing slot for `CompanySettings.logoStorageKey` once `StorageProvider` exists (deferred
 * until before Phase 5 — see docs/PROJECT_PROGRESS.md §3 item 4). Renders a placeholder now so the
 * Settings preview and the login screen already reserve the right shape/position for the real
 * logo, with no upload wiring behind it yet.
 */
export function LogoPlaceholder({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClass = { sm: 'h-10 w-10', md: 'h-14 w-14', lg: 'h-16 w-16' }[size];
  const iconClass = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' }[size];

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-bg text-text-faint',
        sizeClass,
        className,
      )}
    >
      <Building2 className={iconClass} aria-hidden />
    </div>
  );
}
