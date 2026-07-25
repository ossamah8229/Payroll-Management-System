import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrintSettingsDialog } from '@/components/print/print-settings-dialog';
import { useTriggerPrint } from '@/components/print/use-print';
import type { ResolvedPrintOrientation } from '@/components/print/print-types';

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
 */
export function PrintButton({
  recommendedOrientation = 'portrait',
}: {
  recommendedOrientation?: ResolvedPrintOrientation;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const triggerPrint = useTriggerPrint(recommendedOrientation);

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
        onConfirm={triggerPrint}
      />
    </>
  );
}
