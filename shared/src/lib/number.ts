/**
 * The single en-US number/currency formatting utility (docs/design-system.md §4) —
 * international grouping (100,000), never lakh-style, currency values prefixed PKR. One
 * implementation, used identically everywhere a monetary or plain numeric figure is displayed,
 * matching the `formatDate`/`normalizeCnic`/`pluralize`/`calcNet` precedent of living in `shared/`
 * rather than being redefined per page.
 */

const moneyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plainFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/** Formats a monetary decimal-string/number as e.g. `PKR 12,345.67`. Returns `—` for null/empty/
 * non-numeric input rather than throwing — every grid/total display treats "nothing entered yet"
 * as a dash, never `PKR NaN`. */
export function formatMoney(value: string | number | null | undefined): string {
  const n = toFiniteNumber(value);
  return n === null ? '—' : `PKR ${moneyFormatter.format(n)}`;
}

/** Formats a plain (non-currency) decimal-string/number, e.g. working days or OT hours. */
export function formatNumber(value: string | number | null | undefined): string {
  const n = toFiniteNumber(value);
  return n === null ? '—' : plainFormatter.format(n);
}
