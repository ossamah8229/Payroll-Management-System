# Authentication & Access Control

**Owner module(s):** Authentication

**Contains:** Session strategy, password hashing, RBAC rationale, site-based permission scoping, CSRF
protection, session expiration, future Redis migration strategy

**Sections:** — (narrative document, not part of the §-numbered schema/workflow set) · Database
index: `database/README.md` (see `database/access-control.md` for the RBAC schema)

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
- `sameSite: 'none'` in production, `'lax'` in development. The deployed frontend and backend are
  two independent `*.onrender.com` Render services, which browsers treat as cross-*site* (not
  merely cross-origin) because `onrender.com` is registered on the Public Suffix List — a `Lax`
  cookie is never attached to a cross-site `fetch`/`XHR` request (only to top-level navigations),
  so `None` (paired with the already-`true` `secure` flag, which browsers require for `None`) is
  what actually makes the cookie reach the backend on API calls. `'lax'` in development, where the
  Vite dev-server proxy (`frontend/vite.config.ts`) makes the two look same-origin and `'none'`
  would require `secure` over plain HTTP, which browsers refuse. Resolves
  `docs/release/KNOWN_ISSUES_v1.0.md` KI-2.
- Rolling expiration — session lifetime extends on activity, so an actively-working user isn't
  logged out mid-task, but an idle session still expires.

## Password Hashing: Argon2

Passwords are hashed with **argon2** (the current recommended default for new systems — memory-hard,
resistant to GPU/ASIC cracking better than bcrypt at equivalent cost settings). No plaintext or
reversibly-encrypted password is ever stored. Password reset (where needed) invalidates all existing
sessions for that user.

**Session revocation on password change (AUD-009, Post-Phase-5 Stabilization Checkpoint 3).** Both
password-change paths — self-service (`POST /auth/change-password`) and Master Admin's
user-management reset (`POST /users/:id/reset-password`) — invalidate every existing session
belonging to the affected user immediately after the new password is stored, including the
requesting session itself. This reuses the exact mechanism deactivation already relies on (above):
`invalidateAllSessionsForUser` (`backend/src/lib/session-store.ts`) deletes every row in the
connect-pg-simple `session` table whose payload's `userId` matches, straight in Postgres — no
process restart, in-memory cache, or additional session-versioning column required, since sessions
are already looked up fresh on every request (`attachUser`). The next request on any now-deleted
session fails auth immediately, the same "next request fails" guarantee deactivation provides. The
route handler additionally calls `req.session.destroy()` on the current request's own session
(mirroring `/auth/logout`) so that request's own response reflects the invalidation immediately —
clearing the `connect.sid` cookie — rather than only failing on that session's next use. An admin
resetting someone *else's* password keeps their own session; resetting their *own* password
invalidates it too, handled the same way.

## Role-Based Access Control (RBAC)

**Three roles as of 2026-07-05 (Phase 3 architecture review)** — **Master User** (renamed from
"Master Admin," same role, no functional change), **Payroll Staff**, and the new **Finance** role —
modeled as **Role → Permission[]** rather than hardcoded `if (role === 'admin')` checks throughout the
codebase. A permission is checked per route (e.g. `payroll:release`, `sites:manage`, `users:manage`,
`corrections:approve`), and a role is just a named bundle of permissions.

**Why Finance was added, not folded into an existing role:** the new per-Project-Unit release model
(`docs/architecture/workflows/payroll-lifecycle.md` §4) introduced a distinct capability — executing a Unit's
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
  `database/release.md` §12b), a Late Entry's own one-off release, and execute an
  approved `CorrectionPayment` (`database/balance-adjustments.md` §14a). Also held by Master User
  (unrestricted, all sites); **not** held by Payroll Staff.
- **`bank-sheets:view`** / **`cash-receiving:view`** — view/download the resulting documents for their
  assigned sites, to actually process the payment.
- **`payslips:view`** — added Phase 4 Checkpoint 6.1 (2026-07-12). See "Payslips: a dedicated
  permission, not a reuse," below — held here for the same reason as `bank-sheets:view`.
