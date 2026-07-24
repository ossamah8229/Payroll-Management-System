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

**Three roles seeded as of 2026-07-05 (Phase 3 architecture review)** — **Master User** (renamed
from "Master Admin," same role, no functional change), **Payroll Staff**, and **Finance** —
modeled as **Role → Permission[]** rather than hardcoded `if (role === 'admin')` checks throughout the
codebase. A permission is checked per route (e.g. `payroll:release`, `sites:manage`, `users:manage`,
`corrections:approve`), and a role is just a named bundle of permissions.

**As of Administration & Security Management Phase 1, these three are no longer the only roles that
can exist** — a Master User can create, edit, rename, duplicate, and (de)activate additional roles
at runtime, with no source-code or redeployment step; see that phase's own dedicated section below
for the full design. Everything in this section remains true of *every* role, seeded or
administrator-created — the model was already "Role → Permission[]," not fixed `if` statements,
before that phase; it makes that model fully self-service, not built again from scratch.

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

### CSRF: known intermittent-login issue — root-caused here, fixed in Checkpoint 4D

A previously logged intermittent "Missing or invalid CSRF token" login failure (cross-site cookie
timing) is **not** addressed by this checkpoint and must not be read as fixed by anything above —
Fix 1 through Fix 5 here touch authorization (permissions, roles, requester/reviewer separation),
not the CSRF double-submit flow itself. Post-Phase-5 Stabilization Checkpoint 4C root-caused it (a
*different*, concurrent-first-request race, not this checkpoint's cross-site cookie fix — see the
`## CSRF Protection` section below); Checkpoint 4D implemented the fix, in
`backend/src/common/middleware/csrf.ts`.

## Administration & Security Management Phase 1 — Dynamic Roles, Permission Matrix, User Assignment

Removes the operational blocker that previously prevented structured team testing: a Master User can
now create business-specific roles, assign permissions to them from the real permission catalog,
assign those roles to users, and manage user site access — all at runtime, with no source-code
change or redeployment. A dedicated, separate investigation (Post-Phase-5 Stabilization Checkpoint
4C) root-caused the intermittent CSRF login failure beforehand; **this phase does not touch CSRF at
all** — that fix was implemented afterward, as its own separate Checkpoint 4D (see `## CSRF
Protection` below).

### 1. Database-driven roles

`Role`/`Permission`/`RolePermission` were already real, relational tables (Phase 1) — this phase
adds two columns to `Role` (`isActive`, `isSystemRole`) and exposes full CRUD over HTTP
(`/api/v1/roles`), rather than changing the underlying model. A role is administrator-visible data,
not application code, for both the three original seeded roles and any new one.

- **`Role.id`** is the one true, immutable identity — `User.roleId` references it, `AuditLog`
  entries reference role ids (never a denormalized name snapshot), and nothing in this system
  depends on a role's `name` staying constant.
