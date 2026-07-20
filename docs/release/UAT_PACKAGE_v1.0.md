# Version 1.0 — User Acceptance Testing (UAT) Package

Release candidate under test: `v1.0.0-rc1`. This package equips a client-side tester (non-developer)
to validate Version 1.0 against real business expectations before production go-live.

## 1. UAT scope

In scope (Version 1.0 — see `RELEASE_SCOPE_v1.0.md` for the full statement): authentication/roles,
Employee Registry + import/export, Project Sites/Units/Banks, Payroll Cycles, Payroll Entry (incl.
overtime/deductions/Work Lines), per-Unit Release, Bank Sheets, Cash Receiving Sheets, Payslips,
Historical Payroll, Cycle Finalization, Archive-and-Create-Next, Backup Packages, Corrections
workflow, Review Queue, Balance Adjustments, Advances, Tasks Workspace.

Out of scope — do not file defects against these, they are intentionally not built yet: Employee
Statements, Fines & EOBI Report, Dashboard, a dedicated Audit Log browsing screen, and anything
described in `KNOWN_ISSUES_v1.0.md` as already identified.

## 2. Tester roles needed

| Role | Purpose in UAT | Minimum testers |
|---|---|---|
| Master User (Master Admin) | Full-system flows: site/employee/user setup, cycle lifecycle, corrections approval, backups | 1 |
| Payroll Staff | Site-scoped payroll entry, import/export | 1 (ideally assigned to only one site, to test the boundary) |
| Finance | Salary release | 1 |
| Reviewer | Correction approval boundary (approves without payroll-entry access) | 1 (optional but recommended — exercises a specific access boundary) |

A single tester can play multiple roles across separate logins if headcount is limited, but the
site-scoping and reviewer-boundary scenarios (6.x below) specifically need *not* being Master Admin
to mean something.

## 3. Environment

- A dedicated UAT deployment, isolated from any real production data — synthetic/anonymized data
  only (see §5).
- Provide testers: the UAT URL, and their own individual login credentials (never a shared account —
  the Audit Log attributes every action to the logged-in user, and shared logins defeat that).
- Confirm before starting: clean database, all 18 migrations applied, seed data present, production
  build running (not a dev server) — see `RC1_VALIDATION_REPORT.md` for how this was validated.

## 4. Test accounts

**Do not commit real passwords to this document or any other committed file.** Provision UAT
accounts via the documented seed override mechanism:

```bash
SEED_MASTER_ADMIN_EMAIL="<uat-admin-email>" \
SEED_MASTER_ADMIN_PASSWORD="<a fresh, random password — share out-of-band, e.g. a password manager or a call>" \
npm run prisma:seed --workspace backend
```

Create the Payroll Staff/Finance/Reviewer accounts through the running application itself (User
Management, as the Master User) once logged in — this also exercises that feature as part of UAT
Scenario 1.

## 5. Test data guidance

- Use realistic but entirely fictional data: no real employee CNICs, names, bank account numbers, or
  salaries. Round numbers are fine and easier for testers to sanity-check by hand (e.g. gross pay in
  multiples of 1,000).
