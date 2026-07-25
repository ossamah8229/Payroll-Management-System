# Professional Printing Architecture

**Owner module(s):** Shared UI (`frontend/src/components/print/`, `frontend/src/components/ui/print-button.tsx`)

**Contains:** Why the previous "print the live screen" approach was replaced, the shared print
settings dialog/orientation/fit system, how orientation is applied against a browser that gives no
scriptable control over its native print dialog, Payroll Entry's print acceptance case, which other
pages were migrated, and known limitations.

**Sections:** — (narrative document) · Related: `testing.md`

## The problem (Professional Printing checkpoint, 2026-07-25)

Before this checkpoint, `PrintButton` was `onClick={() => window.print()}` — nothing else. Layout
came entirely from static `@media print` CSS (`index.css`) plus per-page Tailwind `print:hidden`
utilities. That produced, in effect, a screenshot of whatever was currently on screen:

- Fixed `@page { size: A4; }` — no orientation choice, ever.
- No "fit to page" concept — a wide table (Payroll Entry, ~25 columns) either overflowed
  horizontally or relied on the browser's own unpredictable shrink-to-fit.
- Only **Payroll Entry** had dedicated print-only markup, and only because its interactive grid is
  virtualized (`@tanstack/react-virtual`) and would otherwise print whatever few rows happened to
  be mounted. Every other print-enabled page (Bank Sheet, Cash Receiving, Salary Release, Payslips,
  Employees, Advances, Corrections) printed its live on-screen `<table>` as-is.
- No systematic screen-only-control hiding: e.g. Employees' row-actions dropdown column had no
  `print:hidden` at all and printed live.

## The invariant this checkpoint establishes

Print is a **layout system**, not a screen capture. Every print-enabled page supplies *content*
(title, context, columns, rows, totals); a **shared** dialog/hook/CSS layer supplies *orientation*,
*fit*, and *page geometry* — never re-derived per page.

## Architecture

```
frontend/src/components/print/
  print-types.ts            PrintOrientation / PrintFitMode / PrintSettings, resolveOrientation()
  print-settings-dialog.tsx PrintSettingsDialog — the one shared configuration dialog
  use-print.ts              useTriggerPrint(recommendedOrientation) — the one path to window.print()
frontend/src/components/ui/
  print-button.tsx           PrintButton — every page's entry point (unchanged public call sites)
  print-context-header.tsx   unchanged — print-only heading (company/title/context/timestamp)
```

`PrintButton` no longer calls `window.print()` directly. Clicking it opens `PrintSettingsDialog`;
that dialog's own "Print" action calls `useTriggerPrint`'s returned function, which applies the
resolved layout, then calls `window.print()`. The browser's native print dialog remains the final
step and the final authority on paper size/orientation — this application only sets what it
*recommends* the browser start from.

### Print settings UX

