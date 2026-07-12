/**
 * The one HTML-escaping utility every PDF template in this codebase must use for every
 * interpolated value — no exceptions, per this checkpoint's own architecture review. Employee
 * names, father names, remarks, designation, site/unit names, and every other string that ends
 * up in a Puppeteer-rendered template are free text with no character restriction anywhere
 * upstream (`shared/src/schemas/employee.ts`/`payroll-entry.ts` impose length limits only) — an
 * unescaped value here is a genuine HTML-injection surface into a real browser rendering engine,
 * not a theoretical one.
 *
 * Deliberately hand-written rather than pulled in from a templating library: five characters,
 * order-independent replacement, nothing else a payroll document template needs.
 */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