- **Explicitly withheld:** no payroll-edit permission (cannot change any `PayrollEntry` field), no
  `payroll:mark-ready` (cannot mark or un-mark a Unit's `PayrollUnitReadiness` — that stays Payroll
  Staff's/Master User's own signal to Finance, not something Finance sets for itself), and no
  `corrections:approve`/`corrections:reject` (Finance never decides a `CorrectionRequest`, per the
  same separation-of-duties reasoning above). **Added 2026-07-08:** the same withholding covers
  Advance Deduction Deferral (`docs/architecture/workflows/payroll-lifecycle.md` §4,
  `database/advances.md` §15/§15a) — deferring a scheduled deduction is a payroll-edit
  action (it mutates a `PayrollEntry` field), not a release action, so it requires the payroll-edit
  permission Finance does not hold.

### Payslips: a dedicated permission, not a reuse

**Added Phase 4 Checkpoint 6.1 (2026-07-12).** `payslips:view` is granted to all three roles —
Master User, Payroll Staff, and Finance — but is deliberately its own permission key, not a reuse of
`payroll:entry`, `payroll:view`, or `bank-sheets:view`. Rationale: an individual Payslip discloses one
employee's own net-salary breakdown, a materially more sensitive per-person view than any aggregate
sheet those other permissions already gate; neither existing key cleanly covers "whoever should see
an individual Payslip" (Payroll Staff holds `payroll:entry` but not `bank-sheets:view`; Finance holds
`payroll:view`/`bank-sheets:view` but not `payroll:entry`). Payroll Staff is granted it because it
already prepares and sees individual payroll detail; Finance because it handles released salary
outputs. Site-scoped identically to every other permission in this document — see "Site-Based
Permissions," below. Gates view, print, export, and download uniformly; there is no separate
"generate" action, since a Payslip is never persisted (derived on demand from released `PayrollEntry`
data, `docs/PROJECT_PRINCIPLES.md` Principle 1).

