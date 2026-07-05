# Authentication & Access Control

## Session Strategy: express-session + PostgreSQL

Authentication uses **express-session** with **connect-pg-simple** as the session store, persisting
sessions in the same PostgreSQL database rather than introducing Redis at this stage.

**Why Postgres over Redis for sessions, for now:** the expected user count is small (single-digit to
low-double-digit staff accounts — Master User, Payroll Staff, and Finance per site). Session read/write
volume at this scale doesn't justify an additional piece of infrastructure to operate and back up.
One database to manage, back up, and monitor is simpler than two.

**Why server-side sessions over stateless JWTs:** when Master User deactivates a user, that access
must disappear immediately. A server-side session can be deleted on deactivation and the next request
fails auth instantly. A stateless JWT would keep working until it expires unless a separate
revocation-list mechanism is built — which is just a session store by another name, with more moving
parts.

**Session cookie configuration:**
- `httpOnly` — not accessible to client-side JavaScript, mitigating XSS-based session theft.
- `secure` — sent only over HTTPS (enforced in all non-local environments).
- `sameSite: lax` (or `strict` where it doesn't break legitimate cross-site navigation into the app).
- Rolling expiration — session lifetime extends on activity, so an actively-working user isn't
  logged out mid-task, but an idle session still expires.

## Password Hashing: Argon2

Passwords are hashed with **argon2** (the current recommended default for new systems — memory-hard,
resistant to GPU/ASIC cracking better than bcrypt at equivalent cost settings). No plaintext or
reversibly-encrypted password is ever stored. Password reset (where needed) invalidates all existing
sessions for that user.

## Role-Based Access Control (RBAC)

**Three roles as of 2026-07-05 (Phase 3 architecture review)** — **Master User** (renamed from
"Master Admin," same role, no functional change), **Payroll Staff**, and the new **Finance** role —
modeled as **Role → Permission[]** rather than hardcoded `if (role === 'admin')` checks throughout the
codebase. A permission is checked per route (e.g. `payroll:release`, `sites:manage`, `users:manage`,
`corrections:approve`), and a role is just a named bundle of permissions.

**Why Finance was added, not folded into an existing role:** the new per-Project-Unit release model
(`docs/architecture/data-and-storage.md` §4) introduced a distinct capability — executing a Unit's
release once client funding is confirmed — that is neither Payroll Staff's data-entry role nor Master
User's governance/correction-approval role. Modeling it as its own role (rather than, say, a
`payroll:release` permission bolted onto Payroll Staff) keeps the same clean separation this system
already relies on elsewhere: preparation, execution, and governance are three different people's jobs,
enforceable as three different permission sets rather than one broad "staff" role quietly gaining a
financial capability it shouldn't have.

**Why this matters beyond the current three roles:** Principle 7 (RBAC must never be bypassed) requires
this check to happen consistently, on every request, server-side — a permission-based model makes
"does this route check the right permission" a reviewable, consistent pattern instead of scattered
conditionals that are easy to miss. It also means adding a future role (e.g. an "Employee" role for
Employee Self-Service, or Finance itself) is a data change — a new row in a permissions table — not a
code change scattered across route handlers, exactly as Finance's own addition just demonstrated.

Enforcement is middleware-based: every route that touches payroll, employee, or financial data passes
through a permission-check middleware before reaching its handler. There is no route that relies on
the frontend to hide a button as its only access control.

### Finance's permission set

Site-scoped (below), read-mostly, and deliberately narrow:

- **`payroll:view`** — read-only visibility into Payroll Entry figures, totals, and
  Ready-for-Release status for their assigned sites. Finance can see what it's about to release, but
  cannot edit any payroll field.
- **`payroll:release`** — execute a Project Unit's release (`PayrollUnitRelease`,
  `docs/architecture/database-schema.md` §12b), a Late Entry's own one-off release, and execute an
  approved `CorrectionPayment` (§14a). Also held by Master User (unrestricted, all sites); **not**
  held by Payroll Staff.
- **`bank-sheets:view`** / **`cash-receiving:view`** — view/download the resulting documents for their
  assigned sites, to actually process the payment.
- **Explicitly withheld:** no payroll-edit permission (cannot change any `PayrollEntry` field), no
  `payroll:mark-ready` (cannot mark or un-mark a Unit's `PayrollUnitReadiness` — that stays Payroll
  Staff's/Master User's own signal to Finance, not something Finance sets for itself), and no
  `corrections:approve`/`corrections:reject` (Finance never decides a `CorrectionRequest`, per the
  same separation-of-duties reasoning above).

## Site-Based Permissions

