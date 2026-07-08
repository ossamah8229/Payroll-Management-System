import { AlertTriangle, Check, Loader2, WifiOff } from 'lucide-react';
import type { SaveStatus } from '@/hooks/use-payroll-entry-editor';

/**
 * Per-row save indicator (dirty/saving/saved/error/conflict) — docs/design-system.md's
 * "Confirmation weight matches stakes": a routine autosave is a quiet inline icon, never a toast
 * per keystroke, which would be noise at grid scale. `error`/`conflict` are clickable — the same
 * compact icon doubles as the "Retry"/"Reload row" affordance rather than needing a separate
 * button squeezed into an already-narrow Serial Number column.
 */
export function SaveStatusIndicator({
  status,
  errorMessage,
  onRetry,
  onReload,
}: {
  status: SaveStatus;
  errorMessage?: string;
  onRetry?: () => void;
  onReload?: () => void;
}) {
  switch (status) {
    case 'dirty':
      return (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-warning"
          title="Unsaved changes"
          aria-label="Unsaved changes"
        />
      );
    case 'saving':
      return (
        <Loader2 className="h-3 w-3 animate-spin text-text-muted" aria-label="Saving">
          <title>Saving…</title>
        </Loader2>
      );
    case 'saved':
      return (
        <Check className="h-3 w-3 text-success" aria-label="Saved">
          <title>Saved</title>
        </Check>
      );
    case 'error':
      return (
        <button
          type="button"
          onClick={onRetry}
          className="rounded text-danger hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-mid"
          title={`${errorMessage ?? 'Save failed'} — click to retry now`}
          aria-label="Save failed — click to retry"
        >
          <WifiOff className="h-3 w-3" />
        </button>
      );
    case 'conflict':
      return (
        <button
          type="button"
          onClick={onReload}
          className="rounded text-danger hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-mid"
          title={`${errorMessage ?? 'Changed elsewhere'} — click to reload this row`}
          aria-label="Conflict — click to reload this row"
        >
          <AlertTriangle className="h-3 w-3" />
        </button>
      );
    case 'idle':
    default:
      return <span className="inline-block h-1.5 w-1.5" aria-hidden />;
  }
}
