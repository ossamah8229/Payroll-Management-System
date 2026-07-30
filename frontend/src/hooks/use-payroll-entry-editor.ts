import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { calcNet, type AddWorkLineInput, type UpdatePayrollEntryInput, type UpdateWorkLineInput } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';
import {
  isEntryEditable,
  reloadPayrollEntry,
  useAddWorkLine,
  useDeleteWorkLine,
  useUpdatePayrollEntry,
  useUpdateWorkLine,
  type PayrollEntry,
  type PayrollEntryWorkLine,
} from '@/hooks/use-payroll-entries';
import { buildCalcInput } from '@/components/payroll-entry/calc-input';
import { isValidDecimalDraft, parseValidCycleDays } from '@/components/payroll-entry/numeric-validation';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

type EntryDraft = Partial<Omit<UpdatePayrollEntryInput, 'version'>>;
/** `cycleDays` is tracked as the raw typed string, not the wire-format number — parsed/validated
 * only at commit time (`sanitizeLineDraft`, below), the same "let the user type freely, gate at
 * send time" pattern the decimal fields already use. Storing it as a number and validating inside
 * the `onChange` handler (this hook's original design) silently discarded invalid keystrokes,
 * which made the input appear to randomly revert while backspacing/retyping. */
type LineDraft = Partial<Pick<UpdateWorkLineInput, 'unitId' | 'days' | 'otHours' | 'otRate'>> & {
  cycleDays?: string;
};

/** Which `EntryDraft` keys are decimal-string fields, and whether an empty string is itself a
 * valid value for that field (the nullable rate fields — Leave Rate) vs. not yet a value to save
 * (every other numeric field). Non-decimal keys (hold, remarks, …) pass through
 * `sanitizeEntryDraft` unchanged — there is nothing to validate. (Phase 7D, 2026-07-30:
 * `designation`/`bankId`/`branchCode`/`accountNumber`/`iban` are no longer part of `EntryDraft` at
 * all — Employee Registry is now the sole editable source for them.) */
const ENTRY_DECIMAL_FIELDS: { key: keyof EntryDraft; nullable: boolean }[] = [
  { key: 'grossPay', nullable: false },
  { key: 'allowance', nullable: false },
  { key: 'leaveDays', nullable: false },
  { key: 'leaveRate', nullable: true },
  { key: 'eobiAmount', nullable: false },
  { key: 'advanceDeduction', nullable: false },
  { key: 'eidAdvanceDeduction', nullable: false },
  { key: 'fine', nullable: false },
];
const ENTRY_DECIMAL_FIELD_KEYS = new Set(ENTRY_DECIMAL_FIELDS.map((f) => f.key));

const LINE_DECIMAL_FIELDS: { key: 'days' | 'otHours' | 'otRate'; nullable: boolean }[] = [
  { key: 'days', nullable: false },
  { key: 'otHours', nullable: false },
  { key: 'otRate', nullable: true },
];

const SAVE_DEBOUNCE_MS = 600;
const MAX_AUTO_RETRIES = 3;
const SAVED_INDICATOR_MS = 1500;

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

/** True 409 conflict — someone else changed this row first (docs/architecture/database/schema-invariants.md
 * §22 optimistic locking) — vs. any other failure, which gets auto-retried instead. */
function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/** A 400 (Zod `VALIDATION_ERROR`) means the payload itself was rejected — retrying the exact same
 * value on a timer would just fail identically every time. This should be unreachable in practice
 * now that `sanitizeEntryDraft`/`sanitizeLineDraft` filter out anything that wouldn't pass the
 * same validation before it's ever sent, but is kept as defense in depth: never burn the auto-retry
 * budget on a failure retrying cannot fix. */
function isValidationError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

/** Splits a draft into what's currently valid to send vs. what must stay pending — an incomplete
 * or unparseable numeric value (`""`, `"-"`, `"."`, `"abc"`) is never sent to the server; it simply
 * stays in the draft, still shown to the user, until it becomes valid. */
function sanitizeEntryDraft(draft: EntryDraft): Partial<Omit<UpdatePayrollEntryInput, 'version'>> {
  const sendable: EntryDraft = {};
  for (const [key, value] of Object.entries(draft)) {
    if (ENTRY_DECIMAL_FIELD_KEYS.has(key as keyof EntryDraft)) {
      const field = ENTRY_DECIMAL_FIELDS.find((f) => f.key === key)!;
      if (typeof value === 'string' && !isValidDecimalDraft(value, field.nullable)) continue;
    }
    (sendable as Record<string, unknown>)[key] = value;
  }
  return sendable;
}