- **`Role.name`** is a free-text, administrator-editable display label. Uniqueness is enforced
  case-insensitively, trimmed, at the service layer (`roles.service.ts`'s `assertNameNotTaken`) —
  never in the database schema directly (a DB round trip is required regardless, to also exclude
  the role being renamed itself).
- **`Role.code`** is a stable, system-generated internal identifier, derived once from `name` at
  creation time (`generateRoleCode`) and never changed by a later rename. It exists only because
  `Role.code` was already a `@unique NOT NULL` column before this phase — a pre-existing constraint
  this phase keeps rather than migrates away from — and it is **never read by authorization logic**
  for a custom role. The one exception, unchanged by this phase, is the small set of legacy
  `roleCode === ROLE_CODES.MASTER_ADMIN` bypass checks documented below.
- **`Role.isSystemRole`** is `true` only for the three seeded roles (set exclusively by
  `prisma/seed.ts`, never by any administration endpoint) — the one authoritative signal that a
  role cannot be deleted. Never inferred from `name` or `code`: renaming a custom role to "Master
  Admin" grants it no special status whatsoever.
- **`Role.isActive`** gates *new* assignment (create-user, reassign-role reject an inactive role)
  and, deliberately unlike this schema's usual `Bank.isActive`/`ProjectSite.isActive` convention of
  "blocks new links, never severs an existing one," also **immediately strips every current
  holder's effective access** — `auth.service.ts`'s `loadSessionUser`/`verifyCredentials` treat
  `!role.isActive` exactly like `!user.isActive`. This is a deliberate deviation, not an oversight:
  a role is a security-sensitive grant, and deactivating it needs to behave like deactivating every
  user who holds it, immediately, not just close the door to new sign-ups.

### 2. One role per user, no per-user overrides, no multi-role system

Unchanged, and explicitly not extended by this phase: `User.roleId` is a single foreign key, never
a join table; there is no per-user permission grant or denial anywhere in the schema or middleware.
If a real, distinct permission combination is needed for one person, the answer is a new role —
never a one-off exception layered onto an existing one. This keeps "what can this person do"
answerable by looking at one role, always, with no per-user asterisk to also check.

### 3. Permission keys drive authorization; role names/labels never do

`requirePermission` and `hasPermission` (frontend) compare permission **keys** only
(`payroll:entry`, `users:manage`, etc.) — never a role name or code. Renaming "Payroll Staff" to
"Salary Team," or "Reviewer" to "Internal Audit," changes zero behavior anywhere in the system,
proven directly by `roles.test.ts`'s "renaming a role does not change its holder's authorization at
all" test. The permission catalog itself (`GET /api/v1/roles/permissions`) is the real `Permission`
table enriched with a shared, purely presentational grouping/label lookup
(`PERMISSION_GROUPS`, `shared/src/constants/permissions.ts`) — grouping is for display only; a
permission with no entry in that lookup still round-trips through the catalog (falls back to an
"Other" group), so the *membership* of the matrix is always database-driven, never a frontend-only
list.

### 4. Seed defaults are bootstrap-only, not runtime authority

`prisma/seed.ts`'s `ROLE_PERMISSIONS` constant is applied **exactly once**, at the moment a seeded
role is first created — re-running seed against a database where that role already exists changes
nothing about its current permissions, name, or description, no matter how far an administrator has
since edited it. The database is the runtime source of truth; the seed script is a bootstrap
convenience, never a reconciliation pass. (Before this phase, the seed script's `upsert`-based
permission grants were additive-only already, but re-running it could still *re-add* a permission an
administrator had deliberately removed from a seeded role — that gap is what this phase closes.)

### 5. Role-change session behavior

Reassigning a user's role, or changing a role's own permissions, **takes effect on that user's very
next request regardless** — permissions are loaded fresh from the database on every request
(`attachUser`/`loadSessionUser`), with no session-side cache to go stale. On top of that
already-immediate effect, **reassigning a user's role also revokes every one of their existing
sessions** (`invalidateAllSessionsForUser`, the same mechanism password reset/change already uses),
requiring an explicit re-login. This was a deliberate choice, not merely "the database reload was
already enough": a role change is security-sensitive enough that a silent same-session permission
swap is the wrong default, even though it would have worked. Editing a role's *permissions* (without
reassigning any user) does **not** revoke sessions — only whose role a user holds is treated as
sensitive enough to force re-authentication; what a role itself grants updates silently and
immediately, matching the checkpoint's own explicit test ("removing a permission from a custom role
takes effect on the very next request, same session").

### 6. The final-active-administrator safeguard

**"Full administrative capability"** is defined as: an *active* user whose *active* role grants
every one of `users:manage`, `settings:manage`, `sites:manage`, and `audit-log:view`
(`CRITICAL_ADMIN_PERMISSIONS`, `shared/src/constants/permissions.ts`). `payroll-cycle:manage` is
deliberately excluded — this safeguard exists to guarantee the *system itself* (users, roles, sites,
settings, the audit trail) always remains administrable, not to guarantee someone can always run
payroll, which is an operational capability, not an administrative one.

