// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Employee } from '@/hooks/use-employees';

/**
 * Presentation & Workflow Stabilization Checkpoint (2026-07-25), Issue 7 — "Request Correction
 * employee lookup" root-cause coverage.
 *
 * Investigation found this was never a stale-cache, wrong-endpoint, or wrong-site-scope bug: the
 * backend search (mocked here via `useEmployees`) genuinely finds a real, existing employee like
 * Adil Masih; `EmployeeLookup`'s own `restrictToEmployeeIds` (Request Correction's deliberate
 * "only employees with a released Payroll Entry this cycle" rule — the correct, canonical
 * eligibility source, reusing the same Payroll Entry data the grid itself renders) then excludes
 * him because his entry in this cycle isn't released yet. The actual defect was that this
 * legitimate exclusion was indistinguishable from "no such employee" in the UI. These tests prove
 * the two cases now render different messages.
 */

const adil: Employee = {
  id: 'emp-adil',
  employeeCode: 'V042',
  cnic: null,
  name: 'Adil Masih',
  fatherName: null,
  religion: null,
  dateOfBirth: null,
  mobileNumber: null,
  designation: 'Guard',
  siteId: 'site-1',
  site: { id: 'site-1', name: 'Test Site', address: null, unitLabel: 'Branch', isActive: true, createdAt: '', updatedAt: '' },
  unitId: 'unit-1',
  unit: { id: 'unit-1', siteId: 'site-1', name: 'Main Branch', code: null, isActive: true, createdAt: '', updatedAt: '' },
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
};

let mockedEmployees: Employee[] = [];

vi.mock('@/hooks/use-employees', () => ({
  useEmployees: () => ({ data: mockedEmployees, isLoading: false, error: undefined }),
  useEmployee: () => ({ data: undefined, isLoading: false, error: undefined }),
}));

const { EmployeeLookup } = await import('./employee-lookup');

async function typeQuery(text: string) {
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.focus(input);
  // The component debounces the query 300ms before firing `useEmployees` — real timers are used
  // (no `vi.useFakeTimers()`) since `useEmployees` is mocked to a static value regardless of the
  // debounced query string, so waiting out the real debounce is simpler than faking it.
  await new Promise((resolve) => setTimeout(resolve, 350));
}

describe('EmployeeLookup — restricted-set empty state (Issue 7)', () => {
  afterEach(() => {
    cleanup();
    mockedEmployees = [];
  });

  it('shows the plain "no employees match" message when the backend genuinely finds nothing', async () => {
    mockedEmployees = [];
    render(<EmployeeLookup id="lookup" value="" onChange={vi.fn()} />);
    await typeQuery('zzz-nonexistent');
    expect(screen.getByText('No employees match "zzz-nonexistent".')).toBeTruthy();
  });

  it('shows the plain "no employees match" message when nothing is restricted (org-wide lookup)', async () => {
    mockedEmployees = [];
    render(<EmployeeLookup id="lookup" value="" onChange={vi.fn()} />);
    await typeQuery('adil');
    expect(screen.getByText('No employees match "adil".')).toBeTruthy();
  });

  it('shows the restricted-exclusion message — not "no employees match" — when the backend finds a real employee excluded by restrictToEmployeeIds', async () => {
    mockedEmployees = [adil];
    render(
      <EmployeeLookup
        id="lookup"
        value=""
        onChange={vi.fn()}
        restrictToEmployeeIds={[]} // Adil exists, but has no released entry this cycle
        restrictedEmptyMessage="found, but none have a released Payroll Entry in this cycle yet"
      />,
    );
    await typeQuery('adil');
    expect(screen.queryByText('No employees match "adil".')).toBeNull();
    expect(
      screen.getByText('Matches were found, but none have a released Payroll Entry in this cycle yet.'),
    ).toBeTruthy();
  });

  it('still lists a matching employee normally when restrictToEmployeeIds includes them', async () => {
    mockedEmployees = [adil];
    render(<EmployeeLookup id="lookup" value="" onChange={vi.fn()} restrictToEmployeeIds={[adil.id]} />);
    await typeQuery('adil');
    expect(screen.getByText('Adil Masih (V042)')).toBeTruthy();
  });
});
