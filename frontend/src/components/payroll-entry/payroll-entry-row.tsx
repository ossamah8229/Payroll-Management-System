import { Fragment, memo, useCallback, useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { formatMoney, isOutstandingWaived, pluralize } from '@payroll/shared';
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
import type { Employee } from '@/hooks/use-employees';
import { usePayrollEntryEditor } from '@/hooks/use-payroll-entry-editor';
import type { PayrollEntry } from '@/hooks/use-payroll-entries';
import {
  PAYROLL_COLUMNS,
  ROW_ACTION_WIDTH,
  stickyIdentityCellClassName,
  type PayrollColumnId,
} from './columns';
import { BalanceLabel, gridNavProps, InlineNumberCell, InlineTextCell, ReadOnlyCell } from './inline-cells';
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
  /** Frozen Employee Identity Pane (UAT 2026-08-12) — the shared per-column `left` pixel offsets
   * (`columns.ts`'s `stickyLeftOffsets`, derived from the same `resolvedColumns` the grid template
   * above already comes from) for `employeeCode`/`employeeName`, passed down rather than computed
   * per row for the same reason `gridTemplateColumns` is: one calculation, reused pixel-aligned by
   * every row instead of a second, possibly-stale copy. */
  identityOffsets: Partial<Record<PayrollColumnId, number>>;
  style: React.CSSProperties;
  /** Employee Row Actions (UAT 2026-08-11, RBAC-split revision) — `Edit Employee` is
   * employee-master-data administration and stays gated on `EMPLOYEES_EDIT` (the exact permission
   * Employee Registry's own row menu checks — mirrored, never a separate/looser gate). A Payroll
   * Entry permission alone must never grant this. */
  canEditEmployee: boolean;
  /** `Mark as Left` is a Payroll Entry operational action, governed solely by the Payroll Entry
   * operational permission (`payroll:entry`) — never `EMPLOYEES_EDIT` (an earlier revision OR'd the
   * two together, which incorrectly let an employee-edit-only caller with no Payroll Entry access
   * mark someone left; corrected). Computed by the page (`hasPermission`), forwarded here as a
   * plain boolean the same way `canEditEmployee` already is. The `⋯` trigger itself renders
   * whenever either flag is true; each menu item renders independently off its own flag — never a
   * disabled/dead item for the one the caller lacks. */
  canMarkEmployeeLeft: boolean;
  /** Opens the shared `EmployeeFormModal` (`components/employees/employee-form-modal.tsx`)
   * pre-populated with this row's own `entry.employee` — the exact same `Employee` shape and
   * component Employee Registry's own Edit action uses, never a second edit form. Defined at the
   * page level (a stable reference across renders) so this memoized row never needs it in its own
   * comparator beyond a plain reference check. */
  onEditEmployee: (employee: Employee) => void;
  /** Opens the shared `MarkLeftModal` (`components/employees/mark-left-modal.tsx`) — same
   * reasoning as `onEditEmployee` above. */
  onMarkLeftEmployee: (employee: Employee) => void;
}

