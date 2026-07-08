import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { calcNet, type UpdatePayrollEntryInput, type UpdateWorkLineInput } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';
import {
  isEntryEditable,
  reloadPayrollEntry,
  useUpdatePayrollEntry,
  useUpdateWorkLine,
  type PayrollEntry,
} from '@/hooks/use-payroll-entries';
import { buildCalcInput } from '@/components/payroll-entry/calc-input';
import { isValidDecimalDraft, parseValidCycleDays } from '@/components/payroll-entry/numeric-validation';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

type EntryDraft = Partial<Omit<UpdatePayrollEntryInput, 'version'>>;
/** `cycleDays` is tracked as the raw typed string, not the wire-format number — parsed/validated
 * only at commit time (`sanitizeWorkLineDraft`, below), the same "let the user type freely, gate at
 * send time" pattern the decimal fields already use. Storing it as a number and validating inside
 * the `onChange` handler (this hook's original design) silently discarded invalid keystrokes,
 * which made the input appear to randomly revert while backspacing/retyping. */
type WorkLineDraft = Partial<Pick<UpdateWorkLineInput, 'days' | 'otHours' | 'otRate'>> & {
  cycleDays?: string;
};

/** Which `EntryDraft` keys are decimal-string fields, and whether an empty string is itself a
 * valid value for that field (the nullable rate fields — Leave Rate) vs. not yet a value to save
 * (every other numeric field). Non-decimal keys (designation, bankId, hold, remarks, …) pass
 * through `sanitizeEntryDraft` unchanged — there is nothing to validate. */
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