- Recommended minimum dataset for a meaningful UAT pass: 2 Project Sites, 2 Project Units per site,
  1 bank plus cash-paid employees, 15–30 employees total (enough to see pagination and multi-site
  filtering without needing the full ~1,500-scale dataset used for `DATA_VOLUME_SANITY_v1.0.md`'s
  performance check, which testers don't need to reproduce).
- If a larger dataset is wanted to also sanity-check performance from the tester's own network/device,
  the same generator approach described in `DATA_VOLUME_SANITY_v1.0.md` can be adapted — coordinate
  with the development team rather than hand-entering hundreds of records.

## 6. Test scenarios and expected results

Each scenario states the role to use, the steps, and the expected result. Testers should log a
defect (§7) for any deviation.

### 6.1 — Setup
1. **Log in** as Master User. *Expected: lands on the app shell, no console errors, session persists on refresh.*
2. **Create a Project Site and two Units.** *Expected: both appear immediately in Employee Registry's site/unit pickers.*
3. **Create a Bank.** *Expected: appears in Employee Registry's bank picker and in Bank Sheet filters.*
4. **Create a Payroll Staff user, assign one site.** *Expected: that user, once logged in separately, sees only that site's employees/payroll — not other sites'.*
5. **Create several Employees** (mix of bank-paid and cash). *Expected: appear in the registry; CNIC/employee-code uniqueness is enforced (try a duplicate CNIC — expect a clear rejection, not a crash).*
6. **Import employees via the official CSV/Excel template; export and re-import to confirm round-trip.** *Expected: import succeeds, export matches what's on screen.*

### 6.2 — Payroll cycle
7. **Create a Payroll Cycle.** *Expected: entries auto-populate for every active employee; only one Draft cycle can exist at a time (try creating a second — expect a clear rejection pointing at Archive-and-Create-Next).*
8. **Edit entries**: add overtime hours, a deduction, an allowance. *Expected: totals recalculate correctly; the entry cannot be over-edited by two people at once without a clear conflict message (stale-version case).*
9. **As Finance, release one Project Unit.** *Expected: that unit's entries lock for direct editing; other units remain editable.*
10. **Generate a Bank Sheet and a Cash Receiving Sheet** (CSV and Excel). *Expected: totals match what's on screen; files open cleanly in Excel.*
11. **Generate a Payslip** for a released employee (single, and as part of a batch). *Expected: PDF opens, shows correct figures, employer/employee identity is correct.*
12. **Finalize the cycle** (after releasing/holding every unit). *Expected: succeeds only once every entry is released or held — try finalizing early and expect a clear rejection listing how many entries are outstanding.*
13. **Archive and create the next cycle.** *Expected: new Draft cycle appears with entries carried forward; the archived cycle becomes read-only; a Backup Package is generated automatically.*

### 6.3 — Historical and corrections
14. **Open the archived cycle from Historical Payroll.** *Expected: read-only, all data intact.*
15. **Request a Correction** on a released entry in that archived cycle. *Expected: appears in the Review Queue.*
16. **As a different user with correction-approval rights, approve it.** *Expected: a Balance Adjustment is created (for a payable/recovery amount) and shows in the Corrections Ledger; the original historical entry itself is unchanged (immutability).*
17. **Materialize the resulting adjustment into the current Draft cycle.** *Expected: appears on that employee's current-cycle entry as a distinct line, not silently merged into gross pay.*
18. **Release that entry; confirm the Balance Adjustment's ledger shows it settled/consumed.**
19. **As the Reviewer-only account, confirm you can approve corrections but cannot open Payroll Entry.** *Expected: a clear "not authorized" experience, not a broken page.*

### 6.4 — Backups and audit
20. **Download a generated Backup Package and open its files.** *Expected: CSV/Excel content matches the live data for that cycle.*
21. **Confirm every action above is attributable** — coordinate with the development team to spot-check the Audit Log for a few of the above actions (no in-app viewer exists yet — see §1's out-of-scope note) and confirm the correct user is recorded for each.

## 7. Defect report template

```
Title:
Scenario # (from §6):
Role used:
Steps to reproduce:
Expected result:
Actual result:
Screenshot/PDF/CSV attached? (yes/no)
Severity (see §8):
```

## 8. Severity definitions

| Severity | Definition |
|---|---|
| **Blocker** | Prevents completing a core scenario in §6 entirely; no workaround. Automatically halts progression from RC1. |
| **Critical** | Wrong financial figures, data loss, broken authorization, or broken historical immutability. Automatically halts progression from RC1. |
| **Major** | A real defect that doesn't meet the Critical bar (e.g. a confusing but non-financial error, a feature that works but with a poor workaround). Requires an explicit release decision — does not automatically block. |
| **Minor** | Cosmetic, wording, alignment, or a low-impact inconvenience with an easy workaround. |
| **Cosmetic** | Visual polish only, no functional impact. |

## 9. Sign-off section

| Scenario group | Tester | Result (Pass/Fail/Blocked) | Date | Notes |
|---|---|---|---|---|
| 6.1 Setup | | | | |
| 6.2 Payroll cycle | | | | |
| 6.3 Historical and corrections | | | | |
| 6.4 Backups and audit | | | | |

**Overall UAT sign-off:**

- [ ] All Blocker/Critical defects resolved or explicitly waived by the client.
- [ ] All Major defects have an explicit release decision recorded.
- [ ] Client representative name, role, and date:
- [ ] Approved to proceed toward `v1.0.0` production cutover: Yes / No / Conditional (state condition)
