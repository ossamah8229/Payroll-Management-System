// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReportPagination } from './report-pagination';

function renderPagination(props: Partial<Parameters<typeof ReportPagination>[0]> & { total: number }) {
  return render(<ReportPagination page={1} pageSize={25} onPageChange={() => {}} {...props} />);
}

describe('ReportPagination — row-count label', () => {
  afterEach(() => cleanup());

  it('defaults to "site"/"sites" for callers passing no label (unchanged behavior)', () => {
    renderPagination({ total: 1 });
    expect(screen.getByText('Showing 1–1 of 1 site')).toBeTruthy();
    cleanup();
    renderPagination({ total: 3 });
    expect(screen.getByText('Showing 1–3 of 3 sites')).toBeTruthy();
    cleanup();
    renderPagination({ total: 0 });
    expect(screen.getByText('No sites')).toBeTruthy();
  });

  it('derives the singular by stripping the trailing "s" when only itemLabelPlural is given (unchanged behavior)', () => {
    renderPagination({ total: 1, itemLabelPlural: 'advances' });
    expect(screen.getByText('Showing 1–1 of 1 advance')).toBeTruthy();
    cleanup();
    renderPagination({ total: 2, itemLabelPlural: 'advances' });
    expect(screen.getByText('Showing 1–2 of 2 advances')).toBeTruthy();
  });

  it('uses an explicit itemLabelSingular for a single row', () => {
    renderPagination({ total: 1, itemLabelSingular: 'entry', itemLabelPlural: 'entries' });
    expect(screen.getByText('Showing 1–1 of 1 entry')).toBeTruthy();
    expect(screen.queryByText(/entrie\b/)).toBeNull();
  });

  it('uses itemLabelPlural (never the explicit singular) for zero or multiple rows', () => {
    renderPagination({ total: 30, itemLabelSingular: 'entry', itemLabelPlural: 'entries' });
    expect(screen.getByText('Showing 1–25 of 30 entries')).toBeTruthy();
    cleanup();
    renderPagination({ total: 0, itemLabelSingular: 'entry', itemLabelPlural: 'entries' });
    expect(screen.getByText('No entries')).toBeTruthy();
  });
});
