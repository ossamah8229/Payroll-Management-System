import { useState } from 'react';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import type { PrintFitMode, PrintOrientation, PrintSettings, ResolvedPrintOrientation } from './print-types';

const ORIENTATION_OPTIONS: { value: PrintOrientation; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const FIT_OPTIONS: { value: PrintFitMode; label: string; description: string }[] = [
  { value: 'fit', label: 'Fit to page', description: 'Scales columns to fit the page width; rows continue on further pages' },
  { value: 'normal', label: 'Normal size', description: 'Prints at normal size — a wide table may not fit the page width' },
];

/**
 * The one shared print-configuration dialog (docs/architecture/print-architecture.md) — every
 * `PrintButton` opens this instead of calling `window.print()` directly. It controls the
 * printable *layout* only (orientation, fit); the browser's own native print dialog remains the
 * final step and the final authority on paper size/orientation.
 */
export function PrintSettingsDialog({
  open,
  onOpenChange,
  recommendedOrientation,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendedOrientation: ResolvedPrintOrientation;
  onConfirm: (settings: PrintSettings) => void;
}) {
  const [orientation, setOrientation] = useState<PrintOrientation>('auto');
  const [fit, setFit] = useState<PrintFitMode>('fit');

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title="Print settings" widthClassName="max-w-[420px]">
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Orientation
            </legend>
            {ORIENTATION_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-xs text-text">
                <input
                  type="radio"
                  name="print-orientation"
                  value={opt.value}
                  checked={orientation === opt.value}
                  onChange={() => setOrientation(opt.value)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                {opt.label}
                {opt.value === 'auto' && (
                  <span className="text-text-faint">
                    ({recommendedOrientation === 'landscape' ? 'Landscape' : 'Portrait'})
                  </span>
                )}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Fit
            </legend>
            {FIT_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-start gap-2 text-xs text-text">
                <input
                  type="radio"
                  name="print-fit"
                  value={opt.value}
                  checked={fit === opt.value}
                  onChange={() => setFit(opt.value)}
                  className="mt-0.5 h-3.5 w-3.5 accent-accent"
                />
                <span className="flex flex-col gap-0.5">
                  <span>{opt.label}</span>
                  <span className="text-[11px] text-text-faint">{opt.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onConfirm({ orientation, fit });
              onOpenChange(false);
            }}
          >
            Print
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
