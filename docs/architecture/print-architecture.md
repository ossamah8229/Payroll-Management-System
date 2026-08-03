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
that dialog's own "Print" action reports the chosen settings back to `PrintButton`, which then
synchronously closes the dialog and triggers the actual print (see "Print lifecycle" below). The
browser's native print dialog remains the final step and the final authority on paper size/
orientation — this application only sets what it *recommends* the browser start from.

### Print lifecycle — the settings UI must be gone before `window.print()` runs

**Invariant: print configuration UI must be unmounted (or otherwise excluded from print) before
browser print capture. Shared print CSS independently excludes the configuration surface as
defense in depth.** Neither half is optional — see the incident and the CSS mechanism below.

**Production Print Defect (2026-07-25).** The dialog's own confirm button originally did:

```tsx
onClick={() => {
  onConfirm({ orientation, fit }); // triggerPrint — calls window.print() synchronously, inside
  onOpenChange(false);             // never reached until after window.print() has already run
}}
```

`window.print()` captures the DOM at the exact synchronous instant it's called. Because
`onConfirm` ran first and called it *before* `onOpenChange(false)` even executed, the browser
captured a DOM that still had the settings dialog fully mounted — production users saw the Print
Settings dialog itself in their print preview, on every page, instead of the report.

**Reordering the two calls would not have fixed it.** React 18 batches state updates queued inside
an event handler and does not commit them to the DOM synchronously within that same handler — so
even `onOpenChange(false)` followed by `onConfirm(...)` would still run the print trigger before
the dialog's removal had actually been committed to the DOM. The fix has to force that commit,
not just request it earlier.

**Fix — `PrintButton` owns the sequencing, forced synchronous with `flushSync`:**

```tsx
function handleConfirm(settings: PrintSettings) {
  flushSync(() => {
    setSettingsOpen(false);
  });
  triggerPrint(settings);
}
```

`PrintSettingsDialog`'s confirm button now only calls `onConfirm(settings)` — it no longer closes
itself; that responsibility moved to the caller so the caller can guarantee the ordering.
`flushSync` (from `react-dom`) forces React to synchronously apply and commit the `setSettingsOpen(false)`
update — including unmounting the dialog's Radix `Portal` content — before `handleConfirm`
continues to the next line. Only once that commit is guaranteed does `triggerPrint` run
(`applyPrintLayout`, then `window.print()`). This is React's own documented use case for
`flushSync`: forcing a DOM update to commit before an immediate imperative browser action that
depends on the DOM's current state.

The corrected lifecycle:

```
User opens Print Settings
        ↓
User chooses settings
        ↓
User clicks Print → PrintSettingsDialog reports settings via onConfirm (does not close itself)
        ↓
PrintButton: flushSync(() => setSettingsOpen(false))   — synchronous commit, dialog unmounted for real
        ↓
PrintButton: triggerPrint(settings)
        ↓
        resolve orientation + fit → applyPrintLayout (inject @page style, toggle print-fit)
        ↓
        window.print()   — DOM is now guaranteed clean of the settings dialog
        ↓
Native browser print preview
        ↓
afterprint cleanup
```

No arbitrary timeout (`setTimeout(..., 500)` or similar) is used or was considered adequate — a
timeout is not deterministic against a real device's render pipeline. `flushSync` is: the dialog's
removal is either committed or `flushSync` has not yet returned: there is no third state.

**Why this is in the shared architecture, not a per-page fix.** All 8 `PrintButton` call sites
share this exact component and hook — the fix lives once, in `PrintButton`/`PrintSettingsDialog`,
and applies to every page automatically. No page-level code changes were needed or made.

**Defense in depth — CSS.** Independent of the lifecycle fix, `frontend/src/components/ui/modal.tsx`
(the shared `ModalContent`, underlying *every* dialog in the app, not just print settings) now
carries `print:hidden` on both its `DialogPrimitive.Overlay` and `DialogPrimitive.Content`. Even if
a future regression left a dialog mounted at the moment of print capture, it still could not appear
on paper. This is safe for the report content specifically because Radix's `Portal` renders
directly into `document.body` — a sibling of the app's root, never a wrapper around it — so hiding
the modal's own overlay/content can never hide a report a page underneath is printing.

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

