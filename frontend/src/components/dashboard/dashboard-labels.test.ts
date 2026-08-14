import { describe, expect, it } from 'vitest';
import {
  cycleOperationalContext,
  cycleScopedUnavailableReason,
  dashboardDeepLinks,
  releaseProgressSubtext,
  releaseProgressSummaryText,
  unavailableLabel,
} from './dashboard-labels';

const CYCLE = { id: 'cycle-1', year: 2026, month: 8, status: 'DRAFT' as const };

describe('cycleScopedUnavailableReason', () => {
  it('is NO_CYCLE when there is no PayrollCycle at all', () => {
    expect(cycleScopedUnavailableReason(null)).toBe('NO_CYCLE');
  });

  it('is UNAUTHORIZED when a cycle exists but the widget value is still null', () => {
    expect(cycleScopedUnavailableReason(CYCLE)).toBe('UNAUTHORIZED');
  });
});

describe('unavailableLabel', () => {
  it('renders a distinct message for NO_CYCLE vs UNAUTHORIZED — never the same generic text', () => {
    expect(unavailableLabel('NO_CYCLE')).not.toBe(unavailableLabel('UNAUTHORIZED'));
  });
});

describe('cycleOperationalContext', () => {
  it('returns null when releaseProgress is null (no cycle or unauthorized)', () => {
    expect(cycleOperationalContext(null)).toBeNull();
  });

  it('renders plain released/total counts, never a percentage', () => {
    const text = cycleOperationalContext({
      totalCount: 42,
      releasedCount: 39,
      pendingCount: 3,
      heldCount: 0,
      noPayDueCount: 0,
      recoveryDueCount: 0,
      releasedAmount: '1.00',
      pendingAmount: '2.00',
    });
    expect(text).toBe('39 of 42 entries released');
    expect(text).not.toContain('%');
  });
});

describe('releaseProgressSummaryText / releaseProgressSubtext', () => {
  const progress = {
    totalCount: 42,
    releasedCount: 39,
    pendingCount: 3,
    heldCount: 1,
    noPayDueCount: 0,
    recoveryDueCount: 0,
    releasedAmount: '1.00',
    pendingAmount: '2.00',
  };

  it('summary is "released / total released"', () => {
    expect(releaseProgressSummaryText(progress)).toBe('39 / 42 released');
  });

  it('subtext lists only nonzero buckets', () => {
    expect(releaseProgressSubtext(progress)).toBe('3 pending · 1 held');
  });

  it('subtext falls back to "All entries released" when nothing is pending or held', () => {
    expect(releaseProgressSubtext({ ...progress, pendingCount: 0, heldCount: 0, releasedCount: 42 })).toBe(
      'All entries released',
    );
  });

  it('never invents a bank/cash split field not present on the contract', () => {
    const text = releaseProgressSubtext(progress);
    expect(text.toLowerCase()).not.toContain('bank');
    expect(text.toLowerCase()).not.toContain('cash');
  });
});

describe('dashboardDeepLinks', () => {
  it('builds cycle-nested routes when a cycle id is resolved', () => {
    const links = dashboardDeepLinks('cycle-1');
    expect(links.payrollSummary).toBe('/payroll-cycles/cycle-1/reports/payroll-summary');
    expect(links.salaryRelease).toBe('/payroll-cycles/cycle-1/reports/salary-release');
    expect(links.deductionReport).toBe('/payroll-cycles/cycle-1/reports/deduction-report');
  });

  it('falls back to the flat route when no cycle id is resolved', () => {
    const links = dashboardDeepLinks(undefined);
    expect(links.payrollSummary).toBe('/reports/payroll-summary');
    expect(links.salaryRelease).toBe('/reports/salary-release');
    expect(links.deductionReport).toBe('/reports/deduction-report');
  });

  it('never invents a new Dashboard-specific detail route', () => {
    const links = dashboardDeepLinks('cycle-1');
    expect(Object.values(links).every((path) => !path.startsWith('/dashboard'))).toBe(true);
  });

  it('routes Employee Registry, Advance Recovery, and Corrections independent of cycle', () => {
    const links = dashboardDeepLinks(undefined);
    expect(links.employeeRegistry).toBe('/employees');
    expect(links.advanceRecovery).toBe('/reports/advance-recovery');
    expect(links.corrections).toBe('/corrections');
  });
});
