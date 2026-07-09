import { useMemo, useState } from 'react';
import { pluralize } from '@payroll/shared';
import { Modal, ModalContent, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useProjectUnits } from '@/hooks/use-project-units';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import type { EffectiveWorkLine, usePayrollEntryEditor } from '@/hooks/use-payroll-entry-editor';
import { gridNavProps, InlineNumberCell, InlineSelectCell } from './inline-cells';
import { isValidDecimalDraft, parseValidCycleDays } from './numeric-validation';

type PayrollEntryEditor = ReturnType<typeof usePayrollEntryEditor>;

type ModalView = { mode: 'list' } | { mode: 'delete'; line: EffectiveWorkLine };

const selectClassName =
  'flex h-9 w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent-mid focus:ring-2 focus:ring-accent-light disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The "Split by {unitLabel}" editor (docs/architecture/database/payroll-entry.md §12a, Phase 3
 * Checkpoint 3). **Not a separate editing system** — it renders the exact same `editor`
 * (`usePayrollEntryEditor`) instance the row's own inline cells use, so a field edited here and a
 * field edited in the grid a moment later are queued through one shared debounced-autosave/
 * version-locked commit chain, never two independent ones racing for the same entry's `version`
 * (decision recorded 2026-07-09 — this modal is another surface onto the same `PayrollEntry`).
 * Follows this codebase's established list/delete-confirmation `Modal` pattern (the Manage Units
 * panel, `project-sites-page.tsx`) rather than introducing a second confirmation mechanism.
 */
