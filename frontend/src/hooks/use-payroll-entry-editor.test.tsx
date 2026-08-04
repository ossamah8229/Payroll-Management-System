// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PayrollEntry, PayrollEntryWorkLine } from '@/hooks/use-payroll-entries';
import { usePayrollEntryEditor } from './use-payroll-entry-editor';

/**
 * Phase 7E durability checkpoint (A7) — direct tests for the autosave state machine itself
 * (`use-payroll-entry-editor.ts`). Before this checkpoint this hook had zero direct test coverage
 * — every existing Payroll Entry test exercised sorting/columns/import-removal, never debounce
 * timing, retry/backoff, timeout, or conflict handling. `global.fetch` is mocked directly (not
 * MSW — this codebase has no MSW dependency) so every scenario below is deterministic; fake timers
 * make the 600ms debounce and retry backoff assertable without real waiting.
 */

let uidCounter = 0;
function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

function makeWorkLine(overrides: Partial<PayrollEntryWorkLine> & { id: string }): PayrollEntryWorkLine {
  return {
    payrollEntryId: 'entry',
    siteId: 'site-1',
    unitId: 'unit-1',
    unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: 'BR-01', isActive: true, createdAt: '', updatedAt: '' },
    days: '26',
    otHours: '0',
    otRate: null,
    cycleDays: 30,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PayrollEntry> & { id: string }): PayrollEntry {
  const id = overrides.id;
  return {
    cycleId: 'cycle-1',
    employeeId: `employee-${id}`,
    employee: {
      id: `employee-${id}`,
      employeeCode: null,
      cnic: null,
      name: 'Employee',
      fatherName: null,
      religion: null,
      dateOfBirth: null,
      mobileNumber: null,
      designation: 'Guard',
      siteId: 'site-1',
      site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
      unitId: 'unit-1',
      unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: 'BR-01', isActive: true, createdAt: '', updatedAt: '' },
      dateOfJoining: null,
      dateOfLeaving: null,
      payType: 'DAILY_WAGE',
      grossPay: '30000',
      bankId: null,
      bank: null,
      branchCode: null,
      accountNumber: null,
      iban: null,
      defaultEobiAmount: '400',
      defaultEobiApplicable: true,
      createdAt: '',
      updatedAt: '',
    },
    siteId: 'site-1',
    site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
    designation: 'Guard',
    bankId: null,
    branchCode: null,
    accountNumber: null,
    iban: null,
    grossPay: '30000',
    allowance: '0',
    leaveDays: '0',
    leaveRate: null,
    eobiAmount: '400',
    eobiApplicable: true,
    advanceDeduction: '0',
    advanceId: null,
    advance: null,
    eidAdvanceDeduction: '0',
    eidAdvanceId: null,
    eidAdvance: null,
    fine: '0',
    hold: false,
    released: false,
    payoutOutcome: null,
    releaseBlockReasons: [],
    releasedAt: null,
    releasedBy: null,
    lateReason: null,
    remarks: null,
    sortOrder: 0,
    version: 1,
    createdAt: '',
    updatedAt: '',
    workLines: [makeWorkLine({ id: `line-${id}` })],
    calc: {
      workLines: [{ sortOrder: 0, dailyRate: '1000', effectiveOtRate: '0', earnedAmount: '26000', otEarned: '0' }],
      effectiveLeaveRate: '0',
      earnedAmount: '26000',
      otEarned: '0',
      leaveEarned: '0',
      correctionBalancePayable: '0',
      totalEarning: '26000',
      eobiDeduction: '400',
      correctionBalanceRecovery: '0',
      totalDeduction: '400',
      netSalary: '25600',
    },
    ...overrides,
  };
}

type MutationEntryResponse = Omit<PayrollEntry, 'employee' | 'site'>;

function mutationResponse(entry: PayrollEntry, overrides: Partial<MutationEntryResponse> = {}): MutationEntryResponse {
  const rest: Partial<PayrollEntry> = { ...entry };
  delete rest.employee;
  delete rest.site;
  return { ...(rest as MutationEntryResponse), ...overrides };
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function hangingUntilAborted() {
  return (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePayrollEntryEditor — debounce coalescing (item 1)', () => {
  it('coalesces rapid edits to multiple fields within the 600ms window into a single PATCH', async () => {
    const entry = makeEntry({ id: uid('entry') });
    const cycleId = uid('cycle');
    fetchMock.mockResolvedValue(jsonResponse(200, { entry: mutationResponse(entry, { version: 2 }) }));

    const { result } = renderHook(() => usePayrollEntryEditor(entry, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      result.current.setEntryField('leaveDays', '2');
    });
    act(() => {
      result.current.setEntryField('allowance', '500');
    });

    // Nothing sent yet — still inside the debounce window.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('dirty');

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.leaveDays).toBe('2');
    expect(body.allowance).toBe('500');
  });
});

