import { memo, useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { formatMoney, pluralize } from '@payroll/shared';
import { cn } from '@/lib/cn';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Bank } from '@/hooks/use-banks';
import { usePayrollEntryEditor } from '@/hooks/use-payroll-entry-editor';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import { gridNavProps, InlineNumberCell, InlineSelectCell, InlineTextCell, ReadOnlyCell } from './inline-cells';
import { SaveStatusIndicator } from './save-status-indicator';
import { SplitWorkLinesModal } from './split-work-lines-modal';
import { toNumberOrNull, type LiveTotalsStore } from './live-totals-store';
import { computeServerSnapshot } from './calc-input';
import { isValidDecimalDraft, parseValidCycleDays } from './numeric-validation';

const ROW_HEIGHT = 40;

interface PayrollEntryRowProps {
  entry: PayrollEntry;
  rowIndex: number;
  cycleId: string;
  cycleStatus: string;
  banks: Bank[];
  liveTotalsStore: LiveTotalsStore;
  /** The one shared, dynamically-computed grid template (`columns.ts`'s `computeColumnWidths` +
   * `gridTemplateColumns`) — passed down from `PayrollEntryGrid` rather than each row calling
   * `gridTemplateColumns()` independently, so every row is guaranteed pixel-aligned with the
   * header/totals row on the exact same computation, never a second, possibly-stale copy. */
  gridTemplateColumns: string;
  style: React.CSSProperties;
  /** Whether this session may create a correction for a released entry (`payroll:entry`,
   * usability-layer only — the backend independently enforces it). Omitted entirely if the row
   * shouldn't offer the action at all (matches every other permission-gated control in this app). */
  canCorrect: boolean;
  onCreateCorrection: (entry: PayrollEntry) => void;
  onViewCorrectionHistory: (entry: PayrollEntry) => void;
}