## Statements joins the shared architecture (Phase 7B Checkpoint 3)

Statements is the 9th `PrintButton` call site, added alongside its own PDF/XLSX/CSV export actions
(`docs/architecture/workflows/statements-ledger.md`'s own Checkpoint 3 section covers export/
filename handling — this section covers only what's specific to *print*). No architectural change
was made to reach it — the same mechanical consequence every other page already got by using
`PrintButton`/`PrintContextHeader` as-is:

- **`recommendedOrientation="landscape"`** — the Ledger table is 7 columns (Date/Period, Category,
  Description, Movement, Running Payable, Running Recovery, Running Advance), the same "wide,
  mostly-financial-figures" shape Advances/Bank Sheet/Corrections already recommend Landscape for,
  rather than Payslips'/Employees'/Salary Release's narrower Portrait default.
- **`print:hidden` on the whole "Select Statement" filter card** — the same treatment
  `PayrollPageToolbar`'s own `filters` slot already gives every other page's search/selection
  controls, applied by hand here since Statements' multi-card layout (filter card, then identity/
  balances/ledger cards once loaded) doesn't use `PayrollPageToolbar` at all.
- **`print-flow` added to the Ledger table's scroll wrapper** — every other print-enabled data
  table already carries this (Bank Sheet, Payslips); Statements' own table was missing it before
  this checkpoint, which would have left "Fit to page" with no `table-layout: fixed` container to
  apply to.
- **`PrintContextHeader`'s `context` string carries the employee identity and period** (`"{employee
  name} — {statement period}"`), not just a cycle/site string like every other caller — Statements
  is inherently about one specific employee by the time anything on the page is printable, unlike
  every other `PrintContextHeader` caller, which is a filtered list.
- **`PrintButton` gained one small, additive `disabled?: boolean` prop** (default `false`,
  `print-button.tsx`) — Statements passes it while one of its own Export actions is in flight, so a
  user can never open Print mid-export. Every other existing call site omits the prop and is
  completely unaffected; the reverse direction (Export disabled while the print settings dialog is
  open) needed no equivalent change, since `PrintSettingsDialog`'s own `Modal` overlay already
  blocks pointer events on everything behind it while open.

## Auto orientation — exact resolution

Auto was already fully deterministic and application-driven before this verification pass, not
something that "delegates to the browser": `resolveOrientation` (`print-types.ts`) is a pure
function — `orientation === 'auto' ? recommended : orientation` — and `useTriggerPrint`
(`use-print.ts`) always calls it and always injects the resulting `@page` rule; there is no code
path where `'auto'` skips resolution and leaves `@page` unset. `recommendedOrientation` is supplied
per page as a `PrintButton` prop (e.g. `recommendedOrientation="landscape"` on Payroll Entry/Bank
Sheet/Cash Receiving/Advances/Corrections/Statements, `"portrait"` on Salary Release/Payslips/
Employees — the prop's own default). The dialog's "Auto" option shows the resolved recommendation
as a hint (e.g. "Auto (Landscape)"); the user can still override it with an explicit Portrait/
Landscape choice, which always wins over the recommendation. No automatic width-measurement was
added or is needed — a page-level recommendation, chosen once by whoever built that page's print
output, is sufficient and matches every other example in this document.

## Print context

Every print-enabled page already renders `PrintContextHeader` (unchanged by this pass): company
name, the page's own title, a cycle/site/status context string where one exists (Payroll Entry,
Salary Release, Bank Sheet, Cash Receiving, Payslips all pass a `context` string built from the
selected cycle), and a generated-at timestamp. Advances and Corrections pass no `context` (neither
is cycle-scoped), which is correct, not a gap — there's no cycle/site selection to report for either
page's own current form. No decorative content was added.

## Company Logo in printed documents (Phase 7C)