function sanitizeLineDraft(draft: LineDraft): Partial<UpdateWorkLineInput> {
  const sendable: Partial<UpdateWorkLineInput> = {};
  if (draft.unitId !== undefined) sendable.unitId = draft.unitId;
  for (const field of LINE_DECIMAL_FIELDS) {
    const value = draft[field.key];
    if (value === undefined) continue;
    if (typeof value === 'string' && !isValidDecimalDraft(value, field.nullable)) continue;
    (sendable as Record<string, unknown>)[field.key] = value;
  }
  if (draft.cycleDays !== undefined) {
    const parsed = parseValidCycleDays(draft.cycleDays);
    if (parsed !== undefined) sendable.cycleDays = parsed;
  }
  return sendable;
}

export interface EffectiveWorkLine extends PayrollEntryWorkLine {
  /** The raw typed text for Cycle Days (see `LineDraft.cycleDays`'s comment) — every line exposes
   * this the same way, not just the primary one, so the Split by {unitLabel} modal's inputs never
   * silently revert mid-keystroke either. */
  cycleDaysInputValue: string;
}

/**
 * Per-row editing/autosave state machine — one instance per `PayrollEntryRow`, shared verbatim by
 * that row's inline cells *and* its "Split by {unitLabel}" modal when open (the modal is another
 * editing surface for the same `PayrollEntry`, not a second editing system — decision recorded
 * 2026-07-09). Owns: local draft overlays for entry-level fields and *every* work line (keyed by
 * line id, not just the primary one), live `calcNet` recomputation (shared library only, never
 * reimplemented), one debounced-autosave queue serializing entry-field and every line's edits
 * through the same optimistic-locking `version` chain, structural add/delete-line actions routed
 * through that identical queue, and error retry with backoff. See
 * docs/architecture/database/schema-invariants.md §22 for the version-based locking contract this
 * mirrors.
 */