The system guarantees at least one such user always exists. The safeguard
(`roles.service.ts`'s `assertUserChangeKeepsAnAdministrator`/`assertRoleChangeKeepsAnAdministrator`)
is applied, transactionally (so a concurrent race can't slip through between check and mutation), to:

- deactivating a user
- reassigning a user's role
- deactivating a role
- replacing a role's permissions (when the replacement would drop a critical permission)

Each check is scoped to *only* block a change when it would actually remove the last qualifier —
deactivating/reassigning a user who isn't a full administrator, or editing a role that never granted
full administrative capability, is never blocked by this safeguard. An administrator cannot lock
themselves or anyone else out of administering the system entirely; they can still freely restructure
everything else.

### 7. Protected system-role behavior

`isSystemRole` roles (Master Admin, Payroll Staff, Finance) may be renamed, have their description
edited, have their permissions changed, and be activated/deactivated exactly like any custom role —
**the only restriction unique to a system role is that it can never be deleted.** There is
deliberately no broader "system roles are read-only" rule: Step 9's own design goal is "do not make
the entire role permanently uneditable unless there is a clear security reason," and deletion is the
one case with a clear reason (losing the seeded role identity entirely, and the `User.roleId`
`onDelete: Restrict` FK already backstops "can't delete a role with assigned users" at the database
level regardless of role type).

### 8. Known, deliberately deferred role-code dependencies

A handful of pre-existing `roleCode === ROLE_CODES.MASTER_ADMIN` checks were **not** migrated in this
phase, since none of them block custom-role creation, assignment, permission enforcement, user
administration, site assignment, route visibility, or permission-aware controls — the actual
functionality this phase delivers:

- `require-site-access.ts` / `employees.service.ts`'s `isMasterAdmin` — Master Admin's site-scope
  bypass for *operational* data (employees, payroll). A custom role, however permissive, is always
  site-scoped for this data like Payroll Staff/Finance unless it happens to literally be the seeded
  Master Admin role — this is correct, secure behavior for a custom role, not a gap. **Deliberately
  not touched by the UAT Defect 1 fix below** — operational site-scoping ("which sites can this
  person enter payroll for") and Site *administration* visibility ("can this person see/manage the
  Site entity list itself") are different questions with different intended answers; only the
  latter changed.
- `users.service.ts` — `createUser`/`updateUser` skip site-assignment specifically for the Master
  Admin role code.
- `tasks-panel.tsx`'s `isMasterUser` (frontend) mirrors `tasks.service.ts`'s own backend
  `isMasterAdmin`-based task-visibility scoping — fixing the frontend alone, without also
  redesigning the Tasks module's backend query-scoping logic (out of this phase's stated scope, and
  its own dedicated RBAC design for Tasks specifically), would only create a new inconsistency, not
  close the gap. **This is safe as-is**: a custom role without Tasks access simply never sees the
  "Create Task"/assignee-filter UI or any tasks beyond its own assignments, exactly as intended.

**UAT Defect 1 correction (Post-Phase-5 Stabilization Checkpoint 4D correction) — one exception
carved out of the pattern above:** `project-sites.service.ts`'s `listProjectSites` no longer relies
on the `roleCode === MASTER_ADMIN` check *alone* to decide who sees every site. `sites:manage` is
one of this system's `CRITICAL_ADMIN_PERMISSIONS` (§6 above, `shared/src/constants/permissions.ts`)
— the same class as the already-unscoped `users:manage`/`settings:manage`, both genuinely global
administrative capabilities with no "assigned site" concept at all. A custom role explicitly granted
`sites:manage` could previously create a Project Site (`createProjectSite` was, correctly, never
site-scoped — a not-yet-created site can't already be in anyone's `UserSiteAssignment` rows) but then
see an empty Sites list, since *visibility* was still gated on the literal seeded role code. Fixed by
granting the same unrestricted visibility to any role — system or custom — currently holding
`sites:manage`; the `roleCode === MASTER_ADMIN` fast path is kept alongside it (not replaced), for
the same reason Master Admin's bypass is role-identity-based everywhere else in this system: it must
keep working even if Master Admin's own role were ever edited to no longer explicitly hold
`sites:manage`. A user without `sites:manage` (Payroll Staff, Finance, or a custom role that was
never granted it) is completely unaffected — still scoped to their own `UserSiteAssignment` rows,
exactly as before. See `backend/tests/project-sites.test.ts`'s "sites:manage grants global site
visibility" block and `tests/e2e/specs/10-site-visibility.spec.ts` for regression coverage, including
that renaming the role or copying the literal string "Master Admin" as a custom role's *name* grants
no special access — only the permission key and the real seeded role's `code` matter, never a name.

Every one of these remains a role-**code** dependency, never a role-**name** one — renaming any
seeded role's display label still changes nothing, since `code` (not `name`) is what these checks
compare.

### 9. Team-testing role matrix (initial recommendation)

| Role | Purpose | Key permissions | Must remain forbidden |
|---|---|---|---|
| Employee Registry Tester | Employee create/edit/import/export testing | `employees:view`, `employees:create`, `employees:edit` | Payroll, sites, users, settings |
| Payroll Entry Tester | Payroll entry, bulk actions, holds | `payroll:entry` | Release, bank sheets, corrections approval, user admin |
| Finance Release Tester | Salary release, bank sheets, cash receiving, payslips | `payroll:view`, `payroll:release`, `bank-sheets:view`, `payslips:view` | Payroll entry edits, employee edits, user admin |
| Corrections Reviewer | Review another user's correction requests | `corrections:approve` | Self-approval (enforced server-side regardless of role), payroll entry edits |
| Reports Viewer | Reports validation, no mutation | `reports:view` | Any create/edit/delete anywhere |
| Read-Only Auditor | Audit and permitted read-only verification | `audit-log:view` | Any mutation anywhere |

Site scope for each should match the real sites/units the tester actually needs to exercise — never
assigned broader than the test responsibility requires, and never "all sites" unless the role is
genuinely meant to be system-wide.

## System-Wide RBAC Consistency Audit and Remediation (production UAT)

Production UAT with real custom roles surfaced what Checkpoint 4D's own "UAT Defect 1" fix had
already predicted as a risk: `sites:manage`'s global-authority bypass was applied to Project Site
*visibility* but nowhere else, and the resulting inconsistency was reachable by an ordinary
administrator-created custom role, not just a contrived test. This section is the permanent record
of the resulting system-wide audit, the permission/scope matrix it produced, and every fix applied.

### The universal rule (unchanged, now consistently enforced)

Authorization is always **explicit permission** + **explicit resource scope where scope applies**.
It is never role display name, role code (with the small set of documented Master Admin exceptions
below), frontend navigation visibility, or incidental membership in a predefined role. Frontend
permission checks remain a usability layer only — the backend is authoritative everywhere.

### Permission/scope classification (the matrix)

Every permission is one of two kinds. Getting this classification right, per permission, is what
this remediation actually is — the previous defects were not "missing checks," they were **the
same permission classified inconsistently across its own domain's own routes**.

| Permission | Classification | Scope source | Notes |
|---|---|---|---|
| `sites:manage` | **Global administrative** | none (unrestricted) | Now applied consistently to list/create/update/deactivate/delete for both Project Sites *and* Project Units — previously visibility-only (Checkpoint 4D), leaving Unit mutation/read still assignment-scoped. |
| `users:manage` | Global administrative | none | Unchanged — Users module has no site concept. |
| `settings:manage` | Global administrative | none | Unchanged. |
| `audit-log:view` | Global administrative (not yet enforced — no audit-log route exists) | none | See "Not yet implemented" below. |
| `tasks:manage` | **Global administrative** | none | Newly classified explicitly as global for its domain (see Tasks fix below) — Tasks has no site-scoping concept at all, so its only distinction is "every task" vs "only my own." |
| `employees:view` / `:create` / `:edit` | **Site-scoped operational** | `UserSiteAssignment` | Deliberately **not** widened by also holding `sites:manage` — see the worked example below. |
| `payroll:entry`, `payroll:view`, `payroll:release`, `advances:manage`, `bank-sheets:view`, `payslips:view`, `corrections:approve` | Site-scoped operational | `UserSiteAssignment` | Same rule as Employees — verified unchanged, all import the same `common/authz-policy.ts` helpers. |
| `payroll-cycle:manage`, `banks:manage` | Global administrative | none | Unchanged (no site concept for either). |
| `reports:view` | Not yet enforced | — | No `reports` module/routes exist yet; permission key is seedable/grantable but has zero enforcement points and zero frontend consumers. Not a defect — nothing to enforce yet. |

**The worked example the audit centered on:** a "Payroll Manager" custom role holding both
`sites:manage` (global, for Project Sites/Units administration) and `employees:view`/`:create`
(site-scoped, for day-to-day Employee Registry work) is a legitimate, expected combination — a
manager who administers site master data *and* processes employees at their own assigned sites.
`sites:manage` being global for its own domain must never be read as "this user is unrestricted
everywhere" — Employees (and every other site-scoped operational domain) stays scoped to that same
user's real `UserSiteAssignment` rows, with no cross-domain leakage in either direction.

### Centralized policy: `backend/src/common/authz-policy.ts`

Previously, the site-scope check existed in **two independent implementations** that had already
drifted: `require-site-access.ts`'s Express middleware (bypassed only for the literal Master Admin
role code) and `employees.service.ts`'s own `assertSiteAccess`/`isMasterAdmin` (which every other
site-scoped module imported). `project-sites.service.ts`'s `listProjectSites` had been separately
taught the `sites:manage`-is-global rule (Checkpoint 4D) but `require-site-access.ts` never was —
exactly the drift this file's own doc comment now warns against.