**Layout integrity outranks branding — the client's own explicit priority for this checkpoint.**
Every document below was measured before/after adding a logo; the logo ships only where that
measurement proved zero effect on pagination, margins, column widths, row heights, or typography.
No document in this system had its logo deliberately omitted for a layout-integrity reason — all
four were proven safe (see below) — but "no logo" was the accepted fallback this checkpoint would
have used for any document that couldn't clear that bar. **Watermarking was evaluated and
rejected** (see the Phase 7B architecture investigation): Puppeteer's only per-physical-page
repeating mechanism (`headerTemplate`/`footerTemplate`) reserves margin-box height, which risks
shifting the Statement ledger's own multi-page row count — the exact regression this checkpoint
exists to prevent; `position:fixed` watermarks are also not reliably repeated per printed page by
Chromium's print engine. A small in-flow header logo, capped below the shortest existing line
height, is the lower-risk choice compared to a watermark for every document here.

- **Payslip / Statement (Puppeteer PDF)** — `templates/payslip.ts` / `templates/statement.ts`
  render the logo (a `data:image/png;base64` URI, `modules/settings/company-logo.service.ts`'s
  `getCompanyLogoDataUri()`) inline beside the company name inside the existing `.doc-header`
  block, never as an added row. CSS caps it at `height: 18px` — below the shortest realistic height
  of that block (a 14pt bold company-name line alone already renders taller) — so the header's own
  height can never grow, regardless of whether a registered address is present. Fetched **once per
  request** (including once per an entire Payslip batch, never once per document) and passed
  through `PayslipPdfMeta`/`StatementPdfMeta.companyLogoDataUri`. The Statement's own header block
  renders once, at the top of the flowing document (not a repeating Puppeteer header), so this only
  ever affects page 1's layout — verified against short and long (multi-page) Statements.
- **Bank Sheet / Cash Receiving (browser print, no PDF pipeline)** — `<PrintContextHeader
  showLogo>` is an explicit **opt-in** prop (default `false`), never a blind default, since that
  component is shared by every print-enabled page (Payslips list, Statements, Bank Sheet, Cash
  Receiving) — enabling it needed its own per-document verification, not a blanket flip. Uses the
  print-optimized asset (`COMPANY_LOGO_PRINT_URL`, `<DocumentLogo>`,
  `frontend/src/components/ui/document-logo.tsx`), capped at `h-3.5` (14px), consistent with the PDF
  templates' own sizing rule. Cash Receiving's own second, always-visible document header (not
  `PrintContextHeader`) got the identical treatment, reusing `<DocumentLogo>` rather than a second
  implementation. Real-Chromium Playwright verification
  (`tests/e2e/specs/16-company-logo.spec.ts`) measures this exact header element's rendered height
  in `print` media before and after a logo is uploaded and asserts it is byte-for-byte unchanged.

## Payroll Summary — field-selectable print (Post-deployment Print Usability Refinement)

Production UAT found Payroll Summary's printed output illegible: its site-level table has 19
columns (Project Site plus 18 mostly-financial figures) — too many for any single landscape page to
render at a readable size, so headings and monetary values were truncated/squashed. The chosen fix
is deliberately **not** a variant of `.print-fit`'s existing `table-layout: fixed`/8.5px-font
shrink-everything approach (that CSS is exactly what made the *full* 19-column table illegible in
the first place) — it's letting the user choose which columns/summary cards actually need to appear
on paper, then sizing that smaller column set naturally.

