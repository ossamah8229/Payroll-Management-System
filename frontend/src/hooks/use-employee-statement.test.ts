import { describe, expect, it } from 'vitest';
import { employeeStatementUrl } from './use-employee-statement';

describe('employeeStatementUrl', () => {
  it('requests the plain employee endpoint when no range is given', () => {
    expect(employeeStatementUrl('emp-1', {})).toBe('/api/v1/employees/emp-1/statement');
  });

  it('includes both fromCycleId and toCycleId when a custom range is given', () => {
    expect(employeeStatementUrl('emp-1', { fromCycleId: 'cycle-a', toCycleId: 'cycle-b' })).toBe(
      '/api/v1/employees/emp-1/statement?fromCycleId=cycle-a&toCycleId=cycle-b',
    );
  });
});