`common/authz-policy.ts` is now the single source of truth: `isMasterAdmin`, `hasPermission`,
`hasAnyPermission`, `hasGlobalAuthority(user, globalPermission?)`, `assertSiteAccess(user, siteId,
globalPermission?)`, `getAccessibleSiteIds(user, globalPermission?)`. `require-site-access.ts`'s
middleware now calls the same `assertSiteAccess` rather than reimplementing the check, and accepts
an optional `{ globalPermission }` so a route can name its own domain's global-authority permission
(`PERMISSIONS.SITES_MANAGE` for Project Units) — every site-scoped operational module omits it
entirely, so only Master Admin bypasses those. `employees.service.ts` now imports and re-exports
these from the shared module rather than defining its own copy; every one of its historical
importers (`advances.service.ts`, `bank-sheets.service.ts`, `cash-receiving.service.ts`,
`corrections.service.ts`, `corrections.settlement.service.ts`, `corrections.materialization.service.ts`,
`payroll-entry.service.ts`, `payroll-entry-import-export.service.ts`, `payroll-release.service.ts`,
`payslips.service.ts`, `employees-import-export.service.ts`) now imports directly from
`common/authz-policy.ts` instead.

### Fix 1 — Sites/Units: `sites:manage` is now consistently global

`requireSiteAccess((req) => req.params.siteId, { globalPermission: PERMISSIONS.SITES_MANAGE })` is
now applied to both the Project Unit list (`GET /sites/:siteId/units`) and create
(`POST /sites/:siteId/units`) routes — previously each bypassed only for the literal Master Admin
role code, so a `sites:manage`-holding custom role with no individual `UserSiteAssignment` row
could list every Project Site but was rejected ("You do not have access to this project site")
managing that site's own Units. Unit update/delete (`PATCH`/`DELETE /units/:id`) were already
gated by `sites:manage` alone with no separate site check — unaffected, and now consistent with the
same global-authority classification. See `backend/tests/project-units.test.ts`'s "a custom role
holding sites:manage (no site assignments, not Master Admin)..." coverage and
`tests/e2e/specs/10-site-visibility.spec.ts`'s Branch-creation regression.