**Architecture — an extra step in front of the same shared engine, not a new one.** Payroll
Summary's own Print button (`reports-payroll-summary-page.tsx`) does not render the generic
`PrintButton` component every other print-enabled page uses. Clicking it opens a new
`PayrollSummaryPrintOptionsDialog` (`components/reports/payroll-summary-print-options-dialog.tsx`)
first — presets (Compact Summary / Deductions / Release Status) and individual checkboxes for 8
summary cards and 19 table columns (Project Site locked, always selected). Confirming it calls
`useTriggerPrint('landscape')` directly — the exact same shared hook `PrintButton`/
`PrintSettingsDialog` already call — fixed to landscape/fit-to-page rather than re-exposing an
orientation/fit choice the checkpoint brief didn't ask for. The Production Print Defect's own fix
(`flushSync`-ordered dialog-close-then-print, `PrintButton`'s own doc comment above) is mirrored
exactly in `handlePrintConfirm`, since this dialog is just as capable of still being mounted at the
exact synchronous instant `window.print()` fires.

**What actually prints.** A second, `hidden print:block` cards/table block (mirroring Payroll
Entry's own "dedicated print-only markup, on-screen version `print:hidden`" pattern, §"Payroll
Entry — the acceptance case" above) renders only the user's selected fields, reading them directly
off the exact same already-loaded `PayrollSummaryReport` (`report.data`) the on-screen table and
CSV/XLSX exports already use — no second fetch, no recalculated figure; column selection is
presentation-only. The on-screen table itself is unchanged and always shows all 19 columns; it just
gained its own `print:hidden` so it no longer doubles as the print artifact. CSV/XLSX export is
completely untouched — both still call the same unpaginated `buildPayrollSummaryData` and always
return the complete filtered report, exactly as before this refinement.

**Legibility without a global font-size reduction.** The print-only table is deliberately never
given the `print-fit` class (`handlePrintConfirm` passes `fit: 'normal'` to `useTriggerPrint`), so
`table-layout` stays the browser default (`auto`) and column widths are sized from content, not
forced into an equal, shrunk division of the page width.

**Presets map to both cards and columns.** Each preset (`PRINT_PRESETS`) is a paired
`{ cards, columns }` selection — e.g. Compact Summary selects the 5 summary cards *and* the matching
6 table columns (Project Site, Employees, Gross Pay, Net Salary, Released Amount, Pending Release
Amount) in one action. Every field id is a real `PayrollSummaryFigures` key (never a display label),
so selection state, presets, and the browser-local last-used-selection (`localStorage`, key
`payroll-summary-print-fields:v1` — never persisted to PostgreSQL) all stay stable across a future
label wording change.

**Final Print UX Refinement — the default is the complete report, not a pre-narrowed one.** The
dialog's own initial state (`FULL_REPORT_SELECTION`, `payroll-summary-print-fields.ts`) is every
summary card and every table column selected — the application must never silently hide report
data, so a smaller printout is now something a user explicitly opts into (a preset, or a hand-picked
selection), never the unexplained starting point. "Reset to Default" restores this same complete
selection, not a preset. Compact Summary/Deductions/Release Status remain exactly as before, as
opt-in shortcuts. A saved browser-local preference (an earlier, narrower selection a user already
chose) still wins over this default on the dialog's next open — the default only applies when
nothing is stored yet, or after an explicit Reset.

**Print Readability indicator** (`getReadabilityLevel`, replacing the prior pass's plain "N columns
selected" text) — four column-count-derived tiers, purely informational, never a selection change:

| Columns | Status | Tone | Explanation |
|---|---|---|---|
| ≤ 8 | Excellent | green | "This layout should print clearly." |
| 9–11 | Good | blue | "Suitable for most A4 landscape prints." |
| 12–15 | Wide | amber | "Some columns may become compressed." |
| 16+ | Very Wide | red | "This layout is likely to reduce readability. Consider using a preset." |

Only the Very Wide tier additionally surfaces a prominent warning banner ("You have selected many
columns. The report may be difficult to read when printed on A4 paper. Consider using one of the
built-in presets.") — printing remains allowed regardless; the selection itself is never altered.
Because the new default is the full 19-column report, a first-time user opening the dialog sees
Very Wide and this banner immediately — a deliberate tradeoff (never hiding data by default) over a
quieter first impression; the three presets exist precisely to give that user an easy, one-click way
down to Excellent/Good.

## Testing

- `frontend/src/components/reports/payroll-summary-print-options-dialog.test.tsx` — jsdom/RTL: the
  dialog opens with every card/column already selected (Full Report), never a pre-narrowed one; each
  preset still selects its own exact field set and updates the readability indicator immediately;
  Project Site is selected and disabled and cannot be toggled off; Select All / Clear Optional
  Fields / Reset to Default (Reset now restores Full Report, not a preset); the Print Readability
  indicator's four tiers (Excellent/Good/Wide/Very Wide) each verified at their own column count;
  the prominent Very Wide warning appears only at 16+ columns and never alters the selection; the
  "no meaningful columns" guard blocks Print when only Project Site remains selected; local
  -preference restoration (a stored selection pre-populates the dialog and wins over the Full Report
  default; confirming Print saves the current selection; Reset overwrites a saved narrower
  preference with Full Report only once confirmed, never migrating storage on its own).
- `frontend/src/routes/reports-payroll-summary-page.test.tsx` — Print opens the options dialog
  instead of calling `window.print()` immediately, defaulting to Full Report; confirming a preset
  (or confirming with no preset picked, printing the complete report) calls `window.print()` with
  the print-only cards/table already reflecting that selection; the on-screen table/cards
  (`data-testid="on-screen-table"`/`"on-screen-cards"`) always show every column/card regardless of
  what was just printed; CSV/XLSX export is unaffected by print field selection.
- `tests/e2e/specs/17-reports.spec.ts` — real Chromium: the dialog defaults to Full Report (Very
  Wide, warning banner visible) and printing it without picking a preset renders every column;
  Compact Summary/Deductions/Release Status/a custom selection each print exactly their own
  headings, verified via `getByRole('columnheader', { name, exact: true })` (an ellipsis-truncated
  heading would fail an exact accessible-name match even though *some* text node still exists);
  measurable geometry proof — the print-only table's `scrollWidth` never exceeds its container's
  `clientWidth` (no horizontal clipping), no individual header cell's `scrollWidth` exceeds its own
  `clientWidth` (no per-cell ellipsis truncation — the direct DOM proof `print-fit` was never
  applied), and no two adjacent totals-row cells' bounding boxes overlap; the on-screen table still
  shows every column under real `@media screen`; Excel export still succeeds and is unaffected after
  using Print.

- `frontend/src/components/print/print-types.test.ts` — `resolveOrientation` (pure function).
- `frontend/src/components/ui/print-button.test.tsx` — jsdom/RTL: dialog opens instead of an
  immediate `window.print()`; confirming Landscape + Fit to page injects the right `@page` rule and
  toggles `print-fit`; Auto resolves to the page's own recommendation; Normal size skips the
  fit-to-page class; **REGRESSION (Production Print Defect)** — captures DOM state *synchronously,
  inside the `window.print()` mock itself* (not in a later, separate assertion) and confirms the
  settings dialog is absent and a sibling "report" element is present at that exact moment. Verified
  to fail against the pre-fix implementation (confirmed by temporarily reverting the fix and
  re-running) and pass against the fix.
- `tests/e2e/specs/13-print-architecture.spec.ts` — real Chromium (Playwright): Payroll Entry in
  Landscape (dialog, the print table showing the complete 60+-employee dataset while the
  virtualized grid is hidden under `@media print`, no horizontal overflow, a real `page.pdf()`
  generation whose bytes were checked not to contain "Print settings", and a rendered-height proxy
  for "this needs more than one physical page"); Salary Release in Portrait (dialog defaults,
  screen-only Release actions hidden under `@media print`) as the reusability proof; Bank Sheet and
  Cash Receiving confirming Auto's Landscape hint, sidebar/toolbar hidden under real
  `@media print`, and no horizontal overflow on either's 9-11 column table.

  **REGRESSION (Production Print Defect) — `stubWindowPrintWithCapture`.** Every test above that
  triggers a real print now stubs `window.print` to capture DOM/CSS state *synchronously, inside
  the stub itself* — `dialogPresent`, `printSettingsTextPresent`, `reportPresent` (a per-page
  selector for the actual report content), `printFitApplied`, and the injected `@page` style
  content — the same instant a real browser's print engine would capture, with no grace period.
  This is a deliberate change from the original version of this spec, which stubbed
  `window.print` as a bare no-op and only asserted DOM/CSS state via a *later*, separate
  `page.evaluate()` call after the confirm click's own `await ...click()` had resolved — by which
  point React had already flushed the (buggy) pending close, so those assertions could never have
  caught the real production defect. **Confirmed**: the new assertions fail against the pre-fix
  code (verified directly, by temporarily reverting the fix and re-running this spec) and pass
  against the fix, for both Payroll Entry (dedicated print table) and Bank Sheet/Cash Receiving
  (live-DOM report) — proving the shared lifecycle fix generalizes across both print
  architectures, not just one. Every test also asserts `page.getByRole('dialog')` has zero matches
  under real `@media print` emulation, independently confirming the CSS defense-in-depth.

  The native print dialog itself has no Playwright/CDP-accessible API — out of scope for an
  automated check regardless.

## Print is not export

CSV/Excel export (`downloadPayrollEntryExport` and equivalents) is untouched by this checkpoint —
a separate capability, per the checkpoint's own explicit scope boundary.
