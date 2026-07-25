import { useState } from 'react';
import { flushSync } from 'react-dom';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrintSettingsDialog } from '@/components/print/print-settings-dialog';
import { useTriggerPrint } from '@/components/print/use-print';
import type { PrintSettings, ResolvedPrintOrientation } from '@/components/print/print-types';

/**
 * The one shared "Print" action (Standard Print Support checkpoint; orientation/fit dialog added
 * by the Professional Printing checkpoint, docs/architecture/print-architecture.md) — every page
 * listed there renders this instead of its own ad hoc button. Clicking it opens the shared
 * `PrintSettingsDialog` (orientation, fit) rather than calling `window.print()` immediately; the
 * dialog's own "Print" action is what actually invokes the browser's native print dialog, via
 * `useTriggerPrint`.
 *
 * `recommendedOrientation` is only the dialog's default selection (its "Auto" option) — a caller
 * with a wide multi-column table (e.g. Payroll Entry) passes `'landscape'`; a narrower report
 * defaults to the `'portrait'` fallback. The user can always override it explicitly.
 *
 * **Production Print Defect fix** — this component, not the dialog, now owns the "close, then
 * print" sequencing, and forces it to happen in that exact order via `flushSync`: `window.print()`
 * captures whatever the DOM looks like at the precise synchronous instant it's called, so the
 * settings dialog must actually be removed from the DOM — not just have its removal *queued* —
 * before that call. A plain `setSettingsOpen(false)` here would only schedule the state update;
 * React 18 batches and commits it asynchronously, so the very next line (triggering the print)
 * would still run against a DOM that still has the dialog mounted, reproducing the exact defect
 * this fixes. `flushSync` forces React to synchronously apply and commit that state update —
 * unmounting the dialog's Portal content for real — before this function continues.
 */
export function PrintButton({
  recommendedOrientation = 'portrait',
}: {
  recommendedOrientation?: ResolvedPrintOrientation;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const triggerPrint = useTriggerPrint(recommendedOrientation);

  function handleConfirm(settings: PrintSettings) {
    flushSync(() => {
      setSettingsOpen(false);
    });
    triggerPrint(settings);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
        <Printer className="h-3.5 w-3.5" aria-hidden />
        Print
      </Button>
      <PrintSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        recommendedOrientation={recommendedOrientation}
        onConfirm={handleConfirm}
      />
    </>
  );
}