**Extended Phase 4 Checkpoint 6.3 (2026-07-13) — batch/ZIP generation is covered by this same
permission, no new key.** `POST /payroll-cycles/:cycleId/payslips/batch` requires `payslips:view`
identically to the individual list/detail/PDF routes; there is no separate "batch export" or
"bulk download" permission. Site scope and the released/non-held gate are enforced the same way for
every employee in a batch request as they are for a single one — a batch is simply many individual
Payslip reads assembled together, not a distinct capability.

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
  previously documented. **Added 2026-07-08:** Advance Deduction Deferral is exercised through the
  same Payroll-Entry-edit permission and site scope — no new permission was introduced for it, and no
  separate scoping dimension exists beyond the entry's own site, matching how Work Line splitting
  (§12a) needed no unit-level RBAC of its own either.
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
transfer (see `database/payroll-entry.md` §12 on `PayrollEntry`'s copied-not-linked site
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

## Tasks: ownership-based visibility (an exception to site-scoping)

**Added 2026-07-10 (Phase 3.5 architecture revision).** `Task` (`database/tasks.md` §27) is visible
only to Master User and the one user recorded in `Task.assignedToUserId` — no one else, under any
circumstance. This is a genuinely different access-control shape from every other rule on this page,
and is called out explicitly so it is never mistaken for a variant of the site-scoping model above:

- **It is not site-based.** A Payroll Staff or Finance user's site assignment has no bearing on which
  tasks they can see — a task has no `siteId` at all, and none is ever added to give it one.
- **It is not role-based.** There is no "Payroll Staff can see Payroll Staff's tasks" or
  "Finance can see Finance's tasks" concept. Visibility is per-row: exactly Master User, plus whichever
  single user that specific row names as assignee. A Payroll Manager's tasks are invisible to Finance,
  and vice versa, purely because neither is the named assignee — not because of any role check.
- **Enforcement is an ownership check at the query/service layer** — `WHERE assignedToUserId =
  :currentUserId OR :currentUserIsMasterUser` — never the `assertSiteAccess()`-style site-scoping
  middleware used for Employee/Payroll Entry/Advances/Release above. Do not add site-scoping to Tasks;
  it does not apply and must not be introduced by habit.
- **Permissions**: exactly one new permission, `tasks:manage` (`PERMISSIONS.TASKS_MANAGE`), held only
  by Master User via the existing `Object.values(PERMISSIONS)` wildcard grant — gates create, assign,
  reassign, edit (title/description/priority/due date), delete, cancel, and reopen. An assignee needs
  **no permission at all** beyond being authenticated to view their own tasks and mark them complete —
  the same shape as the existing self-service `PATCH /api/v1/auth/me` path, gated by identity, not a
  permission grant.
- **No new role was introduced, and none is needed** — this fits inside the existing Master User /
  Payroll Staff / Finance model without adding a fourth.

## Post-Phase-5 Stabilization Checkpoint 4B — Authorization Remediation

A validation checkpoint (4B) exercised the RBAC model above across every seeded role plus a
synthetic reviewer, both through the UI and by calling the API directly. This section records the
fixes that followed and the decisions behind each.

### Corrections requester/reviewer separation

`assertNotSelfReview` (`backend/src/modules/corrections/corrections.service.ts`) rejects (403,
`SELF_REVIEW_NOT_ALLOWED`) any attempt to approve or reject a `CorrectionRequest` where
`currentUser.id === request.requestedById`, checked before any mutation in both
`approveCorrectionRequest` and `rejectCorrectionRequest` (and re-checked after the per-entry
advisory lock, the same defense-in-depth double-check this module already applies to
`REQUEST_NOT_PENDING`). The check is a plain id comparison — never a role name, role code, or
permission combination. Today this can only ever fire for Master User, the only seeded role holding
both `payroll:entry` and `corrections:approve`; it exists so that a future administrator-defined
role combining the two doesn't silently inherit a self-approval path nobody designed. The frontend
(`correction-request-detail-page.tsx`'s `isOwnRequest`) hides Approve/Reject for the requester and
explains why, as a usability layer only — the backend guard above is what's actually authoritative.

### Frontend page-level authorization

Every authenticated route in `App.tsx` is now wrapped in `RequirePermission`
(`frontend/src/components/layout/require-permission.tsx`) in addition to the existing
`RequireSession`, so a route's own permission requirement is checked before its page component ever
mounts — not left to the page's own data fetch to fail after the fact. `RequirePermission` accepts
either a single permission or a list (any-of, the same semantics and shape as `nav-config.ts`'s own
`NavItem.requiredPermission`) or an explicit `allOf` list, and renders the shared `AccessDeniedPage`
in place of the page when the check fails. The actual decision is the plain, unit-tested
`isAuthorizedFor` function (`lib/permissions.ts`) — this codebase's established testing convention
is logic-only tests, never component rendering (`frontend/vitest.config.ts`), so the guard's
correctness is verified by testing that function directly. **This remains a usability and clarity
layer only** — every permission it checks is already, independently enforced by the backend's own
`requirePermission` middleware and, where applicable, site-scope middleware; removing
`RequirePermission` would make the UI less helpful, never less secure.

Route-to-permission mapping is derived directly from each route's own backend enforcement and from
`nav-config.ts`'s existing sidebar-visibility mapping, so the two can't drift apart. `/settings`
deliberately carries no route-level permission requirement — `GET /settings/company` is
intentionally open to any authenticated user (`settings.routes.ts`'s own documented decision), and
`SettingsPage` already gates its own edit controls per-section (`canManage`/`canManageBanks`).

### Project-sites read authorization

`GET /api/v1/sites` and `GET /api/v1/sites/:id` previously carried no permission gate at all — any
authenticated user, regardless of role, could reach the Project Sites admin page directly and
receive whatever `listProjectSites` returned for them. That service function already scope-filtered
correctly (Master User sees every site; everyone else only their own `UserSiteAssignment` rows) —
the missing piece was purely the permission check in front of it.

The fix is an any-of `requirePermission` gate (`SITE_LOOKUP_PERMISSIONS`,
`project-sites.routes.ts`), deliberately **not** `sites:manage` alone: this endpoint is the shared
site lookup nearly every operational page depends on for a dropdown or filter (Employee Registry,
Payroll Entry, Salary Release, Bank Sheet, Cash Receiving, Advances, Payslips, Corrections, User
site-assignment). The permission list was built from a grep-verified inventory of every real
frontend consumer of `useProjectSites()` — `sites:manage`, `employees:view/create/edit`,
`payroll:entry`, `payroll:view`, `payroll:release`, `bank-sheets:view`, `corrections:approve`,
`advances:manage`, `payslips:view`, `users:manage`. A permission with no current site-data consumer
(`banks:manage`, `settings:manage`, `audit-log:view`, `tasks:manage`) is deliberately excluded
rather than added speculatively. The Project Sites *administration* page itself
(`project-sites-page.tsx`) still requires `sites:manage` specifically, at the route-guard layer
described above — this endpoint's broader gate is about the shared *lookup*, not the admin page.

### Role names remain unsuitable for business authorization

Checkpoint 4B's discovery phase found role **codes** (never role display names) hardcoded in a
handful of places as an explicit "Master User is unrestricted" bypass
(`require-site-access.ts`, `project-sites.service.ts`, `users.service.ts`, `employees.service.ts`'s
`isMasterAdmin`, `tasks-panel.tsx`'s `isMasterUser`) and one hardcoded three-value `roleCode` enum
(`shared/src/schemas/user.ts`'s `createUserSchema`) that is the actual reason no role beyond the
three seeded ones can be created today. None of these were redesigned in this remediation — doing
so is dynamic-role-administration work (see below), out of this checkpoint's scope. They remain
recorded here as the concrete blockers a future administrator-defined-role system needs to remove:
every one of those role-code comparisons would need to become "does this user hold every
permission" (or a dedicated system-administrator flag) before role names/codes stop being a fixed
assumption anywhere in this codebase.

### Dynamic custom-role administration remains future work

No role CRUD, no permission-matrix UI, no ability to rename a role or change a user's role after
creation, and no multiple-roles-per-user or per-user permission overrides were implemented in this
checkpoint, matching its explicit scope boundary. The schema is already shaped for this (`Role`/
`Permission`/`RolePermission` are real, relational tables, not an enum), so the remaining work is
entirely at the application layer — new `/roles` endpoints, removing the hardcoded `roleCode` enum,
and a role-administration UI — not a schema migration.

### CSRF: known intermittent-login issue is a separate, still-open investigation

A previously logged intermittent "Missing or invalid CSRF token" login failure (cross-site cookie
timing) is **not** addressed by this checkpoint and must not be read as fixed by anything above —
Fix 1 through Fix 5 here touch authorization (permissions, roles, requester/reviewer separation),
not the CSRF double-submit flow itself. That issue remains the next, separate stabilization
investigation.

## CSRF Protection

Cookie-based sessions (as opposed to bearer tokens sent in an `Authorization` header) reintroduce
CSRF exposure: a malicious page could otherwise cause a logged-in user's browser to submit a
state-changing request unintentionally. Mitigation: a synchronizer/double-submit CSRF token is
required on all state-changing (`POST`/`PUT`/`PATCH`/`DELETE`) requests, issued to the client on
first contact and validated server-side on each such request. This is a direct, necessary
consequence of choosing sessions over stateless tokens and must not be treated as optional.

**How the frontend learns the token, given separate origins:** the token still lives in a
`csrf_token` cookie (`backend/src/common/middleware/csrf.ts`), but the frontend does **not** read
that cookie via `document.cookie` — in production, frontend and backend are different Render
services on different origins (`docs/architecture/deployment.md`), and a document can never read a
cookie belonging to another origin; that's the browser's same-origin policy working as intended,
not a bug to route around. Instead, the backend echoes the same token in an `x-csrf-token`
*response* header on every safe (`GET`/`HEAD`/`OPTIONS`) request, and CORS explicitly exposes that
header to the frontend's JS (`exposedHeaders` in `backend/src/app.ts`). `frontend/src/lib/
api-client.ts` captures it from every response and holds it only in module memory (never
`localStorage`/`sessionStorage`, which would be readable by any injected script and would survive
a page reload in a way in-memory state deliberately doesn't) — the session-bootstrap `GET
/api/v1/auth/me` call every page load already makes (`use-session.ts`) is enough to learn the token
before the user submits anything, including the login form itself. `apiRequest` then attaches it as
the `x-csrf-token` request header on every `POST`/`PUT`/`PATCH`/`DELETE`; the handful of callers
that bypass `apiRequest` for file upload/download (`use-employees.ts`, `use-payroll-entries.ts`,
`use-payslips.ts`) call the same `getCsrfToken()` accessor rather than re-reading a cookie.

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