### Fix 2 — Employees: scope stays assignment-based; the UI is now consistent with it

Employees' own scoping logic (`isMasterAdmin`/`assertSiteAccess`, Master-Admin-only bypass) was
already correct and did not change — extending it to also bypass for `sites:manage` would have been
exactly the "accidental hybrid" this remediation was asked to eliminate, not fix, since Employee
access and Site administration are different questions with deliberately different answers (this
file's own pre-existing "Role names remain unsuitable..." section already drew this line for
`require-site-access.ts`'s Master-Admin-only Employee/Payroll bypass; this remediation keeps it,
and extends the *same* reasoning explicitly to `sites:manage`). What was genuinely broken:

1. **No distinct empty state.** A `sites:manage` holder with employee permissions but no site
   assignment saw the exact same "No employees found — try adjusting the filters" as a genuinely
   empty registry. Fixed: `employees-page.tsx` now renders "You have no assigned project sites —
   contact an administrator" whenever `!isMasterAdmin(user) && user.siteIds.length === 0`, distinct
   from the ordinary empty-filter state.
2. **A create/list hybrid in the site pickers.** The Employee Registry's site filter and the
   New/Edit Employee form's `SiteUnitSelect` both sourced from the shared, `sites:manage`-aware
   `useProjectSites()` — so a `sites:manage` holder was offered every site in the org to file an
   employee under, even sites their own Employee scope would immediately reject. Fixed by
   `frontend/src/hooks/use-project-sites.ts`'s new `useAccessibleProjectSites(user)`: Master Admin
   still sees every site; everyone else (including a `sites:manage` holder) sees only
   `user.siteIds` — the Project Sites admin page and the Users module's own site-assignment picker
   deliberately keep using the raw, unrestricted `useProjectSites()`, since both genuinely want it.

See `backend/tests/employees.test.ts`'s "a custom role holding sites:manage AND employees:view..."
block and `tests/e2e/specs/10-site-visibility.spec.ts`'s "Employee Registry visibility (UAT Defect
3)" describe block.