const WORK_LINE_DECIMAL_FIELDS: { key: 'days' | 'otHours' | 'otRate'; nullable: boolean }[] = [
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

/** True 409 conflict — someone else changed this row first (docs/architecture/database-schema.md
 * §22 optimistic locking) — vs. any other failure, which gets auto-retried instead. */
function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/** A 400 (Zod `VALIDATION_ERROR`) means the payload itself was rejected — retrying the exact same
 * value on a timer would just fail identically every time. This should be unreachable in practice
 * now that `sanitizeEntryDraft`/`sanitizeWorkLineDraft` filter out anything that wouldn't pass the
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

function sanitizeWorkLineDraft(draft: WorkLineDraft): Partial<UpdateWorkLineInput> {
  const sendable: Partial<UpdateWorkLineInput> = {};
  for (const field of WORK_LINE_DECIMAL_FIELDS) {
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

/**
 * Per-row editing/autosave state machine — one instance per `PayrollEntryRow`. Owns: local draft
 * overlays for entry-level and primary-work-line fields, live `calcNet` recomputation (shared
 * library only, never reimplemented), debounced autosave, optimistic-locking conflict handling,
 * and error retry with backoff. See docs/architecture/database-schema.md §22 for the version-based
 * locking contract this mirrors.
 */
export function usePayrollEntryEditor(entry: PayrollEntry, cycleId: string, cycleStatus: string) {
  const queryClient = useQueryClient();
  const updateEntry = useUpdatePayrollEntry(cycleId);
  const updateWorkLine = useUpdateWorkLine(cycleId);

  const [entryDraft, setEntryDraftState] = useState<EntryDraft>({});
  const [workLineDraft, setWorkLineDraftState] = useState<WorkLineDraft>({});
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const entryDraftRef = useRef(entryDraft);
  entryDraftRef.current = entryDraft;
  const workLineDraftRef = useRef(workLineDraft);
  workLineDraftRef.current = workLineDraft;
  const statusRef = useRef(status);
  statusRef.current = status;

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
      return calcNet(buildCalcInput(entry, entryDraft, workLineDraft));
    } catch {
      return calcNet(buildCalcInput(entry));
    }
  }, [entry, entryDraft, workLineDraft]);

  const clearSavedKeys = useCallback(
    <T extends Record<string, unknown>>(
      setDraft: React.Dispatch<React.SetStateAction<T>>,
      ref: React.MutableRefObject<T>,
      sent: T,
    ) => {
      setDraft((current) => {
        const next = { ...current };
        for (const key of Object.keys(sent)) {
          if (next[key as keyof T] === sent[key as keyof T]) {
            delete next[key as keyof T];
          }
        }
        ref.current = next;
        return next;
      });
    },
    [],
  );

  const commit = useCallback(async () => {
    if (statusRef.current === 'conflict') return;

    const sentEntry = sanitizeEntryDraft(entryDraftRef.current);
    const sentLine = sanitizeWorkLineDraft(workLineDraftRef.current);
    const hasEntryChanges = Object.keys(sentEntry).length > 0;
    const hasLineChanges = Object.keys(sentLine).length > 0;
    if (!hasEntryChanges && !hasLineChanges) return;

    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }

    savingRef.current = true;
    setStatus('saving');
    setErrorMessage(undefined);

    try {
      let version = entry.version;

      if (hasEntryChanges) {
        const result = await updateEntry.mutateAsync({
          id: entry.id,
          input: { version, ...sentEntry },
        });
        version = result.entry.version;
        clearSavedKeys(setEntryDraftState, entryDraftRef, sentEntry);
      }

      if (hasLineChanges) {
        const primaryLineId = entry.workLines[0]!.id;
        // Captured *before* the request goes out — `sentLine.cycleDays` is the parsed number the
        // wire format needs, but the draft (and `clearSavedKeys`'s comparison) tracks the raw
        // string, so this is what "was the draft still exactly what we sent" must compare against.
        // Reading it *after* the await instead would compare the ref to itself and always appear
        // unchanged, even if the user typed something new while the request was in flight.
        const rawCycleDaysAtSendTime = workLineDraftRef.current.cycleDays;
        await updateWorkLine.mutateAsync({
          id: primaryLineId,
          input: { version, ...sentLine },
        });
        const clearKeys: WorkLineDraft = {};
        if (sentLine.days !== undefined) clearKeys.days = sentLine.days;
        if (sentLine.otHours !== undefined) clearKeys.otHours = sentLine.otHours;
        if (sentLine.otRate !== undefined) clearKeys.otRate = sentLine.otRate;
        if (sentLine.cycleDays !== undefined) clearKeys.cycleDays = rawCycleDaysAtSendTime;
        clearSavedKeys(setWorkLineDraftState, workLineDraftRef, clearKeys);
      }

      retryCountRef.current = 0;
      const stillDirty =
        Object.keys(entryDraftRef.current).length > 0 || Object.keys(workLineDraftRef.current).length > 0;
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
  }, [entry.id, entry.version, entry.workLines, clearSavedKeys, updateEntry, updateWorkLine]);

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

  const setWorkLineField = useCallback(
    <K extends keyof WorkLineDraft>(key: K, value: WorkLineDraft[K]) => {
      setWorkLineDraftState((prev) => {
        const next = { ...prev, [key]: value };
        workLineDraftRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
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
    setWorkLineDraftState({});
    entryDraftRef.current = {};
    workLineDraftRef.current = {};
    setStatus('idle');
    setErrorMessage(undefined);
    await reloadPayrollEntry(queryClient, cycleId, entry.id);
  }, [cycleId, entry.id, queryClient]);

  const primaryLine = entry.workLines[0]!;

  // `cycleDays` is exposed two ways: the raw typed text (for the input to bind to, so a
  // transiently-invalid keystroke is never silently reverted) and a guaranteed-valid number
  // (for `effectiveLine`, which feeds the live totals store and anything else expecting a real
  // divisor) — see `buildCalcInput`'s matching fallback for why these must be allowed to diverge
  // while the user is mid-typing.
  const cycleDaysInputValue = workLineDraft.cycleDays ?? String(primaryLine.cycleDays);
  const validDraftCycleDays =
    workLineDraft.cycleDays !== undefined ? parseValidCycleDays(workLineDraft.cycleDays) : undefined;

  const effectiveEntry = useMemo(() => ({ ...entry, ...entryDraft }), [entry, entryDraft]);
  const effectiveLine = useMemo(
    () => ({ ...primaryLine, ...workLineDraft, cycleDays: validDraftCycleDays ?? primaryLine.cycleDays }),
    [primaryLine, workLineDraft, validDraftCycleDays],
  );

  return {
    editable,
    effectiveEntry,
    effectiveLine,
    cycleDaysInputValue,
    calc,
    status,
    errorMessage,
    hasUnsavedChanges: Object.keys(entryDraft).length > 0 || Object.keys(workLineDraft).length > 0,
    setEntryField,
    setWorkLineField,
    retryNow,
    reload,
  };
}
