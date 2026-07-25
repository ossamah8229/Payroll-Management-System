import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useEmployee, useEmployees, type Employee } from '@/hooks/use-employees';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 1;

function employeeDisplayLabel(employee: Pick<Employee, 'name' | 'employeeCode'>): string {
  return employee.employeeCode ? `${employee.name} (${employee.employeeCode})` : employee.name;
}

/**
 * The one reusable, searchable Employee Lookup (Corrections/RBAC completion checkpoint) —
 * replaces the plain, unsearchable native `<select>` every "pick one employee" surface in this
 * app previously used (Advances' Record Advance modal, Corrections' Request Correction modal),
 * neither of which stays usable once headcount reaches this codebase's own stated design floor
 * (~10,000 employees, `corrections.materialization.service.ts`'s "Principle 10" references).
 *
 * Search covers Employee Code, CNIC, Account Number, IBAN, Name, Site, and Branch/Unit in one
 * query (`GET /api/v1/employees?search=...`, `employees.service.ts`'s `listEmployees`) — the same
 * backend search every consumer of this component shares, so results are never a second,
 * independently-filtered copy. The backend remains the sole scope authority (site-scoped results
 * only, per the caller's own session) exactly as it already is for every other Employee Registry
 * consumer — this component adds no authorization decision of its own.
 *
 * Deliberately not a full ARIA 1.2 combobox implementation (no `aria-activedescendant` roving
 * focus) — a simpler, keyboard-operable listbox-on-input pattern consistent with this codebase's
 * existing `<select>`-based forms, accepting a slightly lighter accessibility contract in exchange
 * for not introducing this app's first real combobox dependency for a single-field lookup.
 */
export function EmployeeLookup({
  id,
  value,
  onChange,
  activeOnly = true,
  siteIds,
  restrictToEmployeeIds,
  restrictedEmptyMessage = "found, but none are currently eligible here",
  placeholder = 'Search by code, CNIC, account, IBAN, name, site, or branch…',
  disabled,
  required,
}: {
  id: string;
  value: string;
  onChange: (employeeId: string, employee: Employee | undefined) => void;
  activeOnly?: boolean;
  siteIds?: string[];
  /** Narrows results to this specific candidate set (e.g. Corrections' Request Correction modal:
   * only employees with a released Payroll Entry in the current cycle are legitimate targets) —
   * still searches the same real backend (so search priority/behavior never diverges from any
   * other consumer of this component), just filters the response client-side afterward. Omit
   * entirely for an org-wide lookup (Advances' Record Advance modal). */
  restrictToEmployeeIds?: string[];
  /** Shown instead of the plain "No employees match" message when the backend search actually
   * found real employee(s) matching the query, but `restrictToEmployeeIds` excluded all of them
   * (Presentation & Workflow Stabilization Checkpoint, 2026-07-25, Issue 7) — without this
   * distinction, a genuinely-existing employee excluded only by this caller's own eligibility
   * rule is indistinguishable from a typo/no-such-employee, which reads as a broken search rather
   * than an explainable restriction. Fragment of a sentence starting with "Matches were " — e.g.
   * the default renders "Matches were found, but none are currently eligible here." */
  restrictedEmptyMessage?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const restrictToSet = restrictToEmployeeIds ? new Set(restrictToEmployeeIds) : undefined;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Only searches the full/org-wide list while there is no selection yet — once `value` is set,
  // fetching the *unfiltered* list in the background would be exactly the scale problem this
  // component exists to avoid. The already-selected employee is instead fetched individually,
  // below, a single cheap by-id lookup regardless of total headcount.
  const results = useEmployees({
    search: debouncedQuery.trim().length >= MIN_SEARCH_LENGTH ? debouncedQuery.trim() : undefined,
    activeOnly,
    siteIds,
    enabled: !value && debouncedQuery.trim().length >= MIN_SEARCH_LENGTH,
  });
  const selected = useEmployee(value || undefined);

  // Cheap client-side cap — the backend already returns every site-scoped match for the search
  // term, but a 300-item dropdown is its own usability problem regardless of how it got there.
  const rawMatches = value ? [] : (results.data ?? []);
  const matches = rawMatches.filter((employee) => !restrictToSet || restrictToSet.has(employee.id)).slice(0, 25);
  // Distinguishes "the backend genuinely found nothing" from "the backend found real employees,
  // but this caller's own eligibility restriction excluded every one of them" (Issue 7) — the
  // empty-state message below reads very differently depending on which one actually happened.
  const excludedByRestriction = restrictToSet !== undefined && matches.length === 0 && rawMatches.length > 0;

  const selectedEmployee = selected.data;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectEmployee(employee: Employee) {
    onChange(employee.id, employee);
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
      if (match) selectEmployee(match);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      {value && selectedEmployee ? (
        <div className="flex h-9 items-center justify-between rounded border border-border bg-surface-2 px-2.5 text-xs text-text">
          <span className="truncate font-medium">{employeeDisplayLabel(selectedEmployee)}</span>
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
            required={required && !value}
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
              {excludedByRestriction
                ? `Matches were ${restrictedEmptyMessage}.`
                : `No employees match "${debouncedQuery.trim()}".`}
            </p>
          )}
          {matches.map((employee, index) => (
            <button
              key={employee.id}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectEmployee(employee)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition-colors',
                index === highlightedIndex ? 'bg-accent-light' : 'hover:bg-bg',
              )}
            >
              <span className="font-medium text-text">{employeeDisplayLabel(employee)}</span>
              <span className="text-[10.5px] text-text-muted">
                {employee.site.name} · {employee.unit.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