function PayrollEntryRowImpl({
  entry,
  rowIndex,
  cycleId,
  cycleStatus,
  banks,
  liveTotalsStore,
  gridTemplateColumns,
  identityOffsets,
  style,
  canEditEmployee,
  canMarkEmployeeLeft,
  onEditEmployee,
  onMarkLeftEmployee,
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
      // Aggregate Working Days (v1.0.0 audit-correctness fix) — `calc` already recomputes
      // `calcNet` over *every* work line's own live draft (`usePayrollEntryEditor`'s
      // `buildCalcInput(entry, entryDraft, lineDrafts)`), so this stays correct whether the
      // in-progress edit is this row's own primary-line input or a non-primary line edited via the
      // Split by {unitLabel} modal — never just this row's own primary line.
      days: toNumberOrNull(calc.totalWorkingDays),
      otHours: toNumberOrNull(effectiveLine.otHours),
      otRate: toNumberOrNull(effectiveLine.otRate),
      cycleDays: effectiveLine.cycleDays ?? null,
      leaveDays: toNumberOrNull(effectiveEntry.leaveDays),
      leaveRate: toNumberOrNull(effectiveEntry.leaveRate),
      allowance: toNumberOrNull(effectiveEntry.allowance),
      // Effective deduction, not the raw amount — see `computeServerSnapshot`'s identical rule.
      eobiAmount: effectiveEntry.eobiApplicable ? toNumberOrNull(effectiveEntry.eobiAmount) : 0,
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
    effectiveEntry.eobiApplicable,
    effectiveEntry.advanceDeduction,
    effectiveEntry.eidAdvanceDeduction,
    effectiveEntry.fine,
    effectiveLine.otHours,
    effectiveLine.otRate,
    effectiveLine.cycleDays,
    calc.totalWorkingDays,
    calc.netSalary,
  ]);

  const disabled = !editable || status === 'conflict';
  // Single source of truth for this row's real opaque background — shared by the row's own
  // outer div and its sticky-left identity cells (`cells.employeeCode`/`employeeName` below), so
  // the two can never silently drift out of sync the way M4's own translucent-conflict-row fix
  // originally guarded against.
  const rowBackgroundClassName = status === 'conflict' ? 'bg-danger-light' : 'bg-surface-2';
  const nav = (col: string) => gridNavProps(rowIndex, col);

  // Phase 7E durability checkpoint (A6) — a 409 conflict's "Reload row" action discards whatever
  // local, unsaved draft this row still has (`editor.reload`'s own doc comment,
  // `use-payroll-entry-editor.ts`) — that must never happen from one accidental click with no
  // chance to back out. `window.confirm` matches this app's own existing pattern for a
  // discard-in-progress-work confirmation (`task-list-item.tsx`'s delete-task guard), rather than
  // inventing a second confirmation mechanism just for this row action.
  const handleReload = useCallback(() => {
    if (window.confirm('This row was changed elsewhere. Reloading replaces it with the current server value and discards your local, unsaved edit to this row. Continue?')) {
      void editor.reload();
    }
  }, [editor]);

  // One cell per `PAYROLL_COLUMNS` entry, keyed by column id (Presentation & Workflow
  // Stabilization Checkpoint, 2026-07-25) — the row used to be a hand-written JSX list that had to
  // be kept in the exact same order as `PAYROLL_COLUMNS` by eye, the same class of drift that once
  // broke the totals row (see that component's own history). `Record<PayrollColumnId, ReactNode>`
  // makes that structurally impossible here too: TypeScript rejects this object literal if a
  // column is missing a cell or an unknown column id is present, and render order below comes from
  // iterating the canonical array, never from the order these properties happen to be written in.
  const cells: Record<PayrollColumnId, React.ReactNode> = {
    serial: (
      <div role="cell" data-col-id="serial" className="flex items-center justify-center gap-1 px-1.5 py-1">
        <SaveStatusIndicator
          status={status}
          errorMessage={errorMessage}
          onRetry={editor.retryNow}
          onReload={handleReload}
        />
        <span className="tabular-nums text-text-muted">{rowIndex + 1}</span>
      </div>
    ),

    // Released status only (Presentation & Workflow Stabilization Checkpoint, 2026-07-25 —
    // the row-level Create Correction/View Correction History actions moved out of this cell
    // entirely: Create Correction is already reachable from the page-level "Request Correction"
    // toolbar button, whose own Employee field can search and select any released entry; View
    // Correction History is reachable from the Corrections page). The cell is a plain centered
    // flex box — the same `items-center justify-center` convention every other `align: 'center'`
    // column in this row uses (serial, units, eobiApplicable, hold) — because the column now
    // holds exactly one piece of content with nothing else to keep it from drifting off-center.
    // Negative Payroll Recovery checkpoint (2026-07-26) — `payoutOutcome` is the other resolution
    // a Unit release sweep can leave an entry in besides `released = true`; the UI must never show
    // "Released" for an employee who received no salary payment (Part A3), so it gets its own
    // distinct badges here rather than falling into the plain "—" unresolved state.
    //
    // Pre-release "Needs Attention" visibility (2026-07-27 refinement) — a still-unresolved entry
    // the backend already knows can't release (duplicate CNIC/Employee Code/Account Number/IBAN,
    // or missing required bank details) must never silently show the plain "—" either. One badge,
    // kept centered exactly like every other outcome here — never a second badge alongside it, and
    // never the old three-dot Status menu — with the specific reason(s) available via the same
    // native-tooltip convention `SaveStatusIndicator` already uses elsewhere in this row, rather
    // than a new interactive popover pattern. Never includes another employee's own identifying
    // details — `releaseBlockReasons` are already generic, field-named strings server-side.
    status: (
      <div role="cell" data-col-id="status" className="flex items-center justify-center">
        {entry.released ? (
          <Badge tone="blue">Released</Badge>
        ) : entry.payoutOutcome === 'RECOVERY_DUE' ? (
          <Badge tone="red">Recovery Due</Badge>
        ) : entry.payoutOutcome === 'NO_PAY_DUE' ? (
          <Badge tone="gray">No Pay Due</Badge>
        ) : entry.releaseBlockReasons.length > 0 ? (
          <Badge tone="amber" title={`Reasons:\n${entry.releaseBlockReasons.map((reason) => `• ${reason}`).join('\n')}`}>
            Needs Attention
          </Badge>
        ) : (
          <span className="text-[10px] text-text-faint">—</span>
        )}
      </div>
    ),

    // Employee Code is a business-critical identifier under the permanent Layout Integrity
    // Rule — never ellipsis-clipped, even though every other read-only cell in this row still
    // truncates by default.
    // Frozen Employee Identity Pane (UAT 2026-08-12) — sticky-left, "own real background, never
    // inherited" so a conflict row's `bg-danger-light` carries through here too rather than letting
    // scrolled-under content show through a translucent frozen cell. The paint-order-over-scrolling-
    // siblings `z-10` itself lives in `stickyIdentityCellClassName` (`columns.ts`), not duplicated
    // here (layering correction, UAT 2026-08-12b) — every layer that renders these two columns needs
    // the exact same protection, not just this one.
    // `fullHeight` (vertical-coverage correction, UAT 2026-08-15) — this cell's own content-height
    // box (~24px) previously left this row's `items-center` centering it with an ~8px gap above and
    // below; a scrolling cell in this same row that's taller than that (any bordered pill/input,
    // `self-stretch` per the 2026-08-14 fix, ~26px) had nothing frozen covering that gap once
    // scrolled underneath, regardless of `z-10` — see `ReadOnlyCell`'s own `fullHeight` doc comment.
    employeeCode: (
      <ReadOnlyCell
        colId="employeeCode"
        truncate={false}
        fullHeight
        className={stickyIdentityCellClassName('employeeCode', rowBackgroundClassName)}
        style={{ left: identityOffsets.employeeCode }}
      >
        {entry.employee.employeeCode ?? '—'}
      </ReadOnlyCell>
    ),
    employeeName: (
      <ReadOnlyCell
        colId="employeeName"
        muted={false}
        fullHeight
        className={stickyIdentityCellClassName('employeeName', rowBackgroundClassName)}
        style={{ left: identityOffsets.employeeName }}
      >
        <span className="font-medium">{entry.employee.name}</span>
      </ReadOnlyCell>
    ),

    // Employee Identity Visibility (v1.0.1 Checkpoint 1, 2026-08-25) — Father Name/CNIC join the
    // frozen identity pane alongside Code/Name (`columns.ts`'s `FROZEN_LEFT_COLUMN_IDS`), for the
    // same reason and via the exact same mechanism: `entry.employee.fatherName`/`.cnic` are already
    // present on every loaded entry (no new query), display-only (Employee Registry is the sole
    // editable source, same tier as `designation`/banking below), never truncated (a business
    // identifier, same rule `employeeCode` already follows) and never masked (no existing
    // authorization/design rule requires masking CNIC on this screen — see this checkpoint's own
    // authorization-audit record in `docs/PROJECT_PROGRESS.md`).
    fatherName: (
      <ReadOnlyCell
        colId="fatherName"
        truncate={false}
        fullHeight
        className={stickyIdentityCellClassName('fatherName', rowBackgroundClassName)}
        style={{ left: identityOffsets.fatherName }}
      >
        {entry.employee.fatherName ?? '—'}
      </ReadOnlyCell>
    ),
    cnic: (
      <ReadOnlyCell
        colId="cnic"
        truncate={false}
        fullHeight
        className={stickyIdentityCellClassName('cnic', rowBackgroundClassName)}
        style={{ left: identityOffsets.cnic }}
      >
        {entry.employee.cnic ?? '—'}
      </ReadOnlyCell>
    ),

    // Master Data Boundary (Phase 7D, 2026-07-30) — designation is Employee Registry's identity
    // data (same tier as employeeCode/employeeName above), never independently editable here. While
    // unreleased, the value shown is already the *live* Employee Registry value (the backend
    // overwrites the entry's own stored column with it on every read, `payroll-entry.service.ts`'s
    // `withLiveMasterData`) — editing it in Employee Registry and refreshing this page is the only
    // way to change it.
    designation: <ReadOnlyCell colId="designation">{entry.designation}</ReadOnlyCell>,

    site: <ReadOnlyCell colId="site">{entry.site.name}</ReadOnlyCell>,
    // "Deputed Branch" — the deputed branch/site code for this entry's primary work line, its
    // own `unit` relation. Never `entry.employee.unit` (the employee's *current* default unit,
    // which would silently rewrite a released entry's historical branch). Labeled "Deputed
    // Branch" rather than "Branch Code" to avoid colliding with the unrelated bank Branch Code
    // column below.
    unitCode: <ReadOnlyCell colId="unitCode">{entry.workLines[0]?.unit.code ?? '—'}</ReadOnlyCell>,

    // Master Data Boundary (Phase 7D, 2026-07-30) — bankId/branchCode/accountNumber/iban are
    // Employee Registry's banking data (docs/architecture/database/employee.md), display-only here
    // for the same reason `designation` above is: the checkpoint's explicit requirement that
    // Payroll Entry "must display them but must not allow them to be edited," with all banking
    // changes flowing exclusively through Employee Registry. Bank Code display keeps the same
    // "Code only in this dense grid" rule the removed `InlineSelectCell` used (2026-07-13).
    bankId: (
      <ReadOnlyCell colId="bankId">{entry.bankId ? (banks.find((b) => b.id === entry.bankId)?.code ?? '—') : 'Cash'}</ReadOnlyCell>
    ),
    branchCode: <ReadOnlyCell colId="branchCode">{entry.branchCode ?? '—'}</ReadOnlyCell>,
    accountNumber: <ReadOnlyCell colId="accountNumber">{entry.accountNumber ?? '—'}</ReadOnlyCell>,
    iban: <ReadOnlyCell colId="iban">{entry.iban ?? '—'}</ReadOnlyCell>,

    // Master Data Boundary (Phase 7D, 2026-07-30; extended Phase 7F, 2026-08-04) — Gross Pay is
    // Employee Registry's own data (same tier as designation/banking above), never independently
    // editable here. While unreleased, the value shown is already the *live* Employee Registry
    // value (`withLiveMasterData`, backend) — editing it in Employee Registry and refreshing this
    // page is the only way to change it.
    grossPay: <ReadOnlyCell colId="grossPay" align="right">{formatMoney(entry.grossPay)}</ReadOnlyCell>,
    units: (
      // Frozen Identity Pane UAT correction (2026-08-14) — this is the exact control the reported
      // Units-badge bleed came from.
      //
      // Root cause: `columns.ts`'s `z-10` sticky treatment (2026-08-12b) genuinely wins the
      // stacking-order comparison for every scrolling cell's own background/border/text — real-
      // Chromium `elementFromPoint` hit-testing confirms this holds at every scroll offset. What it
      // cannot reach is a *focus ring*: this button previously relied on the browser's native
      // `:focus-visible` outline (every other interactive control in this codebase — `Button`,
      // `ToggleSwitch`, `inline-cells.tsx`'s inputs — already suppresses that for a `box-shadow` ring
      // instead), and `outline`/`box-shadow` are pure paint, invisible to both hit-testing *and*
      // normal stacking-order comparisons — they can render a couple px beyond their own element's
      // layout box regardless of that element's z-index. Since this row is `position: absolute` with
      // no explicit z-index of its own (virtualization, `payroll-entry-grid.tsx`), it does not form
      // its own stacking context, so a ring that escapes this cell's box is simply unclipped paint
      // sitting on top of whatever is underneath — including a neighboring row's identity pane —
      // rather than something the z-10 tie-break (which only ever compares siblings *within* one row)
      // has any say over.
      //
      // `outline-none` + the shared ring convention closes the "native outline" half of this; this
      // cell's own `overflow-hidden` closes the rest, by clipping the ring itself to this cell's own
      // box so it can never render outside the row it belongs to in the first place — deliberately
      // scoped to this one cell, not the row (tried and reverted; see the row's own `className`
      // comment for why `overflow-hidden` on the row itself breaks `position: sticky`). Verified by
      // real pixel sampling (`elementFromPoint` hit-testing cannot see this class of bug at all — it
      // never queries painted pixels, only layout-box topology) in `28-payroll-entry-frozen-
      // identity.spec.ts`'s Scenario K.
      <div role="cell" data-col-id="units" className="flex items-center justify-center self-stretch overflow-hidden">
        <button
          type="button"
          onClick={() => setIsSplitOpen(true)}
          className="rounded border border-border bg-surface px-2 py-1 text-[10.5px] font-medium text-text outline-none transition-colors hover:border-accent-mid hover:text-accent-mid focus-visible:ring-2 focus-visible:ring-accent-mid focus-visible:ring-offset-1"
          aria-label={`Split by ${unitLabel} — ${entry.employee.name} — currently ${unitCount} ${
            unitCount === 1 ? unitLabel : pluralize(unitLabel)
          }`}
        >
          {unitCount} {unitCount === 1 ? unitLabel : pluralize(unitLabel)}
        </button>
      </div>
    ),

    // v1.0.0 audit-correctness fix: for a split (multi-unit) employee, this cell is the employee
    // aggregate Working Days — the sum of every work line's own days (`calc.totalWorkingDays`),
    // never just the primary line's. That aggregate cannot also be *this* cell's own directly-typed
    // input without letting an edit here silently rewrite only the primary line while the visible
    // number is a sum of several — a real data-entry hazard — so a split employee's individual
    // lines stay editable exclusively through the existing "Split by {unitLabel}" modal (`units`
    // cell above), the same modal that already owns adding/removing lines. A single-line employee
    // is unaffected either way: the aggregate and the primary line's own value are identical, so
    // this remains the exact same directly-editable input as before this fix.
    days:
      unitCount > 1 ? (
        <ReadOnlyCell colId="days" align="right">{calc.totalWorkingDays}</ReadOnlyCell>
      ) : (
        // Focused-control containment (Frozen Identity Pane UAT correction, 2026-08-14) — same
        // mechanism as `units`'s own comment above: `overflow-hidden` clips this input's own focus
        // ring to this cell's box so it can never bleed into a neighboring row's identity pane. Also
        // needs `self-stretch` (every cell below shares this) — without it, this cell's own box
        // shrinks to its content's height (the input's, ~26px) and is centered within the 40px row by
        // the parent grid's `items-center` instead, leaving no room *inside this cell's own box* for
        // the ring to be clipped into; `self-stretch` (+ `flex items-center`, replacing that same
        // centering locally) makes the cell itself the full `ROW_HEIGHT` tall, with real headroom
        // `overflow-hidden` can actually use.
        <div role="cell" data-col-id="days" className="flex items-center self-stretch overflow-hidden">
          <InlineNumberCell
            value={effectiveLine.days}
            onChange={(v) => editor.setWorkLineField('days', v)}
            disabled={disabled}
            invalid={!isValidDecimalDraft(effectiveLine.days, false)}
            nav={nav('days')}
            ariaLabel={`Working days for ${entry.employee.name}`}
          />
        </div>
      ),
    otHours: (
      <div role="cell" data-col-id="otHours" className="flex items-center self-stretch overflow-hidden">
        <InlineNumberCell
          value={effectiveLine.otHours}
          onChange={(v) => editor.setWorkLineField('otHours', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveLine.otHours, false)}
          nav={nav('otHours')}
          ariaLabel={`OT hours for ${entry.employee.name}`}
        />
      </div>
    ),
    otRate: (
      <div role="cell" data-col-id="otRate" className="flex items-center self-stretch overflow-hidden">
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
    ),
    cycleDays: (
      <div role="cell" data-col-id="cycleDays" className="flex items-center self-stretch overflow-hidden">
        <InlineNumberCell
          value={cycleDaysInputValue}
          onChange={(v) => editor.setWorkLineField('cycleDays', v)}
          disabled={disabled}
          invalid={parseValidCycleDays(cycleDaysInputValue) === undefined}
          nav={nav('cycleDays')}
          ariaLabel={`Cycle days for ${entry.employee.name}`}
        />
      </div>
    ),
    leaveDays: (
      <div role="cell" data-col-id="leaveDays" className="flex items-center self-stretch overflow-hidden">
        <InlineNumberCell
          value={effectiveEntry.leaveDays}
          onChange={(v) => editor.setEntryField('leaveDays', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveEntry.leaveDays, false)}
          nav={nav('leaveDays')}
          ariaLabel={`Leave days for ${entry.employee.name}`}
        />
      </div>
    ),
    leaveRate: (
      <div role="cell" data-col-id="leaveRate" className="flex items-center self-stretch overflow-hidden">
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
    ),
    allowance: (
      <div role="cell" data-col-id="allowance" className="flex items-center self-stretch overflow-hidden">
        <InlineNumberCell
          value={effectiveEntry.allowance}
          onChange={(v) => editor.setEntryField('allowance', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveEntry.allowance, false)}
          nav={nav('allowance')}
          ariaLabel={`Allowance for ${entry.employee.name}`}
        />
      </div>
    ),

    eobiAmount: (
      <div role="cell" data-col-id="eobiAmount" className="flex items-center self-stretch overflow-hidden">
        <InlineNumberCell
          value={effectiveEntry.eobiAmount}
          onChange={(v) => editor.setEntryField('eobiAmount', v)}
          disabled={disabled}
          invalid={!isValidDecimalDraft(effectiveEntry.eobiAmount, false)}
          nav={nav('eobiAmount')}
          ariaLabel={`EOBI amount for ${entry.employee.name}`}
        />
      </div>
    ),
    eobiApplicable: (
      <div role="cell" data-col-id="eobiApplicable" className="flex items-center justify-center self-stretch overflow-hidden">
        <ToggleSwitch
          checked={effectiveEntry.eobiApplicable}
          onCheckedChange={(v) => editor.setEntryField('eobiApplicable', v)}
          disabled={disabled}
          aria-label={`EOBI applicable for ${entry.employee.name}`}
          {...nav('eobiApplicable')}
        />
      </div>
    ),

    advanceDeduction: (
      <div role="cell" data-col-id="advanceDeduction" className="flex flex-col justify-center self-stretch overflow-hidden">
        <InlineNumberCell
          value={effectiveEntry.advanceDeduction}
          onChange={(v) => editor.setEntryField('advanceDeduction', v)}
          disabled={disabled}
          deduct
          compact={Boolean(entry.advance)}
          invalid={!isValidDecimalDraft(effectiveEntry.advanceDeduction, false)}
          nav={nav('advanceDeduction')}
          ariaLabel={`Advance deduction for ${entry.employee.name}`}
        />
        {/* Phase 4 Checkpoint 5 (Advances) — small linked-balance indicator, PROJECT_SPEC.md's own
            requirement ("visible... in Payroll Entry, small balance indicator under the advance/eid
            input"). Read-only here; managed from the Advances page. The column is measured to
            already fit this label (`columns.ts`'s `BALANCE_LABEL_COLUMN_IDS`), so it never
            overflows the cell. `compact` above + this stacked block being vertically centered by
            the parent row's own `items-center` (Advance Balance presentation fix, 2026-07-30) is
            what keeps the balance line clear of the row's bottom border without growing
            `ROW_HEIGHT`. */}
        {/* v1.0.4 Cancel Business Semantics — a RELEASED entry's link is never cleared by
            cancelAdvance, so this can still show a since-cancelled Advance's stored balance (the
            true waived remainder, never zeroed) when viewing a historical released cycle; masked
            to 0 here exactly like every other Outstanding-Balance surface. */}
        {entry.advance && (
          <BalanceLabel amount={isOutstandingWaived(entry.advance.status) ? '0' : entry.advance.outstandingBalance} />
        )}
      </div>
    ),
    eidAdvanceDeduction: (
      <div role="cell" data-col-id="eidAdvanceDeduction" className="flex flex-col justify-center self-stretch overflow-hidden">
        <InlineNumberCell
          value={effectiveEntry.eidAdvanceDeduction}
          onChange={(v) => editor.setEntryField('eidAdvanceDeduction', v)}
          disabled={disabled}
          deduct
          compact={Boolean(entry.eidAdvance)}
          invalid={!isValidDecimalDraft(effectiveEntry.eidAdvanceDeduction, false)}
          nav={nav('eidAdvanceDeduction')}
          ariaLabel={`Eid advance deduction for ${entry.employee.name}`}
        />
        {entry.eidAdvance && (
          <BalanceLabel amount={isOutstandingWaived(entry.eidAdvance.status) ? '0' : entry.eidAdvance.outstandingBalance} />
        )}
      </div>
    ),
    fine: (
      <div role="cell" data-col-id="fine" className="flex items-center self-stretch overflow-hidden">
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
    ),

    hold: (
      <div role="cell" data-col-id="hold" className="flex items-center justify-center self-stretch overflow-hidden">
        <ToggleSwitch
          checked={effectiveEntry.hold}
          onCheckedChange={(v) => editor.setEntryField('hold', v)}
          disabled={disabled}
          aria-label={`Hold for ${entry.employee.name}`}
          {...nav('hold')}
        />
      </div>
    ),

    remarks: (
      <div role="cell" data-col-id="remarks" className="flex items-center self-stretch overflow-hidden">
        <InlineTextCell
          value={effectiveEntry.remarks ?? ''}
          onChange={(v) => editor.setEntryField('remarks', v || null)}
          disabled={disabled}
          maxLength={2000}
          nav={nav('remarks')}
          ariaLabel={`Remarks for ${entry.employee.name}`}
        />
      </div>
    ),

    netSalary: (
      <ReadOnlyCell colId="netSalary" align="right" muted={false}>
        <span className={cn('font-semibold', Number(calc.netSalary) < 0 ? 'text-danger' : 'text-success')}>
          {formatMoney(calc.netSalary)}
        </span>
      </ReadOnlyCell>
    ),
  };

  // Employee Row Actions (UAT 2026-08-11, RBAC-split revision; row-level-control correction, UAT
  // 2026-08-12) — the row's `⋯` overflow menu is a characteristic of the row, not a payroll data
  // column: it is rendered below as a trailing flex sibling *after* the data-cell grid, never as a
  // `PAYROLL_COLUMNS`/`cells` entry, so it can never re-enter column count, sorting, visibility, or
  // totals-calculation logic, and is never sticky. No trigger at all when the caller has neither
  // `canEditEmployee` nor `canMarkEmployeeLeft` (never a visible-but-dead action) — the reserved
  // trailing width slot still renders, empty, matching Employee Registry's own
  // `<TableHead className="w-10" />` convention for the same permission-absent case. Each menu item
  // renders off its own independent flag: a Payroll Entry-only caller sees Mark as Left but not
  // Edit Employee; an `employees:edit`-only caller (reaching this page some other way) sees the
  // reverse; never a disabled item for whichever action the caller lacks.
  const rowActionsMenu = (canEditEmployee || canMarkEmployeeLeft) && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded p-1 text-text-muted transition-colors hover:bg-bg hover:text-text"
          aria-label={`Employee actions for ${entry.employee.name}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEditEmployee && (
          <DropdownMenuItem onSelect={() => onEditEmployee(entry.employee)}>Edit Employee</DropdownMenuItem>
        )}
        {canMarkEmployeeLeft && !entry.employee.dateOfLeaving && (
          <DropdownMenuItem onSelect={() => onMarkLeftEmployee(entry.employee)}>Mark as Left</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
    <div
      role="row"
      style={style}
      className={cn(
        // Explicit opaque background (not left to inherit from the ancestor Card's own bg-surface-2)
        // — this row is absolutely positioned and transformed by the virtualizer, sharing screen
        // space with the grid's sticky header/totals rows during scroll. Relying on an ancestor's
        // incidental background was a confirmed robustness gap (Post-Checkpoint-1A UAT
        // Stabilization) — a transparent row has no defense against underlying content becoming
        // visible during sticky/virtualized composition, regardless of the exact browser mechanism
        // — every row is now its own fully opaque paint surface, regardless of what's behind it.
        // `flex` (not `grid`) at this outer level (UAT 2026-08-12 row-action correction) — the row's
        // data-cell grid and its trailing `⋯` action are two flex siblings below, not grid tracks,
        // so the action can never become a `gridTemplateColumns` track/column.
        //
        // Deliberately NOT `overflow-hidden` here (tried and reverted during the 2026-08-14 Frozen
        // Identity Pane UAT correction) — per the CSS Overflow spec, `overflow: hidden` establishes a
        // *scroll container* (it just happens to be one a user can't scroll by gesture), and
        // `employeeCode`/`employeeName`'s `position: sticky` (`columns.ts`'s `stickyIdentityCellClassName`)
        // sticks relative to its nearest such ancestor. Adding it here would make *this row* — which
        // never itself scrolls; only the outer `role="table"` container does — that nearest ancestor
        // instead of the real scroll container, silently turning the sticky cells into plain
        // statically-positioned ones that scroll away with everything else. Confirmed by a real-
        // Chromium regression during this same fix: with it in place, the identity cells vanished
        // entirely at any non-trivial scroll offset instead of staying pinned. The per-cell
        // `overflow-hidden` on individual *scrolling* cells below (never on this row, never on the
        // identity cells themselves) is the safe version of the same idea — see `units`'s own comment.
        'flex border-b border-border text-xs',
        // Independent-review remediation (M4) — `twMerge` resolves a `bg-*` conflict by keeping only
        // the *last* class in this list, so a naive `bg-danger-light/40` here previously dropped
        // `bg-surface-2` entirely for a conflict row, silently reintroducing the exact translucent-
        // background gap the fix above exists to close. `bg-danger-light` (no opacity modifier) is
        // the same solid, already-vetted semantic color badge.tsx's own `hold`/`red` variants and
        // the Print Options dialog's warning banner already use at full opacity — fully opaque,
        // still visually distinct from the row's ordinary white, never translucent.
        rowBackgroundClassName,
      )}
    >
      <div className="grid shrink-0 items-center" style={{ gridTemplateColumns }}>
        {PAYROLL_COLUMNS.map((column) => (
          <Fragment key={column.id}>{cells[column.id]}</Fragment>
        ))}
      </div>
      {/* Trailing row action (UAT 2026-08-12 correction) — deliberately carries no `data-col-id`/
          `role="cell"`: it is not a table column, just the row's own final control, so it must never
          be picked up by either convention's "one cell per PAYROLL_COLUMNS entry" queries.
          `shrink-0` + the shared fixed `ROW_ACTION_WIDTH` keeps it pinned to its own reserved slot
          regardless of how wide the data-cell grid to its left ends up. */}
      <div
        data-row-action="employee-actions"
        className="flex shrink-0 items-center justify-center"
        style={{ width: ROW_ACTION_WIDTH }}
      >
        {rowActionsMenu}
      </div>
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
    // The shared grid template changes whenever any loaded value (on any row) needs a wider
    // column than before — every mounted row must re-render to stay pixel-aligned when it does.
    prev.gridTemplateColumns === next.gridTemplateColumns &&
    // Frozen Employee Identity Pane (UAT 2026-08-12) — recomputed by the grid whenever
    // `resolvedColumns` changes (the same trigger `gridTemplateColumns` above already reacts to),
    // and reused as-is by every row via reference equality, exactly like that prop.
    prev.identityOffsets === next.identityOffsets &&
    prev.style.transform === next.style.transform &&
    // Employee Row Actions (UAT 2026-08-11) — `canEditEmployee`/`canMarkEmployeeLeft` are plain
    // booleans and `onEditEmployee`/`onMarkLeftEmployee` are stable references defined once at the
    // page level and forwarded verbatim through the grid (never rewrapped in a new inline closure
    // per render), so a reference/value check here is exactly as cheap and correct as every other
    // field in this comparator — never stale once `entry` itself is confirmed unchanged above.
    prev.canEditEmployee === next.canEditEmployee &&
    prev.canMarkEmployeeLeft === next.canMarkEmployeeLeft &&
    prev.onEditEmployee === next.onEditEmployee &&
    prev.onMarkLeftEmployee === next.onMarkLeftEmployee
  );
});

export { ROW_HEIGHT };
