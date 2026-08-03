import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DEFAULT_PRINT_SELECTION,
  FULL_REPORT_SELECTION,
  LOCKED_COLUMN_FIELD_ID,
  PRINT_PRESETS,
  SUMMARY_CARD_FIELDS,
  TABLE_COLUMN_FIELDS,
  getReadabilityLevel,
  hasNoMeaningfulColumns,
  isFullReportSelection,
  loadStoredPrintSelection,
  matchPresetId,
  saveStoredPrintSelection,
  type PayrollSummaryPrintSelection,
  type SummaryCardFieldId,
  type TableColumnFieldId,
} from './payroll-summary-print-fields';

/**
 * Post-deployment Print Usability Refinement — shown when Payroll Summary's own Print action is
 * clicked, before the browser's native print dialog. Payroll Entry/Bank Sheet/Cash Receiving/
 * Statements are all unaffected — they still go straight to the shared `PrintSettingsDialog`
 * (orientation/fit) via `PrintButton`, unchanged. Payroll Summary's own Print button opens this
 * dialog instead, and only calls `useTriggerPrint` (the same shared engine every other page's
 * `PrintSettingsDialog` already calls) once the user confirms a field selection here — never a new
 * print engine, just a report-specific step in front of the existing one.
 *
 * Selection here is presentation-only: every value a selected field ultimately renders comes from
 * the same already-loaded `PayrollSummaryReport` the on-screen page and CSV/XLSX exports already
 * use — this dialog and its caller only decide which of those already-computed fields to draw.
 *
 * **Final Print UX Refinement** — defaults to the complete report (every card, every column), never
 * a pre-narrowed one: the application must never silently hide report data, so a smaller printout
 * is something a user now explicitly opts into (a preset, or a hand-picked selection). The plain "N
 * columns selected" count from the prior pass is now a Print Readability indicator
 * (`getReadabilityLevel`) — informational guidance only, never a selection change and never a block
 * (the one exception, unchanged: `hasNoMeaningfulColumns` still blocks printing literally nothing
 * but Project Site).
 */
export function PayrollSummaryPrintOptionsDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selection: PayrollSummaryPrintSelection) => void;
}) {
  const [selection, setSelection] = useState<PayrollSummaryPrintSelection>(DEFAULT_PRINT_SELECTION);

  // Re-sync to the user's last-saved selection (browser-local only — Checkpoint brief: "remember
  // the user's last selected print preset/fields... do not persist to PostgreSQL") every time the
  // dialog opens, rather than carrying over whatever was left selected from a previous
  // open-cancel-reopen cycle within the same page session.
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
    if (id === LOCKED_COLUMN_FIELD_ID) return; // Project Site can never be removed.
    setSelection((prev) => ({
      ...prev,
      columns: prev.columns.includes(id) ? prev.columns.filter((c) => c !== id) : [...prev.columns, id],
    }));
  }

  function applyPreset(presetSelection: PayrollSummaryPrintSelection) {
    setSelection({ cards: [...presetSelection.cards], columns: [...presetSelection.columns] });
  }

  function selectAll() {
    setSelection({ ...FULL_REPORT_SELECTION });
  }

  function clearOptionalFields() {
    setSelection({ cards: [], columns: [LOCKED_COLUMN_FIELD_ID] });
  }

  function resetToDefault() {
    setSelection({ ...DEFAULT_PRINT_SELECTION });
  }

  const activePresetId = matchPresetId(selection);
  const isFullReport = isFullReportSelection(selection);
  const columnCount = selection.columns.length;
  const readability = getReadabilityLevel(columnCount);
  const blocked = hasNoMeaningfulColumns(selection);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent title="Print Options" widthClassName="max-w-[680px]">
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Presets</legend>
            <div className="flex flex-wrap gap-2">
              {PRINT_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant={activePresetId === preset.id ? 'primary' : 'secondary'}
                  onClick={() => applyPreset(preset.selection)}
                >
                  {preset.label}
                </Button>
              ))}
              {activePresetId === null && (
                <span className="inline-flex h-8 items-center rounded border border-dashed border-accent px-2.5 text-[11px] text-accent">
                  {isFullReport ? 'Full Report (all fields)' : 'Custom (current selection)'}
                </span>
              )}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Summary cards
            </legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {SUMMARY_CARD_FIELDS.map((field) => (
                <label key={field.id} className="flex items-center gap-2 text-xs text-text">
                  <Checkbox
                    checked={selection.cards.includes(field.id)}
                    onCheckedChange={() => toggleCard(field.id)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Site-table columns
            </legend>
            {/* Print Readability indicator (Final Print UX Refinement) — replaces the prior pass's
                plain "N columns selected" text. Guidance only: the column-count-derived status/tone
                below never changes the user's own selection, only explains what it means for
                legibility. */}
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
              <p>
                You have selected many columns. The report may be difficult to read when printed on A4 paper. Consider
                using one of the built-in presets.
              </p>
            </div>
          )}

          {blocked && (
            <div className="flex items-start gap-2 rounded-lg border border-danger bg-danger-light px-3.5 py-2.5 text-xs text-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <p>Select at least one column besides Project Site before printing.</p>
            </div>
          )}
        </div>
        <ModalFooter>
          <div className="mr-auto flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={clearOptionalFields}>
              Clear Optional Fields
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
