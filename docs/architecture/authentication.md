# Authentication & Access Control

## Session Strategy: express-session + PostgreSQL

Authentication uses **express-session** with **connect-pg-simple** as the session store, persisting
sessions in the same PostgreSQL database rather than introducing Redis at this stage.

**Why Postgres over Redis for sessions, for now:** the expected user count is small (single-digit to
low-double-digit staff accounts — Master Admin plus Payroll Staff per site). Session read/write
volume at this scale doesn't justify an additional piece of infrastructure to operate and back up.
One database to manage, back up, and monitor is simpler than two.

**Why server-side sessions over stateless JWTs:** when Master Admin deactivates a user, that access
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

Two roles at launch — **Master Admin** and **Payroll Staff** — but modeled as **Role → Permission[]**
rather than hardcoded `if (role === 'admin')` checks throughout the codebase. A permission is checked
per route (e.g. `payroll:release`, `sites:manage`, `users:manage`, `corrections:approve`), and a
role is just a named bundle of permissions.

**Why this matters beyond the current two roles:** Principle 7 (RBAC must never be bypassed) requires
this check to happen consistently, on every request, server-side — a permission-based model makes
"does this route check the right permission" a reviewable, consistent pattern instead of scattered
conditionals that are easy to miss. It also means adding a future role (e.g. an "Employee" role for
Employee Self-Service) is a data change — a new row in a permissions table — not a code change
scattered across route handlers.

Enforcement is middleware-based: every route that touches payroll, employee, or financial data passes
through a permission-check middleware before reaching its handler. There is no route that relies on
the frontend to hide a button as its only access control.

## Site-Based Permissions

Orthogonal to role: **which project sites** a user may see or act on. Payroll Staff are assigned a
specific set of project sites at account creation (checkboxes, per the original spec). Master Admin
has implicit, unrestricted access to all sites and all employees — none of the scoping below applies
to Master Admin.

**Payroll Staff are fully site-scoped, with no exceptions.** This is a final, approved decision:
there is no global employee access for Payroll Staff of any kind.

- **View Employees** — a Payroll Staff user may only see employees whose current record is assigned
  to one of their sites.
- **Edit Employees** — same scope: only employees at their assigned sites.
- **Create Employees** — a new employee record's `siteId` must be one of the creating user's assigned
  sites; a Payroll Staff user cannot create an employee at a site they aren't assigned to.
- **Payroll Entry, Advances, Release** — unchanged: scoped to assigned sites, as previously
  documented.

Site-scoping for **Payroll Entry** (and everything derived from it — Release, Bank Sheets, Cash
Receiving, reports) is applied against **`PayrollEntry.siteId`** — the site recorded on that specific
cycle's entry — not `Employee.siteId`. This is deliberate and holds for both the current and any
historical cycle: an employee's *current* site (used for Employee Registry scoping, above) and the
*site a given month's payroll entry was recorded under* are tracked separately and can differ after a
transfer (see `docs/architecture/data-and-storage.md` on `PayrollEntry`'s copied-not-linked site
field). Using `PayrollEntry.siteId` for payroll-data scoping means a transfer never causes an
already-open entry to unexpectedly appear or disappear from a Payroll Staff user's view mid-session.

This is enforced as a second middleware layer, independent of the permission check: it injects an
allowed-site-ids filter into the query layer for **every** Employee, Payroll Entry, and Advance
route, and every write path additionally validates server-side that the target site is one of the
requesting user's assigned sites — a Payroll Staff user cannot retrieve or write another site's data
by manipulating a request parameter, and cannot re-assign an employee or entry to a site outside
their assignment. The filter/validation is applied server-side regardless of what the client sends.

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
