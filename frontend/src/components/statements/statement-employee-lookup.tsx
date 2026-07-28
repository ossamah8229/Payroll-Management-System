import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStatementEmployeeSearch, type StatementEmployeeCandidate } from '@/hooks/use-statement-employees';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 1;

function candidateDisplayLabel(candidate: Pick<StatementEmployeeCandidate, 'name' | 'employeeCode'>): string {
  return candidate.employeeCode ? `${candidate.name} (${candidate.employeeCode})` : candidate.name;
}

/**
 * Phase 7A Checkpoint 2 correction — the Statements-specific employee picker, over
 * `GET /api/v1/statements/employees` (historical `PayrollEntry.siteId` discovery — see
 * `use-statement-employees.ts`'s own doc comment). **Deliberately a separate component from
 * `EmployeeLookup`**, not a generic-flag extension of it: `EmployeeLookup` backs two real,
 * forward-looking callers (Advances' Record Advance, Corrections' Request Correction) whose
 * current-site-scoped correctness this checkpoint's own architecture review explicitly said must
 * not be weakened or risked by a shared conditional branch. The UI shape below intentionally
 * mirrors `EmployeeLookup`'s own interaction pattern (debounced search-as-you-type, keyboard
 * navigation, a "selected" chip once chosen) for a consistent feel — only the data source and
 * result shape differ. If a third historical-discovery consumer appears later, extracting a shared
 * presentational base becomes worth it then; not premature ahead of that need.
 *
 * Unlike `EmployeeLookup`, there is no `activeOnly` option — a departed employee's Statement is
 * exactly as legitimate a thing to view as an active one, so this picker never excludes them.
 */
export function StatementEmployeeLookup({
  id,
  value,
  selectedCandidate,
  onChange,
  siteId,
  unitId,
  placeholder = 'Search by code, CNIC, or name…',
  disabled,
}: {
  id: string;
  value: string;
  /** The already-selected candidate's own display fields, so the collapsed "selected" chip never
   * needs a second lookup-by-id round trip purely to re-render what the caller already has. */
  selectedCandidate: StatementEmployeeCandidate | undefined;
  onChange: (employeeId: string, candidate: StatementEmployeeCandidate | undefined) => void;
  /** Optional narrowing filter — historical `PayrollEntry.siteId`, never the candidate's current
   * site (`use-statement-employees.ts`). */
  siteId?: string;
  /** Optional narrowing filter — historical `PayrollEntryWorkLine.unitId`. */
  unitId?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useStatementEmployeeSearch(
    { search: debouncedQuery.trim(), siteId, unitId, pageSize: 25 },
    !value && debouncedQuery.trim().length >= MIN_SEARCH_LENGTH,
  );

  const matches = value ? [] : (results.data?.employees ?? []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectCandidate(candidate: StatementEmployeeCandidate) {
    onChange(candidate.employeeId, candidate);
    setQuery('');
    setDebouncedQuery('');
    setIsOpen(false);
  }

  function clearSelection() {
    onChange('', undefined);
    setQuery('');
    setDebouncedQuery('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      setIsOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const match = matches[highlightedIndex];
      if (match) selectCandidate(match);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      {value && selectedCandidate ? (
        <div className="flex h-9 items-center justify-between rounded border border-border bg-surface-2 px-2.5 text-xs text-text">
          <span className="truncate font-medium">{candidateDisplayLabel(selectedCandidate)}</span>
          {!disabled && (
            <button
              type="button"
              onClick={clearSelection}
              className="ml-2 rounded p-0.5 text-text-muted transition-colors hover:bg-bg hover:text-text"
              aria-label="Clear selected employee"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" aria-hidden />
          <input
            id={id}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={`${id}-listbox`}
            aria-autocomplete="list"
            autoComplete="off"
            className={cn(
              'flex h-9 w-full rounded border border-border bg-surface-2 py-1.5 pl-8 pr-2.5 text-xs text-text outline-none placeholder:text-text-faint transition-colors',
              'focus:border-accent-mid focus:ring-2 focus:ring-accent-light',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
          />
        </div>
      )}

      {isOpen && !value && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="absolute top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded border border-border bg-surface-2 shadow-md"
        >
          {debouncedQuery.trim().length < MIN_SEARCH_LENGTH && (
            <p className="px-3 py-2.5 text-xs text-text-muted">Start typing to search employees…</p>
          )}
          {debouncedQuery.trim().length >= MIN_SEARCH_LENGTH && results.isLoading && (
            <p className="px-3 py-2.5 text-xs text-text-muted">Searching…</p>
          )}
          {debouncedQuery.trim().length >= MIN_SEARCH_LENGTH && !results.isLoading && matches.length === 0 && (
            <p className="px-3 py-2.5 text-xs text-text-muted">
              No employees with visible payroll history match &quot;{debouncedQuery.trim()}&quot;.
            </p>
          )}
          {matches.map((candidate, index) => (
            <button
              key={candidate.employeeId}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectCandidate(candidate)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition-colors',
                index === highlightedIndex ? 'bg-accent-light' : 'hover:bg-bg',
              )}
            >
              <span className="font-medium text-text">{candidateDisplayLabel(candidate)}</span>
              <span className="text-[10.5px] text-text-muted">Currently at {candidate.currentSiteName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
