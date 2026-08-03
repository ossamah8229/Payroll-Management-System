import { AlertTriangle, Check, Loader2, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { usePayrollEntryCycleSaveSummary } from '@/lib/payroll-entry-save-status-store';

/**
 * Phase 7E durability checkpoint (A1) — the cycle-level counterpart to each row's own
 * `SaveStatusIndicator`: a user must be able to tell "is this cycle fully saved" without
 * inspecting every individual row, especially once a grid holds hundreds/thousands of them and
 * only a small virtualized window is ever on screen at once. Reads the exact same per-row
 * `SaveStatus` transitions every row already computes (`payrollEntrySaveStatusStore`) — this is an
 * aggregation of that existing truth, never a second, independently-tracked save state.
 *
 * Priority when more than one condition holds at once (e.g. some rows saving, one row conflicted):
 * conflict > failed > saving > unsaved > all-saved — the most action-needed state always wins,
 * since a calm "Saving changes…" must never visually bury a conflict that actually needs the user
 * to act.
 */
export function PayrollEntrySaveStatusBanner({ cycleId }: { cycleId: string | undefined }) {
  const summary = usePayrollEntryCycleSaveSummary(cycleId);

  if (summary.conflictCount > 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded border border-danger bg-danger-light/40 px-3 py-2 text-xs text-danger print:hidden"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="font-medium">
          Conflict requires attention — {summary.conflictCount} row{summary.conflictCount === 1 ? '' : 's'}{' '}
          {summary.conflictCount === 1 ? 'was' : 'were'} changed elsewhere. Reload the affected row
          {summary.conflictCount === 1 ? '' : 's'} (its own conflict icon, in the grid) to keep editing.
        </span>
      </div>
    );
  }

  if (summary.errorCount > 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded border border-danger bg-danger-light/40 px-3 py-2 text-xs text-danger print:hidden"
      >
        <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="font-medium">
          {summary.errorCount} row{summary.errorCount === 1 ? '' : 's'} failed to save — automatic retries
          were exhausted. Do not close this tab or navigate away until these are resolved.
        </span>
        <Button size="sm" variant="secondary" onClick={summary.retryAllFailed}>
          Retry all failed
        </Button>
      </div>
    );
  }

  if (summary.hasSaving) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted print:hidden"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        Saving changes…
      </div>
    );
  }

  if (summary.dirtyCount > 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded border border-warning bg-warning-light/40 px-3 py-2 text-xs text-text print:hidden"
      >
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
        {summary.dirtyCount} row{summary.dirtyCount === 1 ? '' : 's'} have unsaved changes — do not close this
        tab or navigate away yet.
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 rounded border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted print:hidden',
      )}
    >
      <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      All changes saved
    </div>
  );
}
