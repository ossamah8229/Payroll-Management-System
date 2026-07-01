# FTM Payroll Management System — Project Handoff for Claude Code

## Context for Claude Code

This document summarizes a design/requirements conversation with Claude (claude.ai) that produced a **working interactive HTML/CSS/JS prototype** — not production code. The prototype (`ftm_payroll_system.html`, included alongside this brief) demonstrates the intended UI, workflows, and business logic using in-memory sample data and no real backend, auth, or persistence.

**Your job:** build the real, production version — proper backend, database, authentication, file generation (PDF/Excel), and a maintainable frontend. **Platform decision is confirmed: this will be a web application** (accessed via browser, not an installed desktop app) — see "Confirmed Technical Direction" below for details and constraints.

Treat the prototype as the **source of truth for UI/UX and business logic**, not as code to extend directly. It's rough single-file HTML meant to validate ideas with the client quickly.

---

## About the Business

The client runs a payroll outsourcing company (Broom Services (Private) Limited) that manages payroll for staff **deputed to client project sites** (e.g., banks like ABL/HBL/MCB, malls, retail outfitters). Key facts:

- **~1,500 employees** across many project sites, high turnover (frequent resignations/replacements)
- Attendance is entered **manually** based on physical attendance records
- Employees are uniquely identified by **CNIC** (Pakistani national ID number) — this is the primary key across the whole system
- Payroll runs **monthly**, needs to be easily repeatable (new cycle each month, carrying forward employee/bank data but resetting attendance)
- Final deliverables each month: a **bank sheet** (submitted to bank + a physical cheque) and a **cash receiving sheet** (for employees without bank accounts) and **payslips**
- Client has **no coding knowledge** — needs a polished, error-resistant, non-technical UI
- Must run cross-platform (Mac + Windows), with data synced across users/devices (payroll staff work from different machines)
- Currency: PKR. **Numbers must display in international format (100,000) not Indian/Pakistani lakh format (1,00,000)** — this was a repeated correction point, verify carefully in whatever library/locale you use.

---

## Core Business Rules (Important — Verified Multiple Times)

1. **Payroll Entry is the single master data source.** Release Salary, Bank Sheets, Cash Receiving Sheets, and Payslips must all be *derived/read-only views* computed from Payroll Entry data — never separately editable. This was an explicit, repeated requirement.

2. **Bank Sheets & Cash Receiving Sheets are strictly read-only.** No data entry fields — only filters (bank, project site) and Download PDF / Download Excel / Print actions. They should only include employees whose salary has been marked **Released** for that cycle (excluding anyone on Hold).

3. **Once a salary is "Released" for a month, that month's payroll figures are locked.** Any further edit must go through a **Correction workflow**:
   - Editing any field of an already-released employee opens a modal showing old value → new value and old net salary → new net salary side by side.
   - A **reason is mandatory** before the correction can be confirmed.
   - Only the **Master Admin** role can approve/confirm corrections on released salaries.
   - The system auto-classifies the result: if new net < old net → employee was overpaid → amount is queued to auto-deduct from **next month's** payroll. If new net > old net → balance is owed to employee → queued to auto-credit next month.
   - All corrections are logged permanently (date, field changed, old/new value, old/new net, reason, approver) and shown in the employee's **Statement of Account**.
   - When a new payroll cycle is started, any pending correction adjustments (owed or to-deduct) should be automatically carried into the new cycle without manual re-entry.

4. **Hold logic:** Any employee can be individually placed "On Hold" even if the rest of their project site has been released — this must exclude them from Bank Sheet, Cash Sheet, and bulk "Release All," until manually unheld. There's a quick toggle for this directly in Payroll Entry (not just in Release Salary).

5. **EOBI (a Pakistani social security deduction) is NOT a fixed amount for everyone.** It must be:
   - Editable per employee (amount)
   - Toggleable per employee (applicable yes/no) — some employees are exempt
   - Settable at employee creation (Quick Add / Add Employee) as well as edited later in Payroll Entry