function PayrollEntryRowImpl({
  entry,
  rowIndex,
  cycleId,
  cycleStatus,
  banks,
  liveTotalsStore,
  gridTemplateColumns,
  style,
  canCorrect,
  onCreateCorrection,
  onViewCorrectionHistory,
}: PayrollEntryRowProps) {
  const editor = usePayrollEntryEditor(entry, cycleId, cycleStatus);
  const { effectiveEntry, effectiveLine, cycleDaysInputValue, calc, status, errorMessage, editable } = editor;
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const unitLabel = entry.site.unitLabel;
  const unitCount = entry.workLines.length;

  // Reports this row's live effective values to the totals store on every change (not just on
  // save) — this is what makes the sticky totals row "update live while editing" per the
  // checkpoint's requirement, without forcing a re-render of all other rows on every keystroke.
  useEffect(() => {
    liveTotalsStore.set(entry.id, {
      grossPay: toNumberOrNull(effectiveEntry.grossPay),
      days: toNumberOrNull(effectiveLine.days),
      otHours: toNumberOrNull(effectiveLine.otHours),
      otRate: toNumberOrNull(effectiveLine.otRate),
      cycleDays: effectiveLine.cycleDays ?? null,
      leaveDays: toNumberOrNull(effectiveEntry.leaveDays),
      leaveRate: toNumberOrNull(effectiveEntry.leaveRate),
      allowance: toNumberOrNull(effectiveEntry.allowance),
      eobiAmount: toNumberOrNull(effectiveEntry.eobiAmount),
      advanceDeduction: toNumberOrNull(effectiveEntry.advanceDeduction),
      eidAdvanceDeduction: toNumberOrNull(effectiveEntry.eidAdvanceDeduction),
      fine: toNumberOrNull(effectiveEntry.fine),
      netSalary: toNumberOrNull(calc.netSalary),
    });
    // On true unmount (scrolled out of the virtualizer's window) this hands the row's
    // contribution back as a fresh server-truth snapshot rather than dropping it from the total
    // entirely — the grid's own `setBase` effect also keeps every entry seeded, but computing it
    // here too means there's no gap between "this row unmounts" and "the grid's effect happens to
    // re-run" where the total would transiently miss it.
    return () => liveTotalsStore.unmount(entry.id, computeServerSnapshot(entry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entry.id,
    effectiveEntry.grossPay,
    effectiveEntry.leaveDays,
    effectiveEntry.leaveRate,
    effectiveEntry.allowance,
    effectiveEntry.eobiAmount,
    effectiveEntry.advanceDeduction,
    effectiveEntry.eidAdvanceDeduction,
    effectiveEntry.fine,
    effectiveLine.days,
    effectiveLine.otHours,
    effectiveLine.otRate,
    effectiveLine.cycleDays,
    calc.netSalary,
  ]);

  const disabled = !editable || status === 'conflict';
  const nav = (col: string) => gridNavProps(rowIndex, col);

  return (
    <>
    <div
      role="row"
      style={{ ...style, gridTemplateColumns }}
      className={cn(
        'grid items-center border-b border-border text-xs',
        status === 'conflict' && 'bg-danger-light/40',
      )}
    >
      <div role="cell" className="flex items-center justify-center gap-1 px-1.5 py-1">
        <SaveStatusIndicator
          status={status}
          errorMessage={errorMessage}
          onRetry={editor.retryNow}
          onReload={editor.reload}
        />
        <span className="tabular-nums text-text-muted">{rowIndex + 1}</span>
      </div>

      {/* Released status + Correction/History actions (Corrections workflow completion) — a
          released entry is immutable (every input above is `disabled`), so this is the row's own
          entry point into the correction workflow instead of a single page-wide toolbar button with
          no per-row indication of *which* rows it even applies to. */}
      <div role="cell" className="flex items-center justify-center gap-1">
        {entry.released ? (
          <>
            <Badge tone="blue">Released</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
                  aria-label={`Released payroll actions for ${entry.employee.name}`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {canCorrect && (
                  <DropdownMenuItem onSelect={() => onCreateCorrection(entry)}>Create Correction</DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onViewCorrectionHistory(entry)}>
                  View Correction History
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <span className="text-[10px] text-text-faint">—</span>
        )}
      </div>

      {/* Employee Code is a business-critical identifier under the permanent Layout Integrity
          Rule — never ellipsis-clipped, even though every other read-only cell in this row still
          truncates by default. */}
      <ReadOnlyCell truncate={false}>{entry.employee.employeeCode ?? '—'}</ReadOnlyCell>
      <ReadOnlyCell muted={false}>
        <span className="font-medium">{entry.employee.name}</span>
      </ReadOnlyCell>

      <div role="cell">
        <InlineTextCell
          value={effectiveEntry.designation}
          onChange={(v) => editor.setEntryField('designation', v)}
          disabled={disabled}
          maxLength={80}
          nav={nav('designation')}
          ariaLabel={`Designation for ${entry.employee.name}`}
        />
      </div>

      <ReadOnlyCell>{entry.site.name}</ReadOnlyCell>

      <div role="cell">
        <InlineSelectCell
          value={effectiveEntry.bankId ?? ''}
          onChange={(v) => editor.setEntryField('bankId', v || null)}
          disabled={disabled}
          // Bank Code only in this dense grid — the approved Bank display rule (2026-07-13,
          // superseding the 2026-07-11 attempt that showed the full "{name} ({code})" here). The
          // Master User already defines both Bank Name and Bank Code (Settings → Banks); the full
          // name stays useful in Employee Registry's own dropdown where a user is picking a bank
          // and needs the context, but a dense transaction grid displays the Code specifically so
          // the column stays compact without losing meaning — the Code's whole purpose.
          options={[
            { value: '', label: 'Cash' },
            ...banks.map((b) => ({ value: b.id, label: b.code })),
          ]}
          nav={nav('bankId')}
          ariaLabel={`Bank for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineTextCell
          value={effectiveEntry.branchCode ?? ''}
          onChange={(v) => editor.setEntryField('branchCode', v || null)}
          disabled={disabled}
          maxLength={20}
          nav={nav('branchCode')}
          ariaLabel={`Branch code for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineTextCell
          value={effectiveEntry.accountNumber ?? ''}
          onChange={(v) => editor.setEntryField('accountNumber', v || null)}
          disabled={disabled}
          maxLength={40}
          nav={nav('accountNumber')}
          ariaLabel={`Account number for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineTextCell
          value={effectiveEntry.iban ?? ''}
          // Stored uppercase, displayed exactly as entered (2026-07-11 banking refinement) —
          // uppercased live here too, so what's on screen always matches what gets saved; never
          // required, since many employees operationally don't know or provide one.
          onChange={(v) => editor.setEntryField('iban', v ? v.toUpperCase() : null)}
          disabled={disabled}
          maxLength={34}
          nav={nav('iban')}
          ariaLabel={`IBAN for ${entry.employee.name}`}
        />
      </div>

      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.grossPay}
          onChange={(v) => editor.setEntryField('grossPay', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveEntry.grossPay, false)}
          nav={nav('grossPay')}
          ariaLabel={`Gross pay for ${entry.employee.name}`}
        />
      </div>
      <div role="cell" className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => setIsSplitOpen(true)}
          className="rounded border border-border bg-surface px-2 py-1 text-[10.5px] font-medium text-text transition-colors hover:border-accent-mid hover:text-accent-mid"
          aria-label={`Split by ${unitLabel} — ${entry.employee.name} — currently ${unitCount} ${
            unitCount === 1 ? unitLabel : pluralize(unitLabel)
          }`}
        >
          {unitCount} {unitCount === 1 ? unitLabel : pluralize(unitLabel)}
        </button>
      </div>

      <div role="cell">
        <InlineNumberCell
          value={effectiveLine.days}
          onChange={(v) => editor.setWorkLineField('days', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveLine.days, false)}
          nav={nav('days')}
          ariaLabel={`Working days for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineNumberCell
          value={effectiveLine.otHours}
          onChange={(v) => editor.setWorkLineField('otHours', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveLine.otHours, false)}
          nav={nav('otHours')}
          ariaLabel={`OT hours for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineNumberCell
          value={effectiveLine.otRate ?? ''}
          onChange={(v) => editor.setWorkLineField('otRate', v || null)}
          disabled={disabled}
          placeholder="auto"
          invalid={!isValidDecimalDraft(effectiveLine.otRate ?? '', true)}
          nav={nav('otRate')}
          ariaLabel={`OT rate for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineNumberCell
          value={cycleDaysInputValue}
          onChange={(v) => editor.setWorkLineField('cycleDays', v)}
          disabled={disabled}
          invalid={parseValidCycleDays(cycleDaysInputValue) === undefined}
          nav={nav('cycleDays')}
          ariaLabel={`Cycle days for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.leaveDays}
          onChange={(v) => editor.setEntryField('leaveDays', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveEntry.leaveDays, false)}
          nav={nav('leaveDays')}
          ariaLabel={`Leave days for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.leaveRate ?? ''}
          onChange={(v) => editor.setEntryField('leaveRate', v || null)}
          disabled={disabled}
          placeholder="auto"
          invalid={!isValidDecimalDraft(effectiveEntry.leaveRate ?? '', true)}
          nav={nav('leaveRate')}
          ariaLabel={`Leave rate for ${entry.employee.name}`}
        />
      </div>
      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.allowance}
          onChange={(v) => editor.setEntryField('allowance', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveEntry.allowance, false)}
          nav={nav('allowance')}
          ariaLabel={`Allowance for ${entry.employee.name}`}
        />
      </div>

      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.eobiAmount}
          onChange={(v) => editor.setEntryField('eobiAmount', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveEntry.eobiAmount, false)}
          nav={nav('eobiAmount')}
          ariaLabel={`EOBI amount for ${entry.employee.name}`}
        />
      </div>
      <div role="cell" className="flex justify-center">
        <ToggleSwitch
          checked={effectiveEntry.eobiApplicable}
          onCheckedChange={(v) => editor.setEntryField('eobiApplicable', v)}
          disabled={disabled}
          aria-label={`EOBI applicable for ${entry.employee.name}`}
          {...nav('eobiApplicable')}
        />
      </div>

      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.advanceDeduction}
          onChange={(v) => editor.setEntryField('advanceDeduction', v)}
          disabled={disabled}
          deduct
          invalid={!isValidDecimalDraft(effectiveEntry.advanceDeduction, false)}
          nav={nav('advanceDeduction')}
          ariaLabel={`Advance deduction for ${entry.employee.name}`}
        />
        {/* Phase 4 Checkpoint 5 (Advances) — small linked-balance indicator, PROJECT_SPEC.md's own
            requirement ("visible... in Payroll Entry, small balance indicator under the advance/eid
            input"). Read-only here; managed from the Advances page. */}
        {entry.advance && (
          <p className="mt-0.5 text-center text-[10px] text-text-faint">
            Bal: {formatMoney(entry.advance.outstandingBalance)}
          </p>
        )}
      </div>
      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.eidAdvanceDeduction}
          onChange={(v) => editor.setEntryField('eidAdvanceDeduction', v)}
          disabled={disabled}
          deduct
          invalid={!isValidDecimalDraft(effectiveEntry.eidAdvanceDeduction, false)}
          nav={nav('eidAdvanceDeduction')}
          ariaLabel={`Eid advance deduction for ${entry.employee.name}`}
        />
        {entry.eidAdvance && (
          <p className="mt-0.5 text-center text-[10px] text-text-faint">
            Bal: {formatMoney(entry.eidAdvance.outstandingBalance)}
          </p>
        )}
      </div>
      <div role="cell">
        <InlineNumberCell
          value={effectiveEntry.fine}
          onChange={(v) => editor.setEntryField('fine', v)}
          disabled={disabled}
          deduct
          invalid={!isValidDecimalDraft(effectiveEntry.fine, false)}
          nav={nav('fine')}
          ariaLabel={`Fine for ${entry.employee.name}`}
        />
      </div>

      <div role="cell" className="flex justify-center">
        <ToggleSwitch
          checked={effectiveEntry.hold}
          onCheckedChange={(v) => editor.setEntryField('hold', v)}
          disabled={disabled}
          aria-label={`Hold for ${entry.employee.name}`}
          {...nav('hold')}
        />
      </div>

      <div role="cell">
        <InlineTextCell
          value={effectiveEntry.remarks ?? ''}
          onChange={(v) => editor.setEntryField('remarks', v || null)}
          disabled={disabled}
          maxLength={2000}
          nav={nav('remarks')}
          ariaLabel={`Remarks for ${entry.employee.name}`}
        />
      </div>

      <ReadOnlyCell align="right" muted={false}>
        <span className={cn('font-semibold', Number(calc.netSalary) < 0 ? 'text-danger' : 'text-success')}>
          {formatMoney(calc.netSalary)}
        </span>
      </ReadOnlyCell>
    </div>
    <SplitWorkLinesModal
      open={isSplitOpen}
      onOpenChange={setIsSplitOpen}
      entry={entry}
      editor={editor}
      unitLabel={unitLabel}
    />
    </>
  );
}

export const PayrollEntryRow = memo(PayrollEntryRowImpl, (prev, next) => {
  return (
    prev.entry === next.entry &&
    prev.rowIndex === next.rowIndex &&
    prev.cycleStatus === next.cycleStatus &&
    prev.banks === next.banks &&
    prev.canCorrect === next.canCorrect &&
    // The grid passes stable (useCallback'd) handler references, so a strict-equality check here
    // still skips a re-render for every row unaffected by the actual change that triggered the
    // parent's own re-render, same as every other prop below.
    prev.onCreateCorrection === next.onCreateCorrection &&
    prev.onViewCorrectionHistory === next.onViewCorrectionHistory &&
    // The shared grid template changes whenever any loaded value (on any row) needs a wider
    // column than before — every mounted row must re-render to stay pixel-aligned when it does.
    prev.gridTemplateColumns === next.gridTemplateColumns &&
    prev.style.transform === next.style.transform
  );
});

export { ROW_HEIGHT };
