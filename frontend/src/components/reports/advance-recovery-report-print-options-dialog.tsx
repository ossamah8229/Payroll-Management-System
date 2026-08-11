import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DEFAULT_PRINT_SELECTION,
  FULL_SELECTION,
  LOCKED_COLUMN_FIELD_ID,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  getReadabilityLevel,
  hasNoMeaningfulColumns,
  isFullSelection,
  loadStoredPrintSelection,
  saveStoredPrintSelection,
  type AdvanceRecoveryReportPrintSelection,
  type SummaryCardFieldId,
  type TableColumnFieldId,
} from './advance-recovery-report-print-fields';

/**
 * Advance Recovery Report Checkpoint 1B — this report's own Print Options dialog, opened by its Print
 * button before the browser's native print dialog (`useTriggerPrint`, the same shared print engine
 * every other page already calls — never a new one). Selection here is presentation-only: every
 * value a selected field renders comes from the exact same already-loaded page the on-screen table
 * already shows (current page only, not an unbounded fetch).
 */
export function AdvanceRecoveryReportPrintOptionsDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selection: AdvanceRecoveryReportPrintSelection) => void;
}) {
  const [selection, setSelection] = useState<AdvanceRecoveryReportPrintSelection>(DEFAULT_PRINT_SELECTION);

  useEffect(() => {
    if (open) setSelection(loadStoredPrintSelection() ?? DEFAULT_PRINT_SELECTION);
  }, [open]);

  function handleConfirm() {
    saveStoredPrintSelection(selection);
    onConfirm(selection);
  }

  function toggleCard(id: SummaryCardFieldId) {
    setSelection((prev) => ({
      ...prev,
      cards: prev.cards.includes(id) ? prev.cards.filter((c) => c !== id) : [...prev.cards, id],
    }));
  }

  function toggleColumn(id: TableColumnFieldId) {
    if (id === LOCKED_COLUMN_FIELD_ID) return;
    setSelection((prev) => ({
      ...prev,
      columns: prev.columns.includes(id) ? prev.columns.filter((c) => c !== id) : [...prev.columns, id],
    }));
  }

  function selectAll() {
    setSelection({ ...FULL_SELECTION });
  }

  // Reset restores every safe field — the same complete selection Select All produces, since this
  // dialog defines no narrower preset of its own.
  function resetToDefault() {
    setSelection({ ...DEFAULT_PRINT_SELECTION });
  }

  const isFullReport = isFullSelection(selection);
  const columnCount = selection.columns.length;
  const readability = getReadabilityLevel(columnCount);
  const blocked = hasNoMeaningfulColumns(selection);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title="Print Options" widthClassName="max-w-[680px]">
        <div className="flex flex-col gap-5">
          <p className="text-xs text-text-muted">
            Print scope: <span className="font-medium text-text">current page only</span>. Use Export CSV/Excel for
            the complete filtered result.
          </p>

          {isFullReport && (
            <span className="inline-flex h-8 w-fit items-center rounded border border-dashed border-accent px-2.5 text-[11px] text-accent">
              Full Report (all fields)
            </span>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Summary cards
            </legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {SUMMARY_CARD_FIELDS.map((field) => (
                <label key={field.id} className="flex items-center gap-2 text-xs text-text">
                  <Checkbox checked={selection.cards.includes(field.id)} onCheckedChange={() => toggleCard(field.id)} />
                  {field.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Table columns
            </legend>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-text-muted">
              <Badge tone={readability.tone}>{readability.label}</Badge>
              <span>
                {columnCount} column{columnCount === 1 ? '' : 's'} selected — {readability.explanation}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {TABLE_COLUMN_FIELDS.map((field) => (
                <label
                  key={field.id}
                  className="flex items-center gap-2 text-xs text-text data-[locked=true]:text-text-muted"
                  data-locked={field.locked ?? false}
                >
                  <Checkbox
                    checked={selection.columns.includes(field.id)}
                    disabled={field.locked}
                    onCheckedChange={() => toggleColumn(field.id)}
                  />
                  {field.label}
                  {field.locked && <span className="text-[10px] text-text-faint">(always included)</span>}
                </label>
              ))}
            </div>
          </fieldset>

          {readability.status === 'very-wide' && (
            <div className="flex items-start gap-2 rounded-lg border border-danger bg-danger-light px-3.5 py-2.5 text-xs text-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <p>You have selected many columns. The report may be difficult to read when printed on A4 paper.</p>
            </div>
          )}

          {blocked && (
            <div className="flex items-start gap-2 rounded-lg border border-danger bg-danger-light px-3.5 py-2.5 text-xs text-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <p>Select at least one column besides Employee Name before printing.</p>
            </div>
          )}
        </div>
        <ModalFooter>
          <div className="mr-auto flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={resetToDefault}>
              Reset to Default
            </Button>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={blocked} onClick={handleConfirm}>
            Print
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
