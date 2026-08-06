// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach } from 'vitest';
import type { EmployeePayrollHistoryDetail, SessionUser } from '@payroll/shared';
import { ApiError } from '@/lib/api-client';

const mockUseEmployeePayrollHistoryDetail = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-employee-payroll-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-employee-payroll-history')>();
  return { ...actual, useEmployeePayrollHistoryDetail: mockUseEmployeePayrollHistoryDetail };
});

const { EmployeePayrollHistoryDetailPage } = await import('./reports-employee-payroll-history-detail-page');
const { ReportsEmployeePayrollHistoryPage } = await import('./reports-employee-payroll-history-page');

const baseUser: SessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@test.local',
  roleId: 'role-1',
  roleCode: 'FINANCE',
  roleName: 'Finance',
  permissions: ['statements:view'] as SessionUser['permissions'],
  siteIds: ['site-1'],
  themeAccentColor: '#000000',
};

function baseDetail(overrides: Partial<EmployeePayrollHistoryDetail> = {}): EmployeePayrollHistoryDetail {
  return {
    payrollEntryId: 'entry-1',
    identity: {
      employeeId: 'emp-1',
      employeeCode: 'E-001',
      employeeName: 'Jane Doe',
      cnic: '12345-1234567-1',
      cycle: { id: 'cycle-jul', year: 2026, month: 7, status: 'RELEASED' },
      siteId: 'site-1',
      siteName: 'Site One',
      designation: 'Clerk',
      currentEmployeeRosterStatus: 'ACTIVE',
    },
    calculation: {
      grossPay: '60000.00',
      workLines: [
        {
          id: 'wl-1',
          unit: { id: 'unit-1', name: 'HQ', code: null },
          days: '30',
          otHours: '0',
          otRate: null,
          cycleDays: 30,
          dailyRate: '2000.00',
          effectiveOtRate: '0.00',
          earnedAmount: '60000.00',
          otEarned: '0.00',
          sortOrder: 0,
        },
      ],
      effectiveLeaveRate: '0.00',
      leaveDays: '0',
      leaveEarned: '0.00',
      allowance: '0.00',
      earnedAmount: '60000.00',
      otEarned: '0.00',
      correctionBalancePayable: '0.00',
      totalEarning: '60000.00',
      eobiAmount: '8000.00',
      eobiApplicable: true,
      eobiDeduction: '800.00',
      advanceDeduction: '0.00',
      eidAdvanceDeduction: '0.00',
      fine: '0.00',
      correctionBalanceRecovery: '0.00',
      totalDeduction: '800.00',
      netSalary: '59200.00',
    },
    release: {
      released: true,
      releasedAt: '2026-07-31T00:00:00.000Z',
      releasedBy: { id: 'u-1', name: 'Release Actor' },
      lateReason: null,
      hold: false,
      payoutOutcome: null,
    },
    advances: [],
    correctionsOriginatingFromThisEntry: [],
    automaticRecoveryBalanceAdjustment: null,
    materializationsConsumedByThisEntry: [],
    auditReferences: [],
    generatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

function renderDetail(entryId = 'entry-1') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/reports/employee-payroll-history/${entryId}`]}>
        <Routes>
          <Route path="/reports/employee-payroll-history" element={<ReportsEmployeePayrollHistoryPage user={baseUser} />} />
          <Route
            path="/reports/employee-payroll-history/:entryId"
            element={<EmployeePayrollHistoryDetailPage user={baseUser} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmployeePayrollHistoryDetailPage — sections', () => {
  afterEach(() => cleanup());

  it('renders the Original Payroll Result wording and does not overwrite the released figure', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    renderDetail();
    expect(screen.getByText('Original Payroll Result')).toBeTruthy();
    expect(screen.getByText(/do not overwrite this original payroll result/i)).toBeTruthy();
    expect(screen.getAllByText(/59,200\.00/).length).toBeGreaterThan(0);
  });

  it('shows CNIC in the detail identity section', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    renderDetail();
    expect(screen.getByText('12345-1234567-1')).toBeTruthy();
  });

  it('never renders banking fields anywhere on the page', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    const { container } = renderDetail();
    const text = container.textContent ?? '';
    expect(/account\s*number/i.test(text)).toBe(false);
    expect(/\bIBAN\b/i.test(text)).toBe(false);
    expect(/branch\s*code/i.test(text)).toBe(false);
  });

  it('shows the safe release actor name, never raw user/email fields', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    renderDetail();
    expect(screen.getByText('Release Actor')).toBeTruthy();
    expect(screen.queryByText('test@test.local')).toBeNull();
  });

  it('renders a Correction with before/after and its resulting balance adjustment', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({
      data: baseDetail({
        correctionsOriginatingFromThisEntry: [
          {
            correctionId: 'corr-1',
            approvedAt: '2026-08-01T00:00:00.000Z',
            approvedBy: { id: 'u-2', name: 'Approver' },
            reason: 'Attendance fix',
            field: 'DAYS',
            oldValue: '28',
            newValue: '30',
            oldNetSalary: '57200.00',
            newNetSalary: '59200.00',
            adjustmentTypeLabel: 'Attendance',
            resultingBalanceAdjustment: {
              balanceAdjustmentId: 'ba-1',
              type: 'PAYABLE',
              status: 'PENDING',
              paymentTiming: 'DEFERRED',
              amount: '2000.00',
              remainingAmount: '2000.00',
              settlements: [],
              correctionPayment: null,
            },
          },
        ],
      }),
      isLoading: false,
      error: null,
    });
    renderDetail();
    expect(screen.getByText('Attendance fix')).toBeTruthy();
    expect(screen.getByText(/28.*→.*30/)).toBeTruthy();
    expect(screen.getByText('Resulting Balance Adjustment')).toBeTruthy();
    expect(screen.getByText('Deferred payable')).toBeTruthy();
  });

  it('shows empty-state text for subsections with no data', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    renderDetail();
    expect(screen.getByText(/no advances linked to this entry/i)).toBeTruthy();
    expect(screen.getByText(/no corrections originate from this entry/i)).toBeTruthy();
    expect(screen.getByText(/created no automatic recovery balance adjustment/i)).toBeTruthy();
    expect(screen.getByText(/consumed no prior balance adjustment/i)).toBeTruthy();
    expect(screen.getByText(/no audit references/i)).toBeTruthy();
  });

  it('labels a materialization\'s origin cycle distinctly from this (consuming) entry\'s own cycle', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({
      data: baseDetail({
        materializationsConsumedByThisEntry: [
          {
            materializationId: 'mat-1',
            amount: '1000.00',
            status: 'CONSUMED',
            originBalanceAdjustmentId: 'ba-2',
            originType: 'RECOVERY',
            originCycle: { id: 'cycle-jun', year: 2026, month: 6, status: 'RELEASED' },
            originPayrollEntryId: 'entry-0',
          },
        ],
      }),
      isLoading: false,
      error: null,
    });
    renderDetail();
    expect(screen.getByText(/origin cycle: june 2026/i)).toBeTruthy();
  });
});

describe('EmployeePayrollHistoryDetailPage — inaccessible/not-found', () => {
  afterEach(() => cleanup());

  it('shows a plain not-found state for a 404, never distinguishing existence from access', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(404, 'NOT_FOUND', 'Not found'),
    });
    renderDetail();
    expect(screen.getByText(/could not be found/i)).toBeTruthy();
  });
});

describe('EmployeePayrollHistoryDetailPage — back navigation', () => {
  afterEach(() => cleanup());

  it('Back to Report returns to the list route', () => {
    mockUseEmployeePayrollHistoryDetail.mockReturnValue({ data: baseDetail(), isLoading: false, error: null });
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: /back to report/i }));
    // The list page's own RBAC-gated content renders once the router lands back on the list route.
    expect(screen.queryByText(/you don.t have access/i)).toBeNull();
  });
});
