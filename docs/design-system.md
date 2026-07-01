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
| `text-faint` | `#9C978F` | Placeholder text, disabled, tertiary hints |
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

---

## 2. Layout Patterns

### 2.1 App Shell

- **Fixed left sidebar**, 220px, solid `accent` background (dark), full viewport height. Contains, top to bottom: company name/logo block, a scrollable nav grouped into labeled sections (Overview / Payroll / Employees / Admin), and a pinned footer with the current user's avatar, name, and role.
- **Main area** offset by `margin-left: 220px`, containing a **sticky topbar** (56px) and a scrollable content region.
- **Topbar**: page title + subtitle on the left, contextual global actions on the right (current month badge, Import/Export, New Payroll Cycle). The right-hand action set is the one region of the topbar that changes meaning slightly per page context — the title/subtitle should always describe the active page.
- **Nav item states**: default (70% white text), hover (8% white bg), active (12% white bg + left accent border + full-white text + medium weight). Badge counts (e.g. pending Payroll Entry count) sit right-aligned on the nav row.

In production this shell maps to a persistent layout route (e.g. a React Router layout route) — the
prototype's `.page` / `.page.active` show/hide toggling should **not** be replicated; use real
client-side routes so URLs, back/forward, and deep-linking work.

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

A consistent horizontal pattern across Payroll Entry, Release Salary, Fines & EOBI Report, and Bank
Sheet: left-aligned label+control groups (`filter-group` = uppercase micro-label above a select/
input), primary action buttons pushed to the far right via `margin-left: auto`. Never mix filters
and actions without this left/right split — it's what keeps dense toolbars scannable.

### 2.5 Read-Only Page Banner

Bank Sheets and Cash Receiving Sheet each open with a colored info banner (🔒 read-only) explaining
*why* there's no data entry here and *where* to go to change something. Any future read-only/derived
view (e.g. a new report) should carry the same banner convention rather than silently disabling
inputs.

---

## 3. Components

| Component | Prototype reference | Notes for implementation |
|---|---|---|
| **Button** | `.btn`, variants `primary/secondary/green/amber`, size `sm` | 5 variants × 2 sizes covers the whole app. Build as one `<Button variant size>` component, not ad hoc classes per page. |
| **Badge / status pill** | `.badge-{green,amber,red,blue,purple,gray,hold}` | Semantic, not decorative — color always maps to the same meaning app-wide (green=released/positive, amber=pending, red=hold/danger, blue=info, purple=role/locked). Reuse one `<Badge tone>` component. |
| **Toggle switch** | `.hold-toggle` (pill, sliding knob) | Used for both **Hold** and **EOBI on/off** — a real component, not a native checkbox, because it needs to read as a physical on/off affordance for a non-technical user. The Hold toggle is disabled (not just visually, but request-rejected server-side) once the row is released — hold has no correctable path, it simply freezes along with every other field at that point. |
| **Stat card** | `.stat-card` | Flat card, color only in the value. |
| **Multi-select filter** | `.multiselect` + checkbox panel | A genuinely reusable component — used identically in Payroll Entry, Release Salary, and Fines & EOBI Report. Build once as `<SiteMultiSelect>` with Clear/Done actions, not copy-pasted per page. |
| **Inline-editable table cell** | `.inline-edit` | Bordered-on-hover/focus number input that otherwise reads as plain table text; `.deduct` modifier tints red for deduction-type fields (advance, eid, fine). This is the core interaction of Payroll Entry — pair with TanStack Table's cell-editing pattern and TanStack Virtual for row virtualization at ~1,500 rows. |
| **Drag handle / row reorder** | `.drag-row`, `.drag-handle` | Native HTML5 drag events in the prototype; use a library (e.g. dnd-kit) in production for accessibility and touch support. |
| **Modal** | `.modal-overlay` / `.modal` | Fixed 3-part structure: header (title + close), body (20px padding), footer (right-aligned actions, Cancel always secondary/left, primary action right). Widths vary by content (420px small confirs, 520–580px default, 620px employee form) — treat width as a prop, structure as fixed. |
| **Toast** | `.toast` | Bottom-right, ~3.2s auto-dismiss, used for *every* non-destructive confirmation instead of `alert()`. High-stakes actions (release, correction, delete) use a modal with explicit confirmation instead of a toast. |
| **Floating action button (FAB)** | `.quick-add-btn` | Circular, accent-colored, bottom-right, hover tooltip. Reserved for the single highest-frequency creation action per page (Quick Add Employee). |
| **Correction diff / compare** | `.correction-compare` | 3-column (old → new) layout with strikethrough old value and colored new value; a dedicated, distinctive component only used in the Correction Workflow — do not generalize it into a generic "diff" component used elsewhere, its visual weight is intentionally reserved for this one high-stakes flow. |
| **Ledger / statement table** | `.statement-table` | Standard accounting convention: credit green right-aligned, debit red right-aligned, bold running balance. Correction-originated rows get a highlighted (amber-tinted) row background and a 🔧 marker — history entries that came from a correction should always be visually distinguishable from ordinary entries. |
| **Printable document** | `.payslip-preview`, `.cash-sheet` | Bordered "paper" card, serif type, tight print-style grid layout, totals row bolded with a top border. These should be built as dedicated print/PDF templates (rendered server-side via Puppeteer), sharing structure but **not** the app's Tailwind component library — they follow print-document conventions, not app UI conventions. The Payslip template needs a slot for an optional **Balance Settlement** line (Balance Salary Payable / Salary Recovery, with its remark) — see `docs/architecture/post-release-corrections.md` — since a settling Balance Adjustment is paid as part of one combined bank/cash amount but must still be shown as its own line item here. |
| **Slide-out panel** | `.team-panel` (Chat/To-Do) | Fixed-width (340px) right-edge panel, tabbed body, independent scroll region. Explicitly lower priority per the spec — build last. |
| **Empty state** | e.g. Payslip/Employee profile placeholder | Centered icon + one-line message, used any time a list/detail view has nothing selected or nothing to show. Keep this one consistent pattern everywhere rather than ad hoc "No data" text. |

---

## 4. UI Conventions

- **Numbers**: always formatted with `Intl.NumberFormat('en-US')` — international grouping
  (`100,000`), never lakh-style (`1,00,000`). Currency values are prefixed `PKR`. This was corrected
  multiple times during the original design conversation with the client — treat it as a strict,
  tested requirement (a unit test asserting the formatting output belongs in the test suite), not a
  style nicety.
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
  `docs/architecture/post-release-corrections.md`.
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