**Resolved (RBAC Consistency Completion checkpoint):** `corrections-page.tsx` (`ReviewQueueTab`/
`CorrectionsLedgerTab`, threaded `user` through as a new prop), `salary-release-page.tsx`,
`payslips-page.tsx`, `payroll-entry-page.tsx`, `bank-sheet-page.tsx`, `advances-page.tsx`, and
`cash-receiving-page.tsx` all now call `useAccessibleProjectSites(user)` instead of the raw,
`sites:manage`-aware `useProjectSites()` for their own site filters — every module in this system
that filters by site now follows the identical scope rule, with no remaining exceptions beyond the
two pages that genuinely want the unrestricted list (Project Sites administration, and the Users
module's own site-assignment picker).

### Fix 3 — Tasks: `tasks:manage` is now consistently global (found proactively, not reported)

`createTask`/`updateTask` (gated by `tasks:manage` alone) already let any holder assign a task to
anyone, with no Master-Admin-only restriction on the assignee. But `listTasks`/`getTask`
(`requireTaskAccess`) bypassed ownership-scoping only for the literal Master Admin role code — so a
custom role granted `tasks:manage` could create and assign a task, then immediately lose the
ability to see it again, an exact "can mutate but cannot list" instance of the pattern this audit
was asked to hunt for everywhere, not just in the reported modules. Fixed by classifying
`tasks:manage` as this domain's own global-administrative permission
(`hasGlobalAuthority(user, PERMISSIONS.TASKS_MANAGE)`, replacing the literal `isMasterAdmin` check
in both `requireTaskAccess` and `listTasks`) — mirrored on the frontend (`tasks-panel.tsx`'s
`isMasterUser` is now `canManageAllTasks(user)`, `lib/permissions.ts`).

**A second, connected bug found while fixing this:** the Create/Edit Task dialog's assignee picker
called `GET /api/v1/users` (`users:manage`-gated) to populate its dropdown — fine for the literal
Master Admin role (who holds every permission) but a 403 for any custom `tasks:manage` holder who
doesn't also hold `users:manage`. Fixed with a dedicated, minimally-scoped lookup,
`GET /api/v1/users-lookup/assignable` (`users.routes.ts`'s `usersLookupRouter`, mounted separately
from the `users:manage`-blanket-gated `usersRouter`), gated by `tasks:manage` instead and returning
only `{ id, name, email }` per active user — never the fuller `UserSummary` shape (role, site
assignments) `users:manage` administration genuinely needs. See
`backend/tests/tasks.test.ts`'s two new blocks and this module's `frontend/src/hooks/use-users.ts`'s
`useAssignableUsers`.

### System-wide role-code audit — every remaining role-**code** check, and why each stays

Confirmed via a full-codebase grep (`isMasterAdmin`, `isMasterUser`, `roleCode`, `role.code`,
`ROLE_CODES.MASTER_ADMIN`) that no role-**name** check exists anywhere in this system, and every
remaining role-**code** check is one of the following, already-documented, deliberate exceptions —
none newly introduced by this remediation:

- `common/authz-policy.ts`'s `isMasterAdmin` (the one true definition now) — Master Admin's
  universal bypass, every domain.
- `project-sites.service.ts`'s `listProjectSites` — Master Admin fast path kept alongside the
  `sites:manage` permission check (Checkpoint 4D reasoning, unchanged): must keep working even if
  Master Admin's own role were ever edited to no longer explicitly hold `sites:manage`.
- `users.service.ts` — `createUser`/`updateUser` skip site-assignment specifically for the Master
  Admin role code (unchanged from Phase 1 — Master Admin has no `UserSiteAssignment` rows by
  design).
- `users-page.tsx` — role-code-based UI showing/hiding the site-assignment field for a literally-
  Master-Admin-coded user (unchanged; a data-shape question, not an authorization substitute).

No occurrence of the literal string `"Master Admin"` gates any behavior — every match found across
this system is cosmetic text, not authorization. **This is a stronger guarantee than a previous
version of this section claimed ("the two matches found")** — a full terminology audit (Corrections
Workflow Redesign / RBAC Consistency Completion checkpoint) found the live UI actually mixed
"Master Admin" and "Master User" across several pages, and that `prisma/seed.ts`'s own seeded
display name had never actually been updated to "Master User" despite this section's own
documentation of the 2026-07-05 rename. See that checkpoint's own terminology-audit note below for
the full fix — the point stands regardless: neither string was ever compared against for an
authorization decision, only rendered as display text.

## Corrections Workflow Redesign / RBAC Consistency Completion checkpoint

Two objectives, addressed together since the second grew directly out of auditing the first:
finishing the previous checkpoint's RBAC module migration, and completing the Corrections workflow
so creating a correction has a real, discoverable entry point (see
`docs/architecture/workflows/corrections-and-balance-adjustments.md`'s own "Entry-point completion"
section for the full detail — the backend workflow was already complete and exhaustively tested;
only the frontend discoverability needed fixing).

### Terminology audit — "Master User" is now the live, seeded display name

A full grep found this was a live, user-visible inconsistency, not settled documentation: the
seeded `Role.name`/`User.name` for the Master Admin role/account still said "Master Admin"
(`prisma/seed.ts`'s `ROLE_DISPLAY_NAMES` was never actually updated despite this file's own
"renamed 2026-07-05" claim), rendered directly in the sidebar footer and Settings → Roles table —
while four scattered frontend help/empty-state strings already said "Master User"
(`corrections-page.tsx`, `salary-release-page.tsx` ×2, `payroll-entry-page.tsx`) and four others
still said "Master Admin" (`access-denied.tsx`, `settings-page.tsx`, `payslips-page.tsx`,
`employees-page.tsx`). Fixed: `seed.ts`'s `ROLE_DISPLAY_NAMES` and the seeded account's `name` now
say "Master User" (for every fresh install); a new data-only migration
(`20260723120000_master_user_terminology`) updates the same values on any database seeded before
this fix, scoped to rows that still hold the exact literal default (an administrator who already
renamed their own Master role/account is never silently overwritten); the four remaining "Master
Admin" strings were changed to "Master User" for consistency. `Role.code` (`MASTER_ADMIN`) is
unchanged everywhere, as is every role-code-based authorization check this file documents above —
this was a display-text-only fix.

### Reusable Employee Lookup

`frontend/src/components/ui/employee-lookup.tsx` — a searchable combobox replacing the plain,
unsearchable `<select>` every "pick one employee" surface previously used (Advances' Record Advance
modal, Corrections' Request Correction modal), neither of which stays usable at this system's own
stated design floor (~10,000 employees). Searches the real `GET /api/v1/employees?search=...`
(`employees.service.ts`'s `listEmployees`, extended this checkpoint to also match Account Number,
IBAN, Site name, and Unit/Branch name — previously Name/CNIC/Code only) — introduces no new
authorization decision of its own; the backend's existing site-scoping remains the sole authority.
Corrections' own usage additionally passes `restrictToEmployeeIds`, narrowing results client-side
to the current cycle's own released entries — the only legitimate correction targets — while still
searching through the same real backend endpoint every other consumer uses.

### Standard print support

`AppShell`'s `print:` utility classes (`sidebar.tsx`/`topbar.tsx` hidden; `<main>`'s scroll
constraint lifted) plus a new `PrintButton`/`PrintContextHeader` pair, wired into all eight pages
the checkpoint named (Payroll Entry, Salary Release, Bank Sheet, Cash Receiving, Payslips,
Corrections, Employee Registry, Advances). Payroll Entry's own interactive grid is virtualized
(`@tanstack/react-virtual` — only on-screen rows exist in the DOM at any moment) and so can never
print correctly on its own; it is hidden from print entirely in favor of a plain, fully-rendered
`<table>` covering every currently-filtered entry, shown only under print media.

### Downloadable import templates

`GET /api/v1/employees/import-template` and `GET /api/v1/payroll-entries/import-template` — a
blank workbook with the exact required header row, one fully-filled sample row, and an
"Instructions" sheet documenting which columns are required vs. optional (Employees) or that the
import is update-only and never creates a new row (Payroll Entry). Bank Sheet, Cash Receiving,
Sites/Units, and Users have no import functionality at all today (export-only or plain CRUD) — a
template for a nonexistent import feature would document nothing real, so none was added for those;
building real import support for them is a separate, larger undertaking, not attempted here.

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

### Checkpoint 4C/4D — the concurrent first-contact race: root cause, a rejected fix, and the corrected design

**Root cause (4C):** `issueCsrfCookie` used to mint a fresh random token any time a request arrived
with no `csrf_token` cookie yet. Two requests that both arrive before either has round-tripped its
`Set-Cookie` back to the browser — two tabs opened together, or several parallel first-load
requests from one tab (the `session` middleware ahead of it does an async Postgres lookup, enough
of an event-loop yield for Node to genuinely interleave two such requests even within a single tab)
— each independently minted a *different* token. Each tab's own `api-client.ts` module memory then
held a different value, but the browser's one shared cookie jar could only end up holding whichever
`Set-Cookie` it applied last. The tab whose in-memory token lost that race sent a header that no
longer matched the cookie on its next mutation and was rejected with a 403 "Missing or invalid CSRF
token" — intermittent by nature, since it depended on request/response timing, not on anything a
user did wrong.

**A first fix attempt (Checkpoint 4D, rejected on review):** made concurrent "no cookie yet"
requests converge on one token via a short-lived, in-memory, per-process map keyed by `req.ip`.
Rejected, correctly: `req.ip` is not a browser identity — it identifies a network path, and
unrelated users behind one NAT/corporate egress, or behind a reverse proxy, can share an IP without
being the same client. Worse, an in-memory `Map` is process-local — correctness depended on every
racing request landing on the *same* Node process within a fixed TTL window, which stops holding
the moment this backend runs more than one instance (the ordinary case for any real deployment) or
restarts mid-window. A mitigation whose correctness depends on single-process, single-request-path
accidents is not a fix for a security-relevant race condition, even though it happened to work in
this project's own single-instance sandbox testing.

**The corrected design does not try to prevent the race server-side at all.** `issueCsrfCookie`
(`backend/src/common/middleware/csrf.ts`) is the simplest possible stateless rule: mint a token if
the request has none, echo it on safe methods, full stop — a first-contact race may still briefly
mint two different tokens, exactly as it could before Checkpoint 4C. What changed is that this is no
longer a problem the *server* needs to solve:

1. `csrfProtection` rejects a genuine mismatch with a specific, distinguishable error code
   (`CSRF_TOKEN_MISMATCH` — `common/http-error.ts`'s `csrfMismatch`), not the generic `FORBIDDEN`
   every ordinary permission denial also uses.
2. `frontend/src/lib/api-client.ts`'s `apiRequest` performs **one controlled recovery** when — and
   only when — it sees that specific code: call `GET /api/v1/csrf-token` (`app.ts`, a
   dependency-free, unauthenticated safe endpoint with exactly the same "echo the token bound to
   whatever cookie the request already carries, mint one if it carries none" behavior every safe
   request already gets from `issueCsrfCookie`), capture the token it returns, and retry the
   original mutation exactly once with that token.
3. A second mismatch — on the retry itself — is never retried again; it surfaces to the caller as a
   normal `ApiError`. No other status/code (401, an ordinary 403 permission denial, 400, 409, 422,
   500) ever triggers this path. Concurrent requests that all hit a mismatch around the same moment
   share one in-flight recovery call (`pendingCsrfRefresh`) rather than each firing their own.

This keeps the double-submit-cookie model and its timing-safe comparison (`csrfProtection`/
`tokensMatch`) completely unweakened — every comparison is still a strict, real equality check, and
neither the cookie's attributes nor the middleware ordering changed. It needs no shared state, no
assumption about process topology, and no client identity signal of any kind — a genuine, if now
rare, race simply costs one extra round trip on whichever tab loses it, invisibly to the user,
instead of a hard failure.

**Token rotation** (retained from the original design — this part of Checkpoint 4D was correct and
was not part of what got rejected): `rotateCsrfCookie` issues a brand-new token and echoes it in the
response header of that same request — including on state-changing responses, which normally never
carry the header — called after every event that already rotates or destroys *the acting request's
own* session: successful login (alongside the existing `req.session.regenerate`), logout,
self-service `POST /auth/change-password`, and an administrator resetting *their own* password via
`POST /users/:id/reset-password`. **Never called when an administrator resets someone else's
password** — that only destroys the *target* user's sessions, an entirely different browser/cookie
jar this response has no access to; the acting administrator's own token is correctly left as-is. A
token learned before authentication is therefore never still valid afterward, the same rationale as
session-fixation protection already gets from regenerating the session ID itself. Because
`api-client.ts`'s `captureCsrfToken` already reads the `x-csrf-token` header off *every* response
(not just safe ones), the frontend picks up a rotated token with no separate round trip and no
special-case code — the same mechanism the mismatch-recovery endpoint's response flows through.

Regression coverage: `backend/tests/csrf-concurrency.test.ts` (normal validation, mismatch still
403 with the specific code, the recovery endpoint's echo/mint behavior, no IP-based coupling between
unrelated simulated clients — including two sharing one simulated IP, statelessness across separate
`createApp()` instances standing in for separate processes, rotation on login/logout/password-change/
self-reset, full login→change-password→re-login flows, and no backend-side automatic retry of any
kind); `frontend/src/lib/api-client.test.ts` (one-shot recovery and retry, a second mismatch
surfaced not retried again, every non-CSRF status/code left alone, concurrent-mismatch dedup, no
`localStorage`/`sessionStorage` at any point); and `tests/e2e/specs/09-csrf-concurrency.spec.ts`
(the same scenarios through a real Chromium browser with a real shared cookie jar across multiple
tabs, including the original two-tab race run repeatedly).

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