export function usePayrollEntryEditor(entry: PayrollEntry, cycleId: string, cycleStatus: string) {
  const queryClient = useQueryClient();
  const updateEntry = useUpdatePayrollEntry(cycleId);
  const updateWorkLine = useUpdateWorkLine(cycleId);
  const addWorkLineMutation = useAddWorkLine(cycleId);
  const deleteWorkLineMutation = useDeleteWorkLine(cycleId);

  const [entryDraft, setEntryDraftState] = useState<EntryDraft>({});
  const [lineDrafts, setLineDraftsState] = useState<Record<string, LineDraft>>({});
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const entryDraftRef = useRef(entryDraft);
  entryDraftRef.current = entryDraft;
  const lineDraftsRef = useRef(lineDrafts);
  lineDraftsRef.current = lineDrafts;
  const statusRef = useRef(status);
  statusRef.current = status;
  const entryRef = useRef(entry);
  entryRef.current = entry;

  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const retryCountRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current);
      clearTimeout(retryTimerRef.current);
      clearTimeout(savedResetTimerRef.current);
    };
  }, []);

  const editable = isEntryEditable(entry, cycleStatus);

  // A mid-typing draft (`"-"`, `"."`, `"abc"`, a momentarily-empty required field) is expected and
  // must never crash the row — `calcNet`'s underlying `decimal.js` throws synchronously on an
  // unparseable string. Falling back to the entry's own last-saved figures (always valid, per the
  // database's own numeric column constraints) keeps the live preview showing the last sensible
  // net salary instead of a blank screen until the draft becomes valid again.
  const calc = useMemo(() => {
    try {
      return calcNet(buildCalcInput(entry, entryDraft, lineDrafts));
    } catch {
      return calcNet(buildCalcInput(entry));
    }
  }, [entry, entryDraft, lineDrafts]);

  const clearSavedEntryKeys = useCallback((sent: EntryDraft) => {
    setEntryDraftState((current) => {
      const next = { ...current };
      for (const key of Object.keys(sent)) {
        if (next[key as keyof EntryDraft] === sent[key as keyof EntryDraft]) {
          delete next[key as keyof EntryDraft];
        }
      }
      entryDraftRef.current = next;
      return next;
    });
  }, []);

  const clearSavedLineKeys = useCallback((lineId: string, sent: LineDraft) => {
    setLineDraftsState((current) => {
      const currentLine = current[lineId];
      if (!currentLine) return current;
      const nextLine = { ...currentLine };
      for (const key of Object.keys(sent) as (keyof LineDraft)[]) {
        if (nextLine[key] === sent[key]) delete nextLine[key];
      }
      const next = { ...current };
      if (Object.keys(nextLine).length === 0) {
        delete next[lineId];
      } else {
        next[lineId] = nextLine;
      }
      lineDraftsRef.current = next;
      return next;
    });
  }, []);

  const dropLineDraft = useCallback((lineId: string) => {
    setLineDraftsState((current) => {
      if (!(lineId in current)) return current;
      const next = { ...current };
      delete next[lineId];
      lineDraftsRef.current = next;
      return next;
    });
  }, []);

  /** Sequential, version-chained flush of every dirty entry field + every dirty line's fields, all
   * under one `savingRef` gate — this is what makes "the modal is another editing surface for the
   * same entry" true in practice: an edit made inline in the grid and an edit made a second later
   * in the modal are queued through this exact same function, never two independent commit loops
   * racing each other for the same `version`. */
  const commit = useCallback(async () => {
    if (statusRef.current === 'conflict') return;

    const sentEntry = sanitizeEntryDraft(entryDraftRef.current);
    const dirtyLineIds = entryRef.current.workLines
      .map((line) => line.id)
      .filter((id) => lineDraftsRef.current[id] !== undefined);
    const sentLines = dirtyLineIds
      .map((id) => ({ id, fields: sanitizeLineDraft(lineDraftsRef.current[id]!) }))
      .filter(({ fields }) => Object.keys(fields).length > 0);

    const hasEntryChanges = Object.keys(sentEntry).length > 0;
    if (!hasEntryChanges && sentLines.length === 0) return;

    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }

    savingRef.current = true;
    setStatus('saving');
    setErrorMessage(undefined);

    try {
      let version = entryRef.current.version;

      if (hasEntryChanges) {
        const result = await updateEntry.mutateAsync({
          id: entry.id,
          input: { version, ...sentEntry },
        });
        version = result.entry.version;
        clearSavedEntryKeys(sentEntry);
      }

      for (const { id: lineId, fields } of sentLines) {
        // Captured *before* the request goes out — `fields.cycleDays` is the parsed number the
        // wire format needs, but the draft (and `clearSavedLineKeys`'s comparison) tracks the raw
        // string, so this is what "was the draft still exactly what we sent" must compare against.
        const rawCycleDaysAtSendTime = lineDraftsRef.current[lineId]?.cycleDays;
        const result = await updateWorkLine.mutateAsync({
          id: lineId,
          input: { version, ...fields },
        });
        version = result.entry.version;
        const clearKeys: LineDraft = {};
        if (fields.unitId !== undefined) clearKeys.unitId = fields.unitId;
        if (fields.days !== undefined) clearKeys.days = fields.days;
        if (fields.otHours !== undefined) clearKeys.otHours = fields.otHours;
        if (fields.otRate !== undefined) clearKeys.otRate = fields.otRate;
        if (fields.cycleDays !== undefined) clearKeys.cycleDays = rawCycleDaysAtSendTime;
        clearSavedLineKeys(lineId, clearKeys);
      }

      retryCountRef.current = 0;
      const stillDirty =
        Object.keys(entryDraftRef.current).length > 0 || Object.keys(lineDraftsRef.current).length > 0;
      if (stillDirty) {
        setStatus('dirty');
      } else {
        setStatus('saved');
        savedResetTimerRef.current = setTimeout(() => {
          setStatus((current) => (current === 'saved' ? 'idle' : current));
        }, SAVED_INDICATOR_MS);
      }
    } catch (error) {
      if (isConflict(error)) {
        setStatus('conflict');
        setErrorMessage('This row was changed elsewhere — reload it to keep editing.');
      } else {
        setStatus('error');
        setErrorMessage(error instanceof ApiError ? error.message : 'Save failed — will retry automatically.');
        if (!isValidationError(error)) {
          retryCountRef.current += 1;
          if (retryCountRef.current <= MAX_AUTO_RETRIES) {
            retryTimerRef.current = setTimeout(() => {
              void commit();
            }, backoffMs(retryCountRef.current));
          }
        }
      }
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void commit();
      }
    }
  }, [entry.id, updateEntry, updateWorkLine, clearSavedEntryKeys, clearSavedLineKeys]);

  const scheduleSave = useCallback(() => {
    setStatus((current) => (current === 'conflict' ? current : 'dirty'));
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void commit();
    }, SAVE_DEBOUNCE_MS);
  }, [commit]);

  const setEntryField = useCallback(
    <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => {
      setEntryDraftState((prev) => {
        const next = { ...prev, [key]: value };
        entryDraftRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const setLineField = useCallback(
    <K extends keyof LineDraft>(lineId: string, key: K, value: LineDraft[K]) => {
      setLineDraftsState((prev) => {
        const next = { ...prev, [lineId]: { ...prev[lineId], [key]: value } };
        lineDraftsRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const primaryLine = entry.workLines[0]!;

  /** Backward-compatible alias for the grid's own inline cells, which only ever edit the primary
   * line — equivalent to `setLineField(primaryLine.id, key, value)`. */
  const setWorkLineField = useCallback(
    <K extends keyof LineDraft>(key: K, value: LineDraft[K]) => {
      setLineField(primaryLine.id, key, value);
    },
    [setLineField, primaryLine.id],
  );

  const retryNow = useCallback(() => {
    clearTimeout(retryTimerRef.current);
    retryCountRef.current = 0;
    void commit();
  }, [commit]);

  const reload = useCallback(async () => {
    clearTimeout(saveTimerRef.current);
    clearTimeout(retryTimerRef.current);
    clearTimeout(savedResetTimerRef.current);
    retryCountRef.current = 0;
    savingRef.current = false;
    pendingRef.current = false;
    setEntryDraftState({});
    setLineDraftsState({});
    entryDraftRef.current = {};
    lineDraftsRef.current = {};
    setStatus('idle');
    setErrorMessage(undefined);
    await reloadPayrollEntry(queryClient, cycleId, entry.id);
  }, [cycleId, entry.id, queryClient]);

  /** Adds a new `PayrollEntryWorkLine` — a structural, immediate action (not a debounced field
   * edit), consistent with how every other structural action in this app persists instantly rather
   * than staging behind a separate Save step. Still goes through the same `savingRef` gate as
   * `commit()` (guarded by the modal disabling the control while `status === 'saving'`), so it can
   * never race a field-edit flush for the same entry's `version`. */
  const addLine = useCallback(
    async (input: Omit<AddWorkLineInput, 'version'>) => {
      if (statusRef.current === 'conflict' || savingRef.current) return;
      savingRef.current = true;
      setStatus('saving');
      setErrorMessage(undefined);
      try {
        await addWorkLineMutation.mutateAsync({
          entryId: entry.id,
          input: { version: entryRef.current.version, ...input },
        });
        retryCountRef.current = 0;
        setStatus('saved');
        savedResetTimerRef.current = setTimeout(() => {
          setStatus((current) => (current === 'saved' ? 'idle' : current));
        }, SAVED_INDICATOR_MS);
      } catch (error) {
        if (isConflict(error)) {
          setStatus('conflict');
          setErrorMessage('This entry was changed elsewhere — reload it to keep editing.');
        } else {
          setStatus('error');
          setErrorMessage(error instanceof ApiError ? error.message : 'Adding the line failed — try again.');
        }
      } finally {
        savingRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          void commit();
        }
      }
    },
    [entry.id, addWorkLineMutation, commit],
  );

  /** Removes a work line — same immediate, non-debounced pattern as `addLine`. Clears any pending
   * draft for that line first so a stale debounce timer can never fire a PATCH against a line that
   * no longer exists. The last-remaining-line guard is enforced server-side (§12a); the modal also
   * disables the affordance client-side so this is defense-in-depth, not the only guard. */
  const deleteLine = useCallback(
    async (lineId: string) => {
      if (statusRef.current === 'conflict' || savingRef.current) return;
      clearTimeout(saveTimerRef.current);
      dropLineDraft(lineId);
      savingRef.current = true;
      setStatus('saving');
      setErrorMessage(undefined);
      try {
        await deleteWorkLineMutation.mutateAsync({ id: lineId, version: entryRef.current.version });
        retryCountRef.current = 0;
        setStatus('saved');
        savedResetTimerRef.current = setTimeout(() => {
          setStatus((current) => (current === 'saved' ? 'idle' : current));
        }, SAVED_INDICATOR_MS);
      } catch (error) {
        if (isConflict(error)) {
          setStatus('conflict');
          setErrorMessage('This entry was changed elsewhere — reload it to keep editing.');
        } else {
          setStatus('error');
          setErrorMessage(error instanceof ApiError ? error.message : 'Deleting the line failed — try again.');
        }
      } finally {
        savingRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          void commit();
        }
      }
    },
    [deleteWorkLineMutation, dropLineDraft, commit],
  );

  const effectiveEntry = useMemo(() => ({ ...entry, ...entryDraft }), [entry, entryDraft]);

  const effectiveLines: EffectiveWorkLine[] = useMemo(
    () =>
      entry.workLines.map((line) => {
        const draft = lineDrafts[line.id];
        const validDraftCycleDays =
          draft?.cycleDays !== undefined ? parseValidCycleDays(draft.cycleDays) : undefined;
        return {
          ...line,
          ...draft,
          cycleDays: validDraftCycleDays ?? line.cycleDays,
          cycleDaysInputValue: draft?.cycleDays ?? String(line.cycleDays),
        };
      }),
    [entry.workLines, lineDrafts],
  );

  const effectiveLine = effectiveLines[0]!;
  const cycleDaysInputValue = effectiveLine.cycleDaysInputValue;

  return {
    editable,
    effectiveEntry,
    effectiveLine,
    effectiveLines,
    cycleDaysInputValue,
    calc,
    status,
    errorMessage,
    hasUnsavedChanges: Object.keys(entryDraft).length > 0 || Object.keys(lineDrafts).length > 0,
    setEntryField,
    setWorkLineField,
    setLineField,
    addLine,
    deleteLine,
    retryNow,
    reload,
  };
}