`PrintSettingsDialog` offers:
- **Orientation:** Auto (default — resolves to the page's own `recommendedOrientation`), Portrait,
  Landscape. The user can always override the recommendation explicitly.
- **Fit:** Fit to page (default — scales column typography to the page width), Normal size (opts
  out; a wide table may then overflow, which is the whole reason it isn't the default).

### Orientation: how it's actually applied

`@page` is a top-level CSS at-rule — it **cannot** be scoped by a class selector
(`.landscape { @page { size: landscape } }` is not valid CSS; a page-context rule isn't tied to any
element). Per-print-job orientation is therefore applied the standard way: `use-print.ts` injects a
`<style id="app-dynamic-print-page-style">` element into `<head>`, containing the resolved
`@page { size: A4 <orientation>; margin: 12mm; }`, immediately before calling `window.print()`, and
removes it afterward (on the `afterprint` event, with an 8-second fallback timeout in case that
event never fires — observed to be unreliable after a cancelled print in some browsers).

`index.css` keeps a static `@page { size: A4 portrait; margin: 12mm; }` fallback for safety, but the
dynamically-injected rule — appended to `<head>` after that stylesheet, so later in document order
at equal specificity — always wins when a real print is triggered through `PrintButton`.

**Browser/native-dialog limitation:** once the browser's own print dialog opens, this application
has no further scriptable control — the user (or the OS driver) can still override the orientation
this recommended. That is expected and is why `@page`'s `size`/orientation is described here as a
*recommendation the browser starts from*, not an enforced setting. Verified in Chromium (this
project's own browser-verification environment, `playwright.config.ts`) — not verified in
Firefox/WebKit, which are out of this project's existing verification scope.

### Fit-to-page: what it means and doesn't mean

"Fit to page" scales the table to the printable page **width** — never the dataset's row count onto
one physical sheet. 1,500 employees still produce many printed pages; only the *columns* are
guaranteed to fit the selected orientation's width, not the whole table's height.

Implementation (`index.css`, gated by a `print-fit` class `use-print.ts` toggles on
`<html>`): `table-layout: fixed; width: 100%;` on any table inside a `.print-fit` container, with
compact padding/font-size and `overflow: hidden; text-overflow: ellipsis;` per cell. `table-layout:
fixed` is what actually enforces the width cap — without it, a browser sizes columns from content
and ignores `width: 100%` the moment any cell's content is wider than its proportional share.

Row-splitting is mitigated (not guaranteed) via `table tr { break-inside: avoid; }` under
`@media print` — supported by Chromium/WebKit; Firefox's print engine has historically ignored
`break-inside` on table rows, so this is a best-effort progressive enhancement. `<thead>`'s
`display: table-header-group` (unchanged from before this checkpoint) repeats the header on every
printed page in every modern browser by default.

### Paper size

A4 is the fixed baseline (`@page`'s `size: A4 <orientation>`), matching the only paper size this
repository referenced before this checkpoint (`index.css`'s prior static rule). The orientation
keyword is the only parameterized part of that rule — adding a second paper size later means
widening `PrintSettings`/`PrintSettingsDialog` with a size field and templating the injected
`@page` rule's `size` value the same way orientation already is; no architecture change.

## Payroll Entry — the acceptance case

Payroll Entry's interactive grid is virtualized (`@tanstack/react-virtual`) — only rows scrolled
into view exist in the DOM. It already had (pre-checkpoint) a second, fully non-virtualized
`<Table>` (`hidden print:block`) rendering every row of `filteredEntries`, which this checkpoint
kept and extended rather than replaced:

- **Added** a Deputed Branch column (`entry.workLines[0].unit.code`) and a compact, single-line
  Advance/Eid Advance balance note under Deductions (`entry.advance`/`entry.eidAdvance`'s
  `outstandingBalance`, same source as the on-screen grid's `BalanceLabel` — print-typography-scaled
  so it can never wrap/overflow).
- **Added** a `<tfoot>` totals row: employee count positioned under the "Employee" column
  specifically (matching `PayrollEntryTotalsRow`'s own established convention, not merged with
  "Code"), plus Gross Pay/Allowance/Deductions/Net Salary sums.
- **`recommendedOrientation="landscape"`** — Payroll Entry's print column set is wide enough that
  Landscape is the dialog's default recommendation (still user-overridable).
- **Deliberate print column set**, not every on-screen column shrunk to illegibility: Code,
  Employee, Site, Deputed Branch, Gross Pay, Days, OT Hours, Allowance, Deductions (+ balance
  note), Net Salary. Omitted, with justification (see the comment directly above the print table in
  `payroll-entry-page.tsx`): Bank Details (Bank/Branch Code/Account/IBAN — already Bank Sheet's own
  dedicated print), Designation/Units/OT Rate/Cycle Days/Leave Days/Leave Rate/EOBI
  Applicable/Remarks (reference detail, not payout figures), and Status/Hold (screen-only workflow
  state, meaningless on a static printed document).

## Other pages migrated/verified

Every print-enabled page (`PrintButton`'s 8 call sites) automatically gained the shared
orientation/fit dialog — that's a mechanical consequence of `PrintButton` itself changing, not a
per-page rewrite.

Two pages were used to prove the architecture generalizes beyond Payroll Entry, per this
checkpoint's own scope (Payroll Entry as the primary acceptance test, one further representative
page for reuse):

- **Salary Release** (`salary-release-page.tsx`) — the narrower-report/Portrait case (5 columns,
  no virtualization, was already a plain `<Table>` with no `print-flow` wrapper). Given
  `recommendedOrientation="portrait"` explicitly; its screen-only Release-action column (previously
  unhidden) is now `print:hidden` on both the header cell and each row's cell.
- **Employees** (`employees-page.tsx`) — opportunistic fix in the same vein: its row-actions
  dropdown column (`DropdownMenu` trigger) had **no** `print:hidden` at all before this checkpoint
  and printed live; now hidden on both the header and body cells.

**Not migrated to dedicated print-only markup in this checkpoint:** Bank Sheet, Cash Receiving,
Payslips, Advances, Corrections. They still print their live on-screen table (relying on the
existing `.print-flow` unclamping utility, unchanged), but now go through the same shared
`PrintSettingsDialog`/orientation/fit system as every other page. Rewriting each into fully
dedicated, virtualization-safe, deliberately-curated print markup — the way Payroll Entry and
(lightly) Salary Release were — is a natural next checkpoint, not required by this one: none of
them are virtualized (so none has Payroll Entry's specific "print shows the wrong rows" failure
mode), and this checkpoint's own scope was Payroll Entry as the acceptance case plus one further
representative page, not eight parallel rewrites.

## Final print-completeness verification pass (2026-07-25)

A follow-up pass checked every one of the 8 `PrintButton` call sites individually against the
shared baseline (sidebar/actions/filters/dropdowns excluded, no horizontal clipping, orientation
applies, Fit to Page keeps the table within the printable width, useful context remains). Two real
defects were found and fixed; everything else already passed as-is, with no dedicated print-only
rewrite:

- **Payslips** (`payslips-page.tsx`) — the "select all" checkbox column and the per-row
  Preview/Download Actions column had no `print:hidden` at all and printed live. Fixed (header +
  body cells, both columns).
- **Advances** (`advances-page.tsx`) — the Actions column's *body* cell was already `print:hidden`
  (a prior checkpoint), but its *header* cell wasn't, leaving a stray "Actions" label over an empty
  printed column. Fixed, and the `print:hidden` was moved from the inner button-row `<div>` onto
  the `<TableCell>` itself, so header and body are hidden the same way (matching Payslips/Employees/
  Salary Release).
- **Bank Sheet, Cash Receiving, Corrections** — verified (Chromium for the first two; code
  inspection plus the same already-Chromium-proven CSS mechanism for Corrections) to have **no**
  screen-only-control leak: none of the three has a row-actions column, dropdown, or checkbox — every
  column is plain data, and Corrections' own tab switcher was already `print:hidden`. **PASS**, left
  unchanged.
- **Every page's `recommendedOrientation`** was audited for whether it was a *deliberate* choice or
  a silently-inherited `PrintButton` default (`'portrait'`). Bank Sheet (11 columns), Cash Receiving
  (9 columns + a reserved 160px signature column), Advances (7 printable columns of mostly financial
  figures), and Corrections (up to 8 columns, some holding longer text) now explicitly recommend
  `'landscape'` — previously they silently recommended Portrait regardless of width, which "Auto"
  being deterministic (see below) means was actually being applied, not just theoretical. Payslips (4
  printable columns) and Employees (7, moderate-width) keep the `'portrait'` default deliberately,
  confirmed appropriate for their column count.

## Auto orientation — exact resolution

Auto was already fully deterministic and application-driven before this verification pass, not
something that "delegates to the browser": `resolveOrientation` (`print-types.ts`) is a pure
function — `orientation === 'auto' ? recommended : orientation` — and `useTriggerPrint`
(`use-print.ts`) always calls it and always injects the resulting `@page` rule; there is no code
path where `'auto'` skips resolution and leaves `@page` unset. `recommendedOrientation` is supplied
per page as a `PrintButton` prop (e.g. `recommendedOrientation="landscape"` on Payroll Entry/Bank
Sheet/Cash Receiving/Advances/Corrections, `"portrait"` on Salary Release/Payslips/Employees — the
prop's own default). The dialog's "Auto" option shows the resolved recommendation as a hint (e.g.
"Auto (Landscape)"); the user can still override it with an explicit Portrait/Landscape choice,
which always wins over the recommendation. No automatic width-measurement was added or is needed —
a page-level recommendation, chosen once by whoever built that page's print output, is sufficient
and matches every other example in this document.

## Print context

Every print-enabled page already renders `PrintContextHeader` (unchanged by this pass): company
name, the page's own title, a cycle/site/status context string where one exists (Payroll Entry,
Salary Release, Bank Sheet, Cash Receiving, Payslips all pass a `context` string built from the
selected cycle), and a generated-at timestamp. Advances and Corrections pass no `context` (neither
is cycle-scoped), which is correct, not a gap — there's no cycle/site selection to report for either
page's own current form. No decorative content was added.

## Testing

- `frontend/src/components/print/print-types.test.ts` — `resolveOrientation` (pure function).
- `frontend/src/components/ui/print-button.test.tsx` — jsdom/RTL: dialog opens instead of an
  immediate `window.print()`; confirming Landscape + Fit to page injects the right `@page` rule and
  toggles `print-fit`; Auto resolves to the page's own recommendation; Normal size skips the
  fit-to-page class.
- `tests/e2e/specs/13-print-architecture.spec.ts` — real Chromium (Playwright): Payroll Entry in
  Landscape (dialog, injected `@page` rule, `print-fit` class, the print table showing the complete
  60+-employee dataset while the virtualized grid is hidden under `@media print`, no horizontal
  overflow, a real `page.pdf()` generation, and a rendered-height proxy for "this needs more than
  one physical page"); Salary Release in Portrait (dialog defaults, screen-only Release actions
  hidden under `@media print`) as the reusability proof; Bank Sheet and Cash Receiving (final
  verification pass) confirming Auto's Landscape hint, sidebar/toolbar hidden under real
  `@media print`, `print-fit` actually applied after confirming the dialog (not just read from its
  hint text), and no horizontal overflow on either's 9-11 column table.

  `window.print()` is stubbed via `page.addInitScript` in these specs — real headless Chromium
  fires `beforeprint`/`afterprint` synchronously as if a print instantly completed, which would
  otherwise trigger this architecture's own `afterprint` cleanup and remove the `@page` style tag/
  `print-fit` class before the test could ever inspect them. The native print dialog itself has no
  Playwright/CDP-accessible API regardless — out of scope for an automated check.

## Print is not export

CSV/Excel export (`downloadPayrollEntryExport` and equivalents) is untouched by this checkpoint —
a separate capability, per the checkpoint's own explicit scope boundary.