Orthogonal to role: **which project sites** a user may see or act on. Payroll Staff are assigned a
specific set of project sites at account creation (checkboxes, per the original spec). **Finance is
assigned sites the identical way, reusing the same `UserSiteAssignment` table (added 2026-07-05,
Phase 3 architecture review) — no new assignment mechanism was needed, since Finance's scoping model
is the same shape as Payroll Staff's.** Master User has implicit, unrestricted access to all sites and
all employees — none of the scoping below applies to Master User.

**Payroll Staff and Finance are both fully site-scoped, with no exceptions.** This is a final,
approved decision: there is no global employee or payroll access for either role of any kind.

- **View Employees** — a Payroll Staff user may only see employees whose current record is assigned
  to one of their sites.
- **Edit Employees** — same scope: only employees at their assigned sites.
- **Create Employees** — a new employee record's `siteId` must be one of the creating user's assigned
  sites; a Payroll Staff user cannot create an employee at a site they aren't assigned to.
- **Payroll Entry, Advances** — unchanged: scoped to assigned sites, Payroll-Staff-editable, as
  previously documented.
- **Release** — revised 2026-07-05: scoped to assigned sites, but now executed by **Finance**, not
  Payroll Staff (who never held `payroll:release`) — see "Finance's permission set," above. Master
  User retains unrestricted release access on top, same as every other capability.
- **Ready for Release** (`PayrollUnitReadiness`) — set only by Payroll Staff (site-scoped) or Master
  User, never by Finance, which only reads it.

Site-scoping for **Payroll Entry** (and everything derived from it — Release, Bank Sheets, Cash
Receiving, reports) is applied against **`PayrollEntry.siteId`** — the site recorded on that specific
cycle's entry — not `Employee.siteId`. This is deliberate and holds for both the current and any
historical cycle: an employee's *current* site (used for Employee Registry scoping, above) and the
*site a given month's payroll entry was recorded under* are tracked separately and can differ after a
transfer (see `docs/architecture/data-and-storage.md` on `PayrollEntry`'s copied-not-linked site
field). Using `PayrollEntry.siteId` for payroll-data scoping means a transfer never causes an
already-open entry to unexpectedly appear or disappear from a Payroll Staff or Finance user's view
mid-session. **A `PayrollUnitRelease`/`PayrollUnitReadiness` row (added 2026-07-05) is scoped by its
`unitId`'s owning `ProjectSite`** — the same site-scoping check applies to Finance's release action as
already applies to Payroll Staff's data-entry access, just against a different permission
(`payroll:release` vs. the payroll-edit permissions).

This is enforced as a second middleware layer, independent of the permission check: it injects an
allowed-site-ids filter into the query layer for **every** Employee, Payroll Entry, Advance, and (added
2026-07-05) Project Unit release/readiness route, and every write path additionally validates
server-side that the target site is one of the requesting user's assigned sites — a Payroll Staff or
Finance user cannot retrieve or write another site's data by manipulating a request parameter, and
cannot re-assign an employee, entry, or release action to a site outside their assignment. The
filter/validation is applied server-side regardless of what the client sends.

## CSRF Protection

Cookie-based sessions (as opposed to bearer tokens sent in an `Authorization` header) reintroduce
CSRF exposure: a malicious page could otherwise cause a logged-in user's browser to submit a
state-changing request unintentionally. Mitigation: a synchronizer/double-submit CSRF token is
required on all state-changing (`POST`/`PUT`/`PATCH`/`DELETE`) requests, issued to the client on
login and validated server-side on each such request. This is a direct, necessary consequence of
choosing sessions over stateless tokens and must not be treated as optional.

## Session Expiration

- **Idle timeout**: a session expires after a period of inactivity (rolling window), balancing
  security against the inconvenience of a non-technical user being logged out while mid-task on a
  1,500-row payroll sheet.
- **Absolute maximum lifetime**: even with continuous activity, a session is capped and requires
  re-authentication after a maximum duration, limiting the exposure window of a stolen session
  cookie.
- **Explicit logout** and **admin-triggered deactivation** both immediately invalidate the
  corresponding session row(s) in Postgres — there is no client-side-only logout.

## Future Redis Migration Strategy

Postgres-backed sessions are the deliberate starting point, not a permanent architectural commitment.
If the user base or session-check volume grows to where Postgres session reads become a measurable
load concern (unlikely at the current scale, but the system should not need a redesign if it
happens):

1. Introduce Redis purely as a session store, swapping `connect-pg-simple` for `connect-redis` behind
   the same `express-session` interface — this is a configuration/adapter change, not a rewrite of
   any auth logic, since all auth code interacts with `req.session`, never with the store directly.
2. Redis would also be the natural point of entry for the job-queue seam already anticipated in the
   architecture overview (e.g. BullMQ for background PDF batch generation or biometric-attendance
   sync), meaning if/when Redis is introduced, it serves double duty rather than being added twice.
3. No schema, permission, or site-scoping logic changes as part of this migration — it is isolated to
   the session-store layer by design.
