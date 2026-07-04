/**
 * The single source of truth for date display/parsing, per `docs/design-system.md` §4: every
 * user-facing date is `DD-MM-YYYY`, everywhere; storage/API stay ISO (`YYYY-MM-DD`) always. No
 * component or backend code should format or parse a date any other way.
 */

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const DISPLAY_DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;

function extractIsoDateParts(value: string | Date): { year: string; month: string; day: string } | null {
  const iso = value instanceof Date ? value.toISOString() : value;
  const match = ISO_DATE_PREFIX.exec(iso);
  if (!match) return null;
  return { year: match[1]!, month: match[2]!, day: match[3]! };
}

/** ISO (`YYYY-MM-DD`, or an ISO datetime string with that prefix) -> `DD-MM-YYYY` for display. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const parts = extractIsoDateParts(value);
  return parts ? `${parts.day}-${parts.month}-${parts.year}` : '';
}

/**
 * Normalizes an ISO date or ISO datetime string (or a `Date`, e.g. `new Date()` for "today") down to
 * a pure `YYYY-MM-DD` date-only string, or `''`. Use this instead of a one-off `.slice(0, 10)` or
 * `.toISOString().slice(0, 10)` anywhere a date-only value is needed for storage/submission.
 */
export function toIsoDateOnly(value: string | Date | null | undefined): string {
  if (!value) return '';
  const parts = extractIsoDateParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

/**
 * ISO `YYYY-MM-DD` (or an ISO datetime string, or a `Date`) -> a `Date` pinned to UTC midnight,
 * or `null`. This is the one sanctioned way to hand a date-only value to the database layer:
 * Prisma's `@db.Date` columns accept a `Date`/full ISO-8601 datetime, never the bare
 * `YYYY-MM-DD` string the API layer validates and transports everywhere else — surfaced by the
 * first live-database verification (2026-07-04), which rejected bare date strings at every
 * `Employee` date write.
 */
export function isoDateToUtcDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parts = extractIsoDateParts(value);
  return parts ? new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`) : null;
}

/**
 * `DD-MM-YYYY` display text -> ISO `YYYY-MM-DD` for storage/API, or `null` if the text isn't a
 * complete, valid calendar date (used by `DateInput` once the user has typed all 8 digits).
 */
export function parseDateInput(displayValue: string): string | null {
  const match = DISPLAY_DATE_PATTERN.exec(displayValue.trim());
  if (!match) return null;
  const day = match[1]!;
  const month = match[2]!;
  const year = match[3]!;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12) return null;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return null;
  return `${year}-${month}-${day}`;
}
