import { describe, expect, it } from 'vitest';
import { statementEmployeesUrl } from './use-statement-employees';

describe('statementEmployeesUrl', () => {
  it('requests the plain endpoint with no params', () => {
    expect(statementEmployeesUrl({})).toBe('/api/v1/statements/employees');
  });

  it('includes a trimmed search term', () => {
    expect(statementEmployeesUrl({ search: '  Jane  ' })).toBe('/api/v1/statements/employees?search=Jane');
  });

  it('includes siteId and unitId as optional narrowing filters', () => {
    expect(statementEmployeesUrl({ siteId: 'site-1', unitId: 'unit-1' })).toBe(
      '/api/v1/statements/employees?siteId=site-1&unitId=unit-1',
    );
  });

  it('includes page/pageSize when given', () => {
    expect(statementEmployeesUrl({ page: 2, pageSize: 25 })).toBe('/api/v1/statements/employees?page=2&pageSize=25');
  });
});
