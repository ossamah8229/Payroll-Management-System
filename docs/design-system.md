# Design System — Payroll Management System

## Purpose & Status

This document reverse-engineers the design language of `reference/payroll_prototype.html` into a
set of reusable design tokens, layout patterns, and component conventions for the production
build.

**The prototype is a visual/behavioral reference only.** Its inline `<style>` block, template
literals, and vanilla-JS DOM rendering are not to be copied as code. This document translates its
*visual decisions* (color, spacing, typography, component shape) into tokens that will live in the
Tailwind config and a small shared component library, and translates its *interaction patterns*
(multi-select filters, correction diffs, inline-editable tables) into named, reusable React
components rather than one-off markup repeated per page.

---

## 1. Design Tokens

### 1.1 Color

The palette is warm-neutral (not pure gray/white) with a small set of semantic accent colors. Every
semantic color ships as a `{color}` / `{color}-light` pair: the light variant is a tinted
background, the solid variant is used for text/icons on that background — never for large fills.

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#F0EDE8` | App background (page canvas) |
| `surface` | `#FAFAF8` | Secondary surface (banners, inline highlight blocks) |
| `surface-2` | `#FFFFFF` | Cards, inputs, modals — the "paper" surface |
| `border` | `#D8D4CC` | Default hairline border |
| `border-strong` | `#B8B2A8` | Hover / focus-adjacent border |
| `text` | `#1A1816` | Primary text |
| `text-muted` | `#6B6560` | Secondary text, labels, meta info |
| `text-faint` | `#6F6B66` (was `#9C978F` before Post-Phase-5 Stabilization Checkpoint 2's AUD-008 fix) | Placeholder text, disabled, tertiary hints. **Passes WCAG AA (4.5:1) against both `surface-2`/white (5.29:1) and `bg` (4.53:1)** — the prior value failed at 2.90:1/2.49:1 respectively. Verified by contrast calculation and by a live-browser measurement of the rendered token; see `docs/PROJECT_PROGRESS.md`'s dated Checkpoint 2 entry. |
| `accent` / `accent-light` / `accent-mid` | `#1B4F72` / `#EBF2F8` / `#2E6EA6` | Brand color — primary buttons, active nav, links, focus rings. **User-customizable per the Theme settings tab** — must be a CSS variable / Tailwind CSS-var-backed color, not a hardcoded Tailwind class, so it can be swapped at runtime per user. |
| `green` / `green-light` | `#1A6B3A` / `#E8F5EE` | Positive / success / net salary / released status |
| `amber` / `amber-light` | `#8B5E00` / `#FFF8E6` | Warning / pending / partial status |
| `red` / `red-light` | `#8B1A1A` / `#FBE8E8` | Danger / deduction / hold / overpaid |
| `purple` / `purple-light` | `#4A2080` / `#F0EBF8` | Role badges, locked/correction indicators, special categories |
| `gray` (badge only) | uses `bg` / `text-muted` | Neutral badge for designation tags etc. |

Theme picker swatches (Settings → Theme) are exactly these six: Blue (default), Green, Purple, Red,
Amber, Charcoal (`#1A1816`). Only `--accent` is swapped by the picker — all other tokens are fixed
and shared across users.

### 1.2 Typography

- **UI font**: system font stack — `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. No custom webfont is loaded; keep it that way for load performance and native OS feel.
- **Document font**: printable artifacts (Payslip, Cash Receiving Sheet, and the print view of Bank Sheets) use `"Times New Roman", serif` deliberately, to read as a formal paper document distinct from the app chrome. **This is a second, intentional typography system — do not unify it with the UI font.**
- **Numeric alignment**: every numeric table cell uses `font-variant-numeric: tabular-nums` and is right-aligned. This is a strict convention, not a style preference — misaligned or proportionally-spaced numbers in a payroll table read as untrustworthy.

Type scale (UI):

| Size | Weight | Usage |
|---|---|---|
| 9.5–10px | 600, uppercase, `letter-spacing: .05–.08em` | Micro-labels: table headers, filter labels, stat labels, nav section headers, badges |
| 11px | 400–500 | Meta text, field hints, secondary line under a name/value |
| 12px | 400–500 | Default body text, table cell text, inputs, buttons |
| 13px | 600–700 | Section titles, modal body emphasis |
| 14–15px | 600–700 | Modal titles, page title, profile name |
| 16–21px | 700, `letter-spacing: -.02em` | Stat card values, summary numbers — the few places large bold numbers should draw the eye |

### 1.3 Spacing

Spacing is drawn from a small, consistent set — do not introduce arbitrary values:

`4px · 6px · 8px · 10px · 12px · 14px · 16px · 18px · 20px · 24px · 28px`

- Page content padding: `24px 28px`
- Card/section body padding: `18px`
- Modal body padding: `20px`
- Compact table cell padding: `7–8px 8–10px` (Payroll Entry grid is deliberately denser than other tables to fit many editable columns)
- Flex/grid gaps: `8px` (tight groups, button rows) · `14–16px` (cards in a grid) · `20px` (major two-column layouts)

### 1.4 Radius & Elevation

| Token | Value | Usage |
|---|---|---|
| `radius` | `8px` | Buttons, inputs, badges' inner corners, small chips |
| `radius-lg` | `12px` | Cards, sections, modals, report cards |
| `50%` | — | Avatars, toggle knobs, theme swatches, FAB |
| `shadow-md` | `0 4px 16px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.04)` | Modals, floating panels, FAB — the only elevation shadow in the system. Flat cards use a 1px border, not a shadow, to stay visually calm at high information density. |

### 1.5 Control Heights & Table Density (Post-Phase-5 Stabilization Checkpoint 2)

Formalized as CSS custom properties in `frontend/src/index.css` (also literal values in every
`docs/prototypes/*.html`, which have no Tailwind build step to read the variables through) — see
AUD-010 in `docs/PROJECT_PROGRESS.md`'s dated Checkpoint 2 entry for the audit finding this closes:
buttons at `size="sm"` (32px) were sitting in the same `items-end` filter row as 36px inputs/
selects, a few-pixel misalignment compounding across a row.

| Token | Value | Usage |
|---|---|---|
| `--control-height` | `36px` | Default `<Input>`, `<select>`, `MultiSelectFilter` trigger, `<Button size="default">` (the default variant — no `size` prop needed). **Every control sitting inline in a filter row uses this height**, never `size="sm"`, regardless of whether it's an input or a button. |
| `--control-height-sm` | `32px` | `<Button size="sm">` — reserved for controls *inside* a table row/action cell (e.g. a per-row "Release"/"Edit" button) or a standalone action with no adjacent 36px control to align against (e.g. a `CardHeader` title-row action). Never used for a control that shares an `items-end` filter row with a 36px input/select. |
| `--table-row-height-standard` | `48px` | Target/typical rendered body-row height for `<Table>`'s default `density="standard"` — management/selection lists: Employees, Users, Project Sites, Project Units, Tasks, Advances, Payslips, Salary Release's Unit-status table, Corrections' Review Queue/Ledger (Phase 6 Checkpoint 6). |
| `--table-row-height-compact` | `40px` | Target/typical rendered body-row height for `<Table density="compact">` — document-like/high-density financial views: Bank Sheets, Cash Receiving. (Payroll Entry's own grid is a separate, deliberately custom-virtualized component — content-driven horizontal sizing and sticky headers, not built on the shared `<Table>` — and is exempt from this two-tier system.) |
| `--table-header-height` | `36px` | Reference value for a table's own `<thead>` row — always shorter than either body-row tier, since a header holds only a short uppercase micro-label, never a full-height control. |
| `--filter-field-gap` | `6px` | Gap between a filter field's own label and control (`FilterField`, `MultiSelectFilter`). |
| `--filter-row-gap` | `12px` | Gap between sibling fields in one filter row (the row's own `gap-3`). |

**Row height stays content-driven** (cell padding, never a forced `height` on a `<tr>`/`<td>`, which
can clip taller content) — the pixel values above are the *documented, measured result* of that
padding at normal font sizes, not a hard box constraint. `frontend/src/components/ui/table.tsx`
exposes this as `<Table density="standard" | "compact">`, propagated via context so `TableHead`/
`TableCell` don't need `density` repeated on every cell; `tableHeadPaddingClass`/
`tableCellPaddingClass` (exported from the same file) are the deterministic density → padding-class
mapping, unit-tested directly in `table-density.test.ts`.

**`FilterField`** (`frontend/src/components/ui/filter-field.tsx`) is the shared label+control shell
every filter field now uses — `PayrollCycleSelectField`, and every page-level Cycle/Site/Bank/Type/
Status/Search filter that used to hand-roll its own `<div><label>...</label><select/></div>` with a
slightly different label size/gap than `MultiSelectFilter`'s own. One shell, one gap, one label
style, app-wide.

---

## 2. Layout Patterns

### 2.1 App Shell

- **Fixed left sidebar**, 220px, solid `accent` background (dark), full viewport height. Contains, top to bottom: company name/logo block, a scrollable nav grouped into labeled sections (Overview / Payroll / Employees / Admin), and a pinned footer with the current user's avatar, name, and role.
- **Main area** offset by `margin-left: 220px`, containing a **sticky topbar** (56px) and a scrollable content region.
- **Topbar**: page title + subtitle on the left, contextual global actions on the right (current month badge, Import/Export, New Payroll Cycle). The right-hand action set is the one region of the topbar that changes meaning slightly per page context — the title/subtitle should always describe the active page.
- **Nav item states**: default (70% white text), hover (8% white bg), active (12% white bg + left accent border + full-white text + medium weight). Badge counts (e.g. pending Payroll Entry count) sit right-aligned on the nav row. **Nav-section labels are 65% white opacity** (`--sidebar-section-label`, corrected from 35% by AUD-008 — 35% measured 2.48:1 against the `accent` background, well under WCAG AA's 4.5:1; 65% measures 4.71:1).
- **The document itself never scrolls — only the main content region does.** `app-shell.tsx`'s root is `h-screen overflow-hidden`; the sidebar is fixed-height for the life of that container, `<main>` alone carries `overflow-y-auto`. This is what the AUD-007 finding was about: every `docs/prototypes/*.html` file previously let its own trailing `<footer>` sit *outside* the fixed-height shell, making the whole HTML document scrollable and the fixed-position sidebar visually detach once a reader scrolled into it — fixed in every prototype by giving `html`/`body` a hard `height: 100%; overflow: hidden` and moving that trailing documentation into its own in-shell, internally-scrolling "Implementation notes" tab.
- **A `position: sticky` element must always have an explicit opaque background of its own — never inherited from an ancestor "happening to" be the right color** (Post-Checkpoint-1A UAT Stabilization, 2026-08-05; wording corrected the same day per an independent review's own finding — see below). Every sticky element already in the app (the shared `Topbar`; Payroll Entry's own grouped header/column-header/totals rows, `payroll-entry-grid.tsx`) already followed this. The one gap this checkpoint found and closed: content that *scrolls past* a sticky element must be equally explicit — a virtualized, absolutely-positioned/transformed row (Payroll Entry's own grid, `docs/design-system.md` §1.5's documented exemption from the shared `<Table>`) is exactly this kind of content, and its row previously had **no background of its own at all** (`payroll-entry-row.tsx`), relying entirely on the ancestor Card's incidental white surface. That is not equivalent to an explicit opaque background: fully opaque rows structurally prevent any underlying content from becoming visible during sticky/virtualized composition, regardless of what's painted behind them — **this was a confirmed robustness gap**, closed by giving every row an explicit `bg-surface-2`. **Correction (independent review, 2026-08-05): this checkpoint's original wording overstated the finding as the "confirmed root cause" of the specific reported "blank strip while scrolling" symptom.** The reported symptom itself was never reproduced conclusively in the review environment — investigation directly disproved the initial "bleed-through" hypothesis (pixel-sampling showed the suspected artifact was the sticky header's own column-label text, not foreign content showing through), and a `will-change: transform` compositing probe measured zero effect, meaning no live, active-scroll transient artifact was ever directly captured (only static, settled screenshots, which cannot observe a transient compositing frame even if one existed). The fix stands on its own merits as a real, general-purpose robustness rule — not as a proven fix for the exact reported screenshot. Other application pages were independently audited (direct repository search) and found not to use this sticky-grid-plus-virtualized-transform pattern at all, so this row-opacity fix is the only page-level change this checkpoint required; see `docs/PROJECT_PROGRESS.md`'s and `docs/SESSION_HANDOFF.md`'s own matching corrections for the full investigation record. This remains a general rule for any future virtualized/absolutely-positioned content near a sticky element, not specific to this one grid.

- **UAT 2026-08-10 — the actual scroll/header blank-space defect, re-root-caused.** UAT reproduced the reported "blank strip while scrolling" defect on **Employee Registry** — a page with no virtualized rows and no sticky element of its own at all (it renders the plain, non-virtualized shared `<Table>`) — proving the 2026-08-05 row-opacity fix above, however real a robustness improvement, was never the actual mechanism; that same-day independent review had already flagged the causal claim as unconfirmed, and this UAT confirmed it directly. Real-Chromium investigation (Playwright + a CDP `Input.synthesizeScrollGesture` overscroll gesture, screenshotting mid-gesture and pixel-sampling the top of the content region) found the real cause: `html`/`body` were left at the browser default `overscroll-behavior-y: auto`. A trackpad/gesture scroll that overshoots the top of the page triggers the browser's own native elastic bounce **on the document itself**, shifting AppShell's entire root (`app-shell.tsx`'s outer `flex h-screen overflow-hidden` div, Topbar included) down within the viewport for the duration of the bounce and exposing `body`'s own `--color-bg` in a strip above the Topbar — precisely where the Topbar's opaque white should always stay pinned. This reproduced identically on every page audited (Employee Registry, Payroll Entry, Project Sites, Reports catalogue, a long report, Salary Release) because it is a single shared-layout defect, not a per-page one — confirming §2.1's own "the document itself never scrolls" invariant above was necessary but not sufficient: nothing had ever told the *browser* it may not attempt to scroll the document at all. **Fixed once, at the shared layout level:** `frontend/src/index.css`'s `@layer base` sets `overscroll-y-none` (`overscroll-behavior-y: none`) on both `html` and `body`, and `app-shell.tsx`'s `<main>` (the one element that legitimately does scroll) additionally carries `overscroll-y-contain` so its own scroll-chaining is contained rather than propagating anywhere. This is a **structural** fix, not a background patch: with the document's own overscroll disabled, the browser cannot produce the bounce that exposed the gap, regardless of a page's content, background choices, or table implementation. Regression-tested in `tests/e2e/specs/23-scroll-header-integrity.spec.ts` — both a deterministic `overscroll-behavior` computed-style assertion (proves the mechanism is disabled) and a real overscroll-gesture pixel-sampling test on Employee Registry and Payroll Entry (proves the symptom cannot occur).

In production this shell maps to a persistent layout route (e.g. a React Router layout route) — the
prototype's `.page` / `.page.active` show/hide toggling should **not** be replicated; use real
client-side routes so URLs, back/forward, and deep-linking work.

### 2.1a Company Logo — identity, not theme (Phase 7C)

The company logo (an uploaded image, `CompanySettings.logoStorageKey`) and the accent color (§1.1,
Theme settings, user-customizable) are **two entirely separate concepts** and must never be
conflated:

- **Theme (`--accent`)** stays exactly as specified above — user-controlled, per-session, applied
  via a CSS custom property. Nothing about the logo feature reads, writes, or gates on it.
- **Logo** is company *identity*, shown only in identity locations: the sidebar's company-name
  block (§2.1, this section — a small icon beside the existing text, never replacing it), the Login
  page, the Settings → Company Details preview, and (print-only, see
  `docs/architecture/print-architecture.md`'s own Company Logo section) printed-document headers.
- **Explicitly out of scope, by design, permanently**: the logo must never drive button colors,
  navigation colors, page backgrounds, or any other UI chrome — those remain governed by `--accent`
  alone. A future request to "brand the app" with logo-derived colors is a **different, unapproved**
  feature, not an extension of this one.
- Falls back to `LogoPlaceholder` (a neutral icon) whenever no logo is set or the image request
  fails — never blocks rendering, never shows a broken-image icon.

### 2.2 Section / Card

The single most-reused structural unit. A "section" is: white surface, `radius-lg`, 1px border, a
header row (title + optional right-aligned action button(s)), and a padded body. Nearly every page
is composed of one or more sections — tables, forms, and report panels all nest inside this
container rather than floating on the bare page background.

### 2.3 Dashboard Grid

Two-tier grid: a `1.4fr / 1fr` two-column split (primary table + stacked secondary sections), with a
4-column stat-card row above it. Stat cards are small, flat, color-coded only in the value text
(not the whole card) — label uppercase/muted, value bold/large, optional muted sub-line.

### 2.4 Filter Row

A consistent horizontal pattern across every page with filters (Payroll Entry, Salary Release, Bank
Sheet, Cash Receiving, Advances, Payslips, Employee Registry, Corrections): left-aligned label+control groups
(`FilterField`, §1.5 — uppercase micro-label above a select/input, one shared shell rather than
each page hand-rolling its own), primary action buttons pushed to the far right via
`margin-left: auto`. Never mix filters and actions without this left/right split — it's what keeps
dense toolbars scannable. **Every control in the row shares one height (`--control-height`, §1.5)**
— an action button inline with filter inputs is never `size="sm"`, only a control that has no
filter-row sibling to align against (a table-row action, a lone `CardHeader` title-row button) uses
the smaller size. A disabled field that depends on another field's selection (e.g. Payslips' Unit
filter, disabled until a single Site is chosen) communicates why via a native `title` tooltip and an
`aria-describedby`-linked `sr-only` description — never a permanently visible helper line beneath
the control, which changes the field's own height and breaks the row's shared baseline (the
Checkpoint 1 root cause of the reported Payslips misalignment).

**Tri-state boolean filter (Employee Payroll History Checkpoint 1B)** — a filter over an optional
boolean field (e.g. "Has Correction", "Has Outstanding Origin Balance") is a plain native `<select>`
with exactly three options, in this order: **All** (the default — the filter is unset, `undefined`
is sent, never a false-equivalent value), **Yes** (`true`), **No** (`false`). Same `selectClassName`
styling as every other single-value filter select in the row (§1.5's shared control height) — no new
component, no checkbox-plus-indeterminate widget; a checkbox cannot represent "unset" without a third,
non-standard visual state, while a 3-option select reads unambiguously at a glance. Reuse this exact
pattern for any future optional-boolean filter rather than inventing a second shape.

### 2.5 Read-Only Page Banner

Bank Sheets and Cash Receiving Sheet each open with a colored info banner (a `Lock` icon, read-only) explaining
*why* there's no data entry here and *where* to go to change something. Any future read-only/derived
view (e.g. a new report) should carry the same banner convention rather than silently disabling
inputs. **Payroll Entry reuses this same banner** (added Phase 5 Checkpoint 4, 2026-07-16) when its
selected Payroll Cycle is `Archived` — the whole page (edit/delete/bulk/import/hold/work-lines) goes
read-only and the banner explains that the cycle is archived and permanently locked, distinct from
the Bank Sheet/Cash Sheet banners which are read-only *by page purpose* rather than by cycle state.

### 2.6 Payroll Cycle Selector

A single dropdown (`<PayrollCycleSelectField>`, `docs/architecture/workflows/payroll-lifecycle.md`
"Payroll Cycle Selector") shared identically across Payroll Entry, Release Salary, Bank Sheet, Cash
Receiving, and Payslips (Phase 5 Checkpoint 4, 2026-07-16) — one `<select>` listing every cycle
newest-first as "{Month Year} · {Status}", paired with a `<PayrollCycleStatusBadge>` reusing the
existing `<Badge tone>` component (green=Released, amber=Draft, gray=Archived, matching the
established status-color mapping in §3). Selecting a cycle navigates the URL
(`/payroll-cycles/:cycleId/...`) rather than only updating local state — the selector is a navigation
control, not a filter control, so it belongs visually in the page header area alongside the title,
not inside the Filter Row (§2.4).

---

## 3. Components

| Component | Prototype reference | Notes for implementation |
|---|---|---|
| **Button** | `.btn`, variants `primary/secondary/green/amber`, size `sm` | 5 variants × 2 sizes covers the whole app. Build as one `<Button variant size>` component, not ad hoc classes per page. **Size is a deliberate choice, not a default (§1.5, §2.4)**: `size="default"` (36px) for anything inline in a filter row; `size="sm"` (32px) only for a table-row action or a standalone action with no adjacent 36px control. |
| **Checkbox** | native `<input type="checkbox">` in the prototype; `frontend/src/components/ui/checkbox.tsx` in production (Post-Phase-5 Stabilization Checkpoint 2, Part 4) | Built on `@radix-ui/react-checkbox`, matching this codebase's existing Radix-primitive pattern (Dialog, DropdownMenu, Label, Avatar). Supports `checked={true|false|'indeterminate'}` and `disabled`. The one shared Checkbox for the whole app — replaces every native, unstyled `<input type="checkbox">` (Employee Registry's "Active employees only" filter and EOBI-applicable form field, Users' site-assignment list and Active toggle, Payslips' select-all/per-row selection). |
| **Badge / status pill** | `.badge-{green,amber,red,blue,purple,gray,hold}` | Semantic, not decorative — color always maps to the same meaning app-wide (green=released/positive, amber=pending, red=hold/danger, blue=info, purple=role/locked). Reuse one `<Badge tone>` component. |
| **Toggle switch** | `.hold-toggle` (pill, sliding knob) | Used for both **Hold** and **EOBI on/off** — a real component, not a native checkbox, because it needs to read as a physical on/off affordance for a non-technical user. The Hold toggle is disabled (not just visually, but request-rejected server-side) once the row is released — hold has no correctable path, it simply freezes along with every other field at that point. |
| **Stat card** | `.stat-card` | Flat card, color only in the value. |
| **Multi-select filter** | `.multiselect` + checkbox panel | A genuinely reusable component — used identically in Payroll Entry, Release Salary, and Fines & EOBI Report. Build once as `<SiteMultiSelect>` with Clear/Done actions, not copy-pasted per page. |
| **Inline-editable table cell** | `.inline-edit` | Bordered-on-hover/focus number input that otherwise reads as plain table text; `.deduct` modifier tints red for deduction-type fields (advance, eid, fine). This is the core interaction of Payroll Entry — pair with TanStack Table's cell-editing pattern and TanStack Virtual for row virtualization at ~1,500 rows. |
| **Table** | `table.data-table` | `frontend/src/components/ui/table.tsx`'s `<Table density="standard"\|"compact">` (§1.5) — the shared density system every table in the app (except Payroll Entry's own custom grid) is built on. Buttons/badges/checkboxes inside a cell are always vertically centered (`align-middle`), regardless of density. |
| **Row action menu (`⋯`)** | n/a (Employee Registry's own pre-existing pattern, formalized as a reusable convention — Employee Row Actions, UAT 2026-08-11) | A compact `MoreHorizontal` icon-button trigger opening a `<DropdownMenu>` (`components/ui/dropdown-menu.tsx`, Radix), always the row's **last/far-right column** — never before an identity column, never a floating/hovering control, never permanently expanded. Accessible name `"<Action noun> for <row's own identifying name>"` (e.g. `"Employee actions for Jane Doe"`); no menu item communicated by icon/color alone. When the row's own action requires a permission the current user lacks, the trigger renders nothing at all (never a visible-but-dead/403-on-click action) — the column's width slot still renders, empty, matching this same convention in every table that uses it. **Sticky-right is the deliberate exception, not the default**: a normal in-flow final column is correct for an ordinary `<Table>` (Employee Registry's own usage); only promote it to `position: sticky; right: 0` with an explicit opaque background matching the row's own (never inherited) when the table is wide enough that the action would otherwise sit behind a full horizontal scroll on every row (Payroll Entry's own ~26-column, 2,300px+ grid — `columns.ts`'s `ACTIONS_COLUMN_ID`/`stickyActionsCellClassName`) — decide per table, document the judgment call, don't apply it reflexively. |
| **Drag handle / row reorder** | `.drag-row`, `.drag-handle` | Native HTML5 drag events in the prototype; use a library (e.g. dnd-kit) in production for accessibility and touch support. |
| **Modal** | `.modal-overlay` / `.modal` | Fixed 3-part structure: header (title + close), body (20px padding), footer (right-aligned actions, Cancel always secondary/left, primary action right). Widths vary by content (420px small confirs, 520–580px default, 620px employee form) — treat width as a prop, structure as fixed. |
| **Toast** | `.toast` | Bottom-right, ~3.2s auto-dismiss, used for *every* non-destructive confirmation instead of `alert()`. High-stakes actions (release, correction, delete) use a modal with explicit confirmation instead of a toast. |
| ~~Floating action button (FAB)~~ **— superseded, UAT 2026-08-10** | `.quick-add-btn` (`reference/payroll_prototype.html` only) | **Historical only — never built.** The original spec (`reference/PROJECT_SPEC.md` §"Payroll Entry") actually called for Quick Add Employee as *two redundant entry points together* — "both a toolbar button and a floating action button, Zoho-inventory-style" — and the earliest static prototype (`reference/payroll_prototype.html`) built both halves (a `.btn-secondary` toolbar button *and* the `.quick-add-btn` FAB, both opening the same `emp-modal`). Only the FAB half was dropped before the phase-by-phase prototypes that actually drove implementation (`docs/prototypes/phase3-payroll-entry-preview.html` has no FAB) and was never built in the real app — the toolbar-button half is exactly what UAT 2026-08-10 made explicit and shipped. UAT 2026-08-10 confirmed no floating/hovering employee action exists anywhere in current source: Payroll Entry's "New Employee" is a normal top-level button in its own toolbar (`payroll-page-toolbar.tsx`'s `actions` slot), the same primary-button pattern as Employee Registry's own "New Employee" (row below), opening the exact same shared `EmployeeFormModal`. Do not resurrect the FAB half for this or any future "quick add" action. |
| **Correction diff / compare** | `.correction-compare` | 3-column (old → new) layout with strikethrough old value and colored new value; a dedicated, distinctive component only used in the Correction Workflow — do not generalize it into a generic "diff" component used elsewhere, its visual weight is intentionally reserved for this one high-stakes flow. |
| **Ledger / statement table** | `.statement-table` | Standard accounting convention: credit green right-aligned, debit red right-aligned, bold running balance. Correction-originated rows get a highlighted (amber-tinted) row background and a 🔧 marker — history entries that came from a correction should always be visually distinguishable from ordinary entries. |
| **Printable document** | `.payslip-preview`, `.cash-sheet` | Bordered "paper" card, serif type, tight print-style grid layout, totals row bolded with a top border. These should be built as dedicated print/PDF templates (rendered server-side via Puppeteer), sharing structure but **not** the app's Tailwind component library — they follow print-document conventions, not app UI conventions. The Payslip template needs a slot for an optional **Balance Settlement** line (Balance Salary Payable / Salary Recovery, with its remark) — see `docs/architecture/workflows/corrections-and-balance-adjustments.md` — since a settling Balance Adjustment is paid as part of one combined bank/cash amount but must still be shown as its own line item here. |
| **Slide-out panel** | `.team-panel` → repurposed as the **Tasks Workspace** (revised 2026-07-10 — permanently replaces the Chat/To-Do concept, `docs/architecture/database/tasks.md`) | Fixed-width (340px) right-edge panel, independent scroll region — no tabs needed now that Chat is gone, single-purpose task list. Moved earlier in the roadmap (Phase 3.5, ahead of the original spec's Phase 8/"build last" placement) — no chat, messaging, comments, attachments, subtasks, Kanban view, or recurring tasks; intentionally lightweight. |
| **Empty state** | e.g. Payslip/Employee profile placeholder | Centered icon + one-line message, used any time a list/detail view has nothing selected or nothing to show. Keep this one consistent pattern everywhere rather than ad hoc "No data" text. |
| **Payroll Cycle selector** | `<PayrollCycleSelectField>` + `<PayrollCycleStatusBadge>` | One shared component pair (§2.6) driving `/payroll-cycles/:cycleId/...` navigation on 5 pages — build once, do not let any page grow its own local cycle `<select>` again. |

---

## 4. UI Conventions

- **Icons (formalized Post-Phase-5 Stabilization Checkpoint 2, AUD-006): Lucide monochrome icons
  only, everywhere — no emoji, no platform-dependent pictographs, no second icon library.** This was
  already true of the live React app (`lucide-react`, e.g. `nav-config.ts`'s
  `LayoutDashboard`/`ClipboardList`/`Banknote`/`Landmark`/`Wallet`/`HandCoins`/`FileText`/`Users`/
  `Building2`/`UserCog`); Checkpoint 2 brought every `docs/prototypes/*.html` file into line with it,
  replacing every emoji glyph with an inline monochrome SVG using the identical Lucide path data
  (`stroke="currentColor"`, no external request, no build step required to render a static
  preview file). A prototype's close/remove affordance uses the same `X` icon the shared `Modal`
  uses — never a text `✕` glyph (also fixed in the live app itself,
  `split-work-lines-modal.tsx`'s per-line remove button).
- **Numbers**: always formatted with `Intl.NumberFormat('en-US')` — international grouping
  (`100,000`), never lakh-style (`1,00,000`). Currency values are prefixed `PKR`. This was corrected
  multiple times during the original design conversation with the client — treat it as a strict,
  tested requirement (a unit test asserting the formatting output belongs in the test suite), not a
  style nicety.
- **Dates (added 2026-07-03): every user-facing date is displayed as `DD-MM-YYYY`, everywhere, with
  no exception.** This applies to every table cell, form field, PDF/Excel export, and future
  Payslip/Statement of Account — the database and API continue to use ISO (`date`/`timestamptz`,
  `YYYY-MM-DD` strings) internally, unchanged; this is purely a presentation convention, exactly like
  the Numbers rule above, and should get the same treatment: one shared `formatDate()` utility (in
  `shared/src`, alongside the number-format utility already called for in
  `docs/architecture/folder-structure.md`) used everywhere a date is rendered, never a one-off
  `.slice(0, 10)` or ad hoc formatting per page. **Implementation note, not yet resolved**: a native
  `<input type="date">` renders its own calendar/text in the browser's OS locale, which the app cannot
  override — so relying on native date inputs cannot *guarantee* a user actually sees `DD-MM-YYYY`
  while typing/picking a date, only when it's displayed back in a table or export. Reliably enforcing
  `DD-MM-YYYY` end-to-end, including inside the input control itself, likely requires a custom
  masked/formatted date input component rather than a bare native input — this should be built once,
  shared, and reused everywhere a date is entered (Employee Registry today; Payroll Entry, Advances,
  and Corrections in later phases), the same way Modal/Table/Badge already are.
- **Confirmation weight matches stakes**: routine saves/edits → toast. Bulk or destructive actions
  (Release All, Hold All, deleting a site) → toast is acceptable only when the action is easily
  reversible; anything touching a released/locked salary → modal with explicit reason/approval,
  never a toast.
- **Locked-state affordance**: once a salary is released, its fields still *look* editable but
  editing routes through the Correction modal rather than silently saving — the UI should never let
  a locked-month edit appear to "just work" the way an unlocked one does.
- **Derived/read-only views say so**: Bank Sheet and Cash Sheet are never allowed to grow a stray
  editable field — if a future report or view is read-only-by-design, it gets the same banner
  treatment, not just disabled inputs.
- **Site-filtering is multi-select everywhere it appears**, never a single dropdown — this was an
  explicit client requirement ("Excel-like filter"), not an inconsistency to "simplify" away.
- **A settling Balance Adjustment is one combined payment, never a second bank transfer.** Bank
  Sheets and Cash Receiving Sheets show exactly one row/amount per employee (net salary ± any
  settling Balance Adjustment) — the breakdown is shown separately on the Payslip and the Statement
  of Account, never as a second row in the same payment sheet. See
  `docs/architecture/workflows/corrections-and-balance-adjustments.md`.
- **A departed employee appearing in payroll solely to settle a pending balance is visually flagged**
  — a computed "Final Settlement" badge (derived from `Employee.dateOfLeaving`, not a stored field),
  so it never reads as an ordinary active employee's monthly pay.

---

## 5. Notes for Implementation

- Design tokens (Section 1) become Tailwind theme values (`tailwind.config` `extend.colors`, backed
  by CSS variables for `accent`/`accent-light`/`accent-mid` specifically, so the Theme settings tab
  can swap them at runtime without a rebuild).
- Components in Section 3 should each become one shared React component under a common component
  directory, used everywhere the pattern recurs — the prototype repeats markup per page because it's
  a single static file; production should not repeat this markup.
- The printable-document components (payslip, bank sheet, cash sheet, statement) are a separate,
  smaller design system of their own (serif, print conventions) and should live in their own
  template directory, rendered server-side for PDF generation and reused (not re-implemented) for
  any in-app print preview.