6. **Per-employee variability in pay calculation:**
   - **Salary cycle** (days used as denominator for daily rate) varies by project site — some run on 30-day months, some 26-day, some 27-day (seen in real client data). Must be a plain editable number per employee (not a fixed dropdown — client explicitly rejected a dropdown in favor of manual entry).
   - **OT (overtime) rate per hour** varies by site — must be editable per employee, defaulting to a derived rate (gross ÷ cycle days ÷ 8) if left blank.
   - **Leave rate per day** (paid "Claimed Leave") also varies by site — same pattern: editable per employee, defaults to the standard per-day rate if blank.
   - A **"Copy to All" bulk-apply toolbar** exists in Payroll Entry so the admin can set cycle days / OT rate / leave rate once and push it to all *currently filtered* employees (respects the multi-site filter) in one click, rather than editing each employee individually.

7. **Advances (loans) and Eid Advances** can be deducted either in full in one payroll cycle, or **in installments across multiple months** — client enters the installment amount manually each month (no auto-calculation of installment size was wanted), but the system should track and display **remaining outstanding balance** so nothing is lost track of. This should be visible both in Payroll Entry (small balance indicator under the advance/eid input) and in the Advances tab.

8. **Multiple bank accounts:** Employees can hold accounts at any of **3 banks** (client's real data shows ABL, HBL, MCB). Bank Sheets are generated per-bank, per-project-site (filterable), so multiple sheets get produced and submitted separately.

9. **Employees without a bank account** must automatically fall into the **Cash Receiving Sheet** instead of a bank sheet — this is determined automatically (bank + account number both present = bank sheet; otherwise = cash sheet), not manually flagged.

10. **Filtering must support multi-select**, not just one project site at a time (client explicitly wanted an "Excel-like filter" — implemented as a checkbox multi-select dropdown) — used in Payroll Entry, Release Salary, and the Fines/EOBI report.

11. **Fines, EOBI exemptions, holds, and active advances need "at-a-glance" visibility** — client doesn't want to hunt through individual employee records to find "who was fined this month" or "whose EOBI is exempt." A dedicated report page fulfills this, filterable by site.

12. **Statement of Account** — inside each employee's profile, a ledger-style statement (date, description, credit, debit, running balance) covering salary earned, EOBI, advances, fines, and any corrections (with reasons) — modeled after a typical bank/vendor statement of account.

13. **CNIC-based employee lookup** — searching/selecting an employee anywhere in the system should surface: deputed location, full advance history, salary history, bank details, employment dates. High staff turnover means **historical data must be preserved** even after an employee resigns/leaves (DOL — Date of Leaving — field exists for this).

---

## Confirmed Technical Direction

**Platform: Web application, not a desktop app.** The client explicitly decided against Electron.js / installed desktop software after discussing the tradeoffs. Reasoning given: a web app is accessible from any device, anywhere, with no installation and no OS-version compatibility concerns as computers get replaced over time. This removes a whole category of support burden for a non-technical client.

**Client's top priority: speed and reliability, not features.** Direct quote-level concern: *"the app needs to be fast, because the business is time sensitive and cannot have any crashes or lapses."* Payroll is a monthly, deadline-driven process (bank sheets + cheques go out on a schedule) — downtime or slowness during that window is a real business problem, not just an inconvenience. This should weigh heavily on every architecture decision below. The client also said budget for proper hosting is not the limiting factor ("if server space is a constraint, we can always buy a new server hosting") — so don't under-provision to save cost; provision for headroom.

**What this means concretely for the build:**

- **Hosting:** use a reputable managed cloud provider (e.g., AWS, Google Cloud, Azure, or a simpler managed platform like Render/Railway/Fly.io depending on team size and ops appetite) rather than self-managed bare-metal or budget shared hosting. Managed database backups, automatic failover, and uptime SLAs matter here given the "cannot have any crashes" requirement.
- **Database:** PostgreSQL is still the right choice for ~1,500 employees with relational data (employees → payroll cycles → corrections → advances → audit log). At this scale, performance won't be a bottleneck if indexed properly (index on CNIC, employee ID, project site, payroll month at minimum) — the real risk is bad queries (e.g., N+1 queries when rendering the 1,500-row Payroll Entry table), not the database engine itself.
- **Backend:** Node.js remains reasonable, but the framework choice matters less than: proper connection pooling, pagination/virtualization for the large Payroll Entry table (don't render 1,500 editable rows to the DOM at once — this is the single most likely real-world source of a "slow" complaint), and caching for read-heavy views (Dashboard stats, Bank Sheet generation).
- **Frontend:** rebuild as a proper framework-based app (React, Vue, or similar) rather than extending the single-file prototype — this matters for performance at scale (the prototype's naive full-table re-render on every edit will not hold up with 1,500 real rows) and for maintainability.
- **Uptime/reliability practices to build in from day one, not bolt on later:**
  - Automated database backups (daily minimum, ideally more frequent during payroll-processing windows) — payroll correction history and advance balances are exactly the kind of data that's catastrophic to lose.
  - Error monitoring/alerting (e.g., Sentry or similar) so issues are caught before the client notices them, not after.
  - A staging environment separate from production, so changes are tested before touching real payroll data — especially important given how much of this system's value is "we trust the numbers."
  - Autosave / optimistic UI patterns in Payroll Entry so a network hiccup while editing 1,500 rows doesn't lose work.
- **Access control still applies to a web app** — this doesn't change the auth/role requirements described elsewhere in this document, just the delivery mechanism (browser instead of installed app).

---



- **Master Admin** (the client / business owner): full access — release/hold salaries, generate bank/cash sheets, manage project sites, manage users, approve corrections on released salaries, edit company details (name, logo, address — shown on payslips/bank sheets), edit any user's profile.
- **Payroll Staff**: can enter attendance/payroll data (only for their assigned project sites — sites are assignable per user), add/edit employees, record advances. Cannot release/hold salaries, cannot generate bank/cash sheets, cannot manage sites or users, cannot approve corrections on released salaries.
- Each user can customize their own display name, profile picture, password, and a personal theme/accent color (this does not affect other users' views).
- Users are created/assigned by the Master Admin with a specific role and specific project-site assignments (checkboxes).

---

## Official Data Template (extracted from real client files — use exactly these fields)

Client provided multiple real payroll/bank-sheet files during requirements gathering (an Excel payroll sheet, a bank sheet Excel, and PDF payroll formats for different sites). The unified employee data template that emerged, in column order, is:

```
Sr. No | Project | Employee Number/Code | Religion | Name | Father Name | CNIC | DOB | DOJ | DOL |
Mobile Number | Designation | Area | Branch Code | Area/Location | Project Bank | Bank Branch Code |
Account Number | Basic/Gross Pay
```

This exact header set should be used for the **Employee Registry import/export** (identity + employment + bank fields only — no monthly/variable payroll figures).

A **separate Payroll Entry import/export** exists for the monthly variable data:
```
CNIC, Name, Site, Designation, Gross Pay, Days, OT Hrs, OT Rate, Allowance, Leave, Leave Rate,
Cycle Days, EOBI Amount, EOBI On, Advance, Eid Advance, Fine, Hold, Released
```
Import here **must reject/skip rows for already-released employees** (they're locked — see Correction workflow above) and clearly report how many were skipped for that reason.

The **Dashboard-level** Import/Export buttons should ask the user to choose which of the two above they mean (a small chooser dialog), since both exist and are scoped differently.

---

## Sample Payslip Format (client's actual template — must match closely)

```
Salary Slip FTM of: [Month Year]         Pay Period: [Start Date]  [End Date]
                    Broom Services (Private) Limited
Employee Name: [Name]              Father Name: [Father Name]
Account Number: [Account #]        CNIC: [CNIC]
Designation: [Designation]         Deputed Location: [Site]

EARNING                                    DEDUCTION
Description      Days/Hours   Amount       Description            Amount
Basic Pay                     [Gross]      Absent/Late             [Fine]
Working Days      [Days]      [Earned]     EOBI Contribution       [EOBI]
Overtime           [OT Hrs]   [OT Amt]     Advance salaries/loan   [Advance]
Allowance                     [Allowance]  Eid Advance             [Eid Advance]
Claimed Leaves     [Leave]    [Leave Amt]
Total Earning                 [Total]      Total Deduction         [Total]

                    Net Salary: [Net Salary]
```

## Sample Bank Sheet Format (client's actual format)

Columns: `Customer # | Customer ID Card # (CNIC) | Branch Code | Account # | Amount | Title of Account`, with a totals row at the bottom.

## Sample Cash Receiving Sheet Format (client's actual format, from a real Islamabad site PDF)

Columns: `Sr. No | Emp# | Name | Designation | Area | Branch Code | Area/Location | Gross Pay | Total Month Days | Working Days | OT Hrs | OT Amount | Allowance/Arrears | Total Deduction | Net Salary | Signature`, with a totals row.

---

## Full Feature List Built Into the Prototype

- **Dashboard**: summary stats (total employees, total net payroll, total advances, pending releases), per-site payroll summary table, release progress bars, deduction breakdown
- **Payroll Entry** (master data tab): inline-editable spreadsheet-style table — every monthly figure editable directly in the row (gross pay, days, OT hours + OT rate, allowance, leave days + leave rate, cycle days, EOBI amount + on/off toggle, advance, Eid advance, fine, hold toggle); drag-and-drop row reordering; multi-select site filter; search; "Quick Add Employee" (both a toolbar button and a floating action button, Zoho-inventory-style); bulk "Copy to All" for cycle/OT rate/leave rate; Payroll-specific import/export
- **Release Salary**: per-employee release/hold with a visible toggle; bulk "Release All" and "Hold All" scoped to the current site filter; automatically excludes held employees
- **Fines & EOBI Report** (new dedicated page): four panels — employees fined this month, EOBI-exempt employees, salaries on hold, active advances — all filterable by multi-select site
- **Payslips**: employee picker with search, live-rendered payslip matching the client's exact format, download/print actions
- **Bank Sheets**: filterable by bank + site, read-only, shows only released+non-held employees with bank accounts, download PDF/Excel, print
- **Cash Receiving Sheet**: filterable by site, read-only, shows only released+non-held employees without bank accounts, matches the client's real PDF format, download/print
- **Employee Registry**: identity/employment/bank fields only (no monthly figures); employee list + detail profile with **Profile** and **Statement of Accounts** as toggle buttons (not tabs) matching the Payslip button style; CNIC-based search
- **Statement of Accounts** (inside employee profile): ledger view (date/description/credit/debit/running balance), summary cards (total earned/deducted/closing balance), highlights corrections with reasons inline
- **Advances**: table of all advances/Eid advances with remaining balance column; "Record Advance" modal supports "deduct in full" or "deduct in installments" (informational only — actual monthly amount still entered by the admin in Payroll Entry each month)
- **Project Site Management**: add/edit/delete project sites (bank, branch code); delete is blocked if employees are still assigned
- **Settings & Profile**: Company Details tab (name, logo upload, address — Master Admin only, updates payslip header live), My Profile tab (name, photo, password — any user), Theme tab (personal accent color picker)
- **User Management**: list of users with roles and assigned project sites, role permission matrix table, add/edit/deactivate users
- **Audit Log**: chronological feed of major actions (payroll calculated, salaries released, holds placed, sites added, users created, etc.)
- **Team Collaboration panel** (basic version, explicitly lower priority per client): slide-out panel with a Chat tab (simple message feed) and a To-Do tab (checkable task list) — client said this can be refined later
- **Correction Workflow**: triggered automatically when editing any field of a released employee; modal shows before/after comparison, requires a typed reason, classifies as "owed to employee" or "deduct next payroll," logs to the employee's corrections array and Statement of Account; pending adjustments auto-apply when a new payroll cycle is started

---

## Employee Data Model (as implemented in the prototype's JS — use as a reference for your schema design)

```js
{
  id, empCode, name, cnic, father, religion, dob, mobile,
  site, project, desig, joining, dol,
  gross, payType,               // 'Daily wage' | 'Monthly'
  bank, branch, acct, acctTitle,

  // Monthly/variable payroll fields (Payroll Entry owns these):
  days, ot, otRate, allow, leave, leaveRate, cycleDays,
  eobi, eobiOn,
  adv, eid, advBalance, eidBalance,   // advBalance/eidBalance = total outstanding for installment tracking
  fine,
  hold, released,

  // Correction/audit trail:
  corrections: [{ date, field, oldValue, newValue, oldNet, newNet, diff, reason, by, type }],
  pendingAdjustment   // positive = to deduct next cycle, negative = owed to employee next cycle
}
```

**Net salary calculation logic** (implemented in `calcNet()` in the prototype):
```
rate         = gross ÷ cycleDays
earned       = rate × days
otEarned     = ot × (otRate ?? rate÷8)
leaveEarned  = leave × (leaveRate ?? rate)
totalEarning = earned + otEarned + allowance + leaveEarned
eobiAmount   = eobiOn ? eobi : 0
totalDeduct  = eobiAmount + advance + eidAdvance + fine
netSalary    = totalEarning - totalDeduct
```

---

## What Is NOT Yet Done / Open Technical Decisions

This is a prototype only — none of the following exist yet and need to be built:

1. **No real backend or database.** All data currently lives in a JS array in the browser and resets on page reload. Needs: proper schema design (likely PostgreSQL given the ~1,500 employee scale and multi-user concurrent access requirement), API layer, and persistence.
2. **No authentication/authorization.** Login, password hashing, session management, and role-based access control (Master Admin vs Payroll Staff, with per-site assignment restrictions for staff) all need real implementation.
3. **No real file generation.** PDF/Excel downloads are currently just toast notifications ("Bank Sheet PDF downloaded") — real PDF generation (matching the exact payslip/bank sheet/cash sheet formats above) and Excel export need to be built.
4. **No real CSV/Excel import parsing robustness.** The prototype has a basic CSV parser for demonstration; production import needs proper validation, error reporting per row, duplicate detection, and support for actual Excel files (not just CSV).
5. ~~Cross-platform desktop app decision~~ — **RESOLVED, see "Confirmed Technical Direction" section above.** Web app, not Electron.
6. **Team Chat/To-Do is explicitly a low-priority, basic placeholder** — client said this needs refinement later, not urgent for MVP.
7. **Installment advance tracking is manual-entry only by design** (client's explicit choice) — do not build auto-deduction logic for installments; just preserve the balance-tracking display.
8. **Multi-currency was never requested** — system is PKR-only.
9. **No real audit/session logging tied to actual user accounts** — the Audit Log page currently shows static sample entries; needs to be wired to real user actions once auth exists.
10. Verify number formatting library choice enforces `en-US`-style grouping (100,000) — this was corrected multiple times during design and is a strict client requirement.

---

## Files Provided

- `ftm_payroll_system.html` — the full interactive prototype (single-file HTML/CSS/JS, opens in any browser, no build step). This is the UI/UX and business-logic reference. It is NOT production code — it has no backend, no persistence (resets on reload), and uses hardcoded sample data (~16 sample employees) to demonstrate every feature and data relationship described above.

---

## Suggested First Steps for Claude Code

1. Confirm final stack details with the client (web app is decided; propose specific hosting provider, backend framework, and database tier based on the performance/reliability requirements above and get sign-off before heavy build-out).
2. Design the real database schema based on the Employee Data Model above, including a separate `corrections` table and `audit_log` table (rather than embedding as JSON arrays, for real scale).
3. Design user auth + role/site-permission model.
4. Rebuild the UI using the prototype as a pixel/behavior reference, but with a proper component structure instead of a single HTML file.
5. Implement PDF/Excel generation matching the three templates documented above exactly (payslip, bank sheet, cash receiving sheet).
6. Implement the Correction Workflow and pending-adjustment carry-forward as real, persisted logic — this was one of the most emphasized business rules in the whole conversation.