describe('usePayrollEntryEditor — failure, retry, and exhaustion (items 5, 6, 7)', () => {
  it('retains the local draft and marks the row failed when a save fails (item 5)', async () => {
    const entry = makeEntry({ id: uid('entry') });
    const cycleId = uid('cycle');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => usePayrollEntryEditor(entry, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      result.current.setEntryField('allowance', '500');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.effectiveEntry.allowance).toBe('500');
  });

  it('clears the unsaved state once a manual retry succeeds (item 6)', async () => {
    const entry = makeEntry({ id: uid('entry') });
    const cycleId = uid('cycle');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { entry: mutationResponse(entry, { version: 2, allowance: '500' }) }));

    const { result } = renderHook(() => usePayrollEntryEditor(entry, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      result.current.setEntryField('allowance', '500');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.status).toBe('error');

    await act(async () => {
      result.current.retryNow();
      // Bounded — deliberately stops short of the 1500ms "saved" indicator fade, so this
      // assertion observes the immediate post-save state, not whatever it fades to afterward.
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('saved');
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops auto-retrying after the retry budget is exhausted, but stays visibly failed (item 7)', async () => {
    const entry = makeEntry({ id: uid('entry') });
    const cycleId = uid('cycle');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => usePayrollEntryEditor(entry, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      result.current.setEntryField('allowance', '500');
    });

    // Initial send (t=600) + 3 auto-retries at 1s/2s/4s backoff — every one of these rejects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600); // initial attempt
      await vi.advanceTimersByTimeAsync(1000); // retry 1
      await vi.advanceTimersByTimeAsync(2000); // retry 2
      await vi.advanceTimersByTimeAsync(4000); // retry 3
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe('error');
    expect(result.current.hasUnsavedChanges).toBe(true);

    // Budget exhausted — advancing well past any further backoff must not fire a 5th attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe('error');
  });
});

describe('usePayrollEntryEditor — hung requests and timeout (item 8)', () => {
  it('turns a hung request into a visible, retryable error once the bounded timeout elapses — never "saved"', async () => {
    const entry = makeEntry({ id: uid('entry') });
    const cycleId = uid('cycle');
    fetchMock.mockImplementationOnce(hangingUntilAborted());

    const { result } = renderHook(() => usePayrollEntryEditor(entry, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      result.current.setEntryField('allowance', '500');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600); // fires the request
    });
    expect(result.current.status).toBe('saving');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100); // past the 15s mutation timeout
    });

    expect(result.current.status).toBe('error');
    expect(result.current.status).not.toBe('saved');
    expect(result.current.hasUnsavedChanges).toBe(true);
  });
});

describe('usePayrollEntryEditor — 409 conflict (item 9)', () => {
  it('enters conflict state on a 409 and does not auto-retry', async () => {
    const entry = makeEntry({ id: uid('entry') });
    const cycleId = uid('cycle');
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: 'CONFLICT', message: 'This payroll entry was changed by someone else' } }),
    );

    const { result } = renderHook(() => usePayrollEntryEditor(entry, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      result.current.setEntryField('allowance', '500');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.status).toBe('conflict');
    expect(result.current.hasUnsavedChanges).toBe(true);

    // A conflict is fail-safe, not auto-retried — advancing time must never fire a second attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('conflict');
  });
});

describe('usePayrollEntryEditor — multiple rows save independently (item 10)', () => {
  it('one row failing has no effect on another row saving concurrently', async () => {
    const entryA = makeEntry({ id: uid('entry') });
    const entryB = makeEntry({ id: uid('entry') });
    const cycleId = uid('cycle');

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(entryA.id)) return Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } }));
      return Promise.resolve(jsonResponse(200, { entry: mutationResponse(entryB, { version: 2, allowance: '500' }) }));
    });

    const { result: resultA } = renderHook(() => usePayrollEntryEditor(entryA, cycleId, 'DRAFT'), { wrapper });
    const { result: resultB } = renderHook(() => usePayrollEntryEditor(entryB, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      resultA.current.setEntryField('allowance', '750');
      resultB.current.setEntryField('allowance', '500');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
      // Extra zero-length advances only flush additional microtask rounds (two independent hook
      // instances' own promise chains settling in the same tick) — never crosses the 1s auto-retry
      // threshold, so entryA's own scheduled retry must not fire here.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(resultA.current.status).toBe('error');
    expect(resultB.current.status).toBe('saved');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('usePayrollEntryEditor — entry + multiple work lines recover after partial failure (item 11)', () => {
  it('resends only the still-dirty work line on retry, never re-sending already-saved fields', async () => {
    const lineA = makeWorkLine({ id: uid('line'), unitId: 'unit-1' });
    const lineB = makeWorkLine({ id: uid('line'), unitId: 'unit-2', unit: { id: 'unit-2', siteId: 'site-1', name: 'Second Branch', code: 'BR-02', isActive: true, createdAt: '', updatedAt: '' } });
    const entry = makeEntry({ id: uid('entry'), workLines: [lineA, lineB] });
    const cycleId = uid('cycle');

    let call = 0;
    fetchMock.mockImplementation((url: string) => {
      call += 1;
      if (url.includes('/payroll-entries/')) {
        return Promise.resolve(jsonResponse(200, { entry: mutationResponse(entry, { version: 2, allowance: '500' }) }));
      }
      if (url.includes(lineA.id)) {
        return Promise.resolve(jsonResponse(200, { entry: mutationResponse(entry, { version: 3 }) }));
      }
      // lineB — fails on the first attempt (call order: entry, lineA, lineB), succeeds after.
      if (call <= 3) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve(jsonResponse(200, { entry: mutationResponse(entry, { version: 4 }) }));
    });

    const { result } = renderHook(() => usePayrollEntryEditor(entry, cycleId, 'DRAFT'), { wrapper });

    act(() => {
      result.current.setEntryField('allowance', '500');
      result.current.setLineField(lineA.id, 'days', '20');
      result.current.setLineField(lineB.id, 'otHours', '5');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Entry + lineA succeeded; lineB's PATCH failed — only lineB should still be dirty.
    expect(result.current.status).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const dirtyLineB = result.current.effectiveLines.find((l) => l.id === lineB.id)!;
    expect(dirtyLineB.otHours).toBe('5');

    await act(async () => {
      result.current.retryNow();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Retry must only resend lineB, never re-send the entry field or lineA again.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const lastCallUrl = String(fetchMock.mock.calls[3]![0]);
    expect(lastCallUrl).toContain(lineB.id);
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(result.current.status).toBe('saved');
  });
});