export function SplitWorkLinesModal({
  open,
  onOpenChange,
  entry,
  editor,
  unitLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: PayrollEntry;
  editor: PayrollEntryEditor;
  unitLabel: string;
}) {
  const [view, setView] = useState<ModalView>({ mode: 'list' });
  const [newLineUnitId, setNewLineUnitId] = useState('');
  const units = useProjectUnits(entry.siteId);

  const { effectiveLines, editable, status, errorMessage, retryNow, reload, setLineField, addLine, deleteLine } =
    editor;

  const unitNameById = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.name])), [units.data]);
  const usedUnitIds = useMemo(() => new Set(effectiveLines.map((line) => line.unitId)), [effectiveLines]);
  const availableForNewLine = (units.data ?? []).filter((unit) => !usedUnitIds.has(unit.id));

  const busy = status === 'saving';
  const locked = !editable || status === 'conflict';
  const unitLabelLower = unitLabel.toLowerCase();
  const pluralUnitLabelLower = pluralize(unitLabel).toLowerCase();

  function optionsForLine(line: EffectiveWorkLine) {
    const options = (units.data ?? [])
      .filter((unit) => unit.id === line.unitId || !usedUnitIds.has(unit.id))
      .map((unit) => ({ value: unit.id, label: unit.name }));
    if (!options.some((o) => o.value === line.unitId)) {
      options.unshift({ value: line.unitId, label: unitNameById.get(line.unitId) ?? '…' });
    }
    return options;
  }

  async function handleAddLine() {
    if (!newLineUnitId) return;
    const unitId = newLineUnitId;
    setNewLineUnitId('');
    await addLine({ unitId });
  }

  async function handleConfirmDelete(line: EffectiveWorkLine) {
    await deleteLine(line.id);
    setView({ mode: 'list' });
  }

  function handleOpenChange(next: boolean) {
    if (!next) setView({ mode: 'list' });
    onOpenChange(next);
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent title={`Split by ${unitLabel} — ${entry.employee.name}`} widthClassName="max-w-[680px]">
        {(status === 'error' || status === 'conflict') && (
          <div className="mb-3.5 flex items-center justify-between gap-2 rounded border border-danger/40 bg-danger-light/40 px-3 py-2 text-xs text-danger">
            <span>{errorMessage}</span>
            {status === 'error' && (
              <button type="button" className="font-semibold underline" onClick={retryNow}>
                Retry
              </button>
            )}
            {status === 'conflict' && (
              <button type="button" className="font-semibold underline" onClick={() => void reload()}>
                Reload
              </button>
            )}
          </div>
        )}

        {view.mode === 'list' && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-text-muted">
              This employee&apos;s attendance for this cycle, attributed across one or more{' '}
              {pluralUnitLabelLower}. The <span className="font-medium text-text">Primary</span> line
              determines the Leave Rate basis whenever no explicit Leave Rate is set on this entry.
            </p>

            <div
              role="table"
              aria-label={`Work lines for ${entry.employee.name}`}
              className="grid gap-x-2 gap-y-2.5"
              style={{ gridTemplateColumns: '70px 1fr 90px 90px 90px 90px 32px' }}
            >
              <div role="row" className="contents">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {unitLabel}
                </span>
                <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Days
                </span>
                <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  OT Hours
                </span>
                <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  OT Rate
                </span>
                <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Cycle Days
                </span>
                <span />
              </div>

              {effectiveLines.map((line, index) => {
                const isPrimary = index === 0;
                const disabled = locked || busy;
                const nav = (col: string) => gridNavProps(-1, `split-${line.id}-${col}`);
                return (
                  <div role="row" key={line.id} className="contents">
                    <div className="flex items-center">
                      {isPrimary ? (
                        <span
                          className="rounded bg-accent-light px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-accent-mid"
                          title="Determines the Leave Rate basis when no explicit Leave Rate is set"
                        >
                          Primary
                        </span>
                      ) : (
                        <span className="text-[10px] text-text-faint">Line {index + 1}</span>
                      )}
                    </div>
                    <InlineSelectCell
                      value={line.unitId}
                      onChange={(v) => setLineField(line.id, 'unitId', v)}
                      disabled={disabled}
                      options={optionsForLine(line)}
                      nav={nav('unit')}
                      ariaLabel={`${unitLabel} for line ${index + 1}`}
                    />
                    <InlineNumberCell
                      value={line.days}
                      onChange={(v) => setLineField(line.id, 'days', v)}
                      disabled={disabled}
                      invalid={!isValidDecimalDraft(line.days, false)}
                      nav={nav('days')}
                      ariaLabel={`Days for line ${index + 1}`}
                    />
                    <InlineNumberCell
                      value={line.otHours}
                      onChange={(v) => setLineField(line.id, 'otHours', v)}
                      disabled={disabled}
                      invalid={!isValidDecimalDraft(line.otHours, false)}
                      nav={nav('otHours')}
                      ariaLabel={`OT hours for line ${index + 1}`}
                    />
                    <InlineNumberCell
                      value={line.otRate ?? ''}
                      onChange={(v) => setLineField(line.id, 'otRate', v || null)}
                      disabled={disabled}
                      placeholder="auto"
                      invalid={!isValidDecimalDraft(line.otRate ?? '', true)}
                      nav={nav('otRate')}
                      ariaLabel={`OT rate for line ${index + 1}`}
                    />
                    <InlineNumberCell
                      value={line.cycleDaysInputValue}
                      onChange={(v) => setLineField(line.id, 'cycleDays', v)}
                      disabled={disabled}
                      invalid={parseValidCycleDays(line.cycleDaysInputValue) === undefined}
                      nav={nav('cycleDays')}
                      ariaLabel={`Cycle days for line ${index + 1}`}
                    />
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => setView({ mode: 'delete', line })}
                        disabled={disabled || effectiveLines.length <= 1}
                        title={
                          effectiveLines.length <= 1
                            ? 'A payroll entry must always have at least one work line'
                            : 'Remove this line'
                        }
                        aria-label={`Remove line ${index + 1}`}
                        className="rounded px-1 py-1 text-text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-text-muted"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {editable && (
              <div className="flex items-end gap-2 rounded border border-dashed border-border p-3">
                {availableForNewLine.length > 0 ? (
                  <>
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label htmlFor="split-add-line-unit">Add a {unitLabelLower}</Label>
                      <select
                        id="split-add-line-unit"
                        className={selectClassName}
                        value={newLineUnitId}
                        onChange={(e) => setNewLineUnitId(e.target.value)}
                        disabled={busy || status === 'conflict'}
                      >
                        <option value="">Select a {unitLabelLower}</option>
                        {availableForNewLine.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleAddLine()}
                      disabled={!newLineUnitId || busy || status === 'conflict'}
                    >
                      Add line
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-text-muted">
                    Every {unitLabelLower} at this site is already on this entry.
                  </p>
                )}
              </div>
            )}

            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </ModalFooter>
          </div>
        )}

        {view.mode === 'delete' && (
          <div className="flex flex-col gap-3.5">
            <p className="text-xs text-text-muted">
              Remove the attendance line for{' '}
              <span className="font-medium text-text">
                {unitNameById.get(view.line.unitId) ?? `this ${unitLabelLower}`}
              </span>
              ? This cannot be undone — its Days/OT Hours/Cycle Days figures for this cycle will be lost.
            </p>
            <ModalFooter>
              <Button type="button" variant="secondary" onClick={() => setView({ mode: 'list' })} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-danger text-white hover:brightness-110"
                onClick={() => void handleConfirmDelete(view.line)}
                disabled={busy}
              >
                Remove line
              </Button>
            </ModalFooter>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
