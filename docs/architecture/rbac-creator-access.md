# RBAC Creator-Access Invariant

**Owner module(s):** Project Sites, RBAC/authorization

**Contains:** The "creator retains access to what they create" invariant, which resources it
applies to (and why the rest are deliberately excluded), the Project Site transactional fix, and
existing-data findings.

**Sections:** — (narrative document) · Related: `authentication.md` (permission/scope matrix),
`database/access-control.md` (RBAC schema)

## The problem (RBAC Creator Ownership checkpoint, 2026-07-25)

A user holding `sites:manage` — a global *administrative* permission (create/edit/delete the Site
entity list; see `authentication.md`'s "global administrative permission" vs "site-scoped
operational permission" distinction) — could create a new Project Site, but every operational
module (Employees, Payroll Entry, Advances, Bank Sheets, Cash Receiving, Corrections) still gated
on `UserSiteAssignment`, which nothing populated for the site they had just made. The creator could
not use the site they had just created until a Master Admin manually assigned it back to them.

Root cause: `createProjectSite` (`backend/src/modules/project-sites/project-sites.service.ts`) was
a single, non-transactional `prisma.projectSite.create` call — it never read the authenticated
user's identity and never touched `UserSiteAssignment` at all. The only two places in the codebase
that ever wrote a `UserSiteAssignment` row were `users.service.ts`'s `createUser`/`updateUser` (a
Master Admin explicitly editing someone's site list) — nothing wrote one as a side effect of
*creating* a site.

## The invariant

> A user who is authorised to CREATE a scope-controlled resource must not immediately require
> another user to grant them access to the resource they just created.

This is deliberately narrow. It applies **only** where all three hold:

1. The resource's visibility is gated by an **explicit assignment table** (not just a `createdBy`
   column) — the same shape `UserSiteAssignment` has for Project Sites.
2. A permission exists that lets a non-Master user **create** the resource without already having
   an assignment to it (a not-yet-created resource can't already be in anyone's assignment rows).
3. Creating it **without** an accompanying assignment would leave the creator unable to see or
   operate on their own new resource.

It does **not** mean "creators own everything they create forever," and it is **not** applied to
ordinary financial/workflow records merely because they carry a `createdBy` field (`PayrollCycle`
does; that's audit provenance, not an access-control gate).

It is implemented once, generically, in `backend/src/common/creator-access.ts`
(`ensureCreatorSiteAssignment`) — not inlined into `project-sites.service.ts` — specifically so the
next resource that legitimately needs it reuses this instead of re-deriving the pattern per module.

**`sites:manage` still does not grant unrestricted operational access to every site.** This fix
changes nothing about that: a `sites:manage` holder still only operates within their own
`UserSiteAssignment` rows for every other module (Employees, Payroll Entry, ...). The only thing
that changed is that the *one* site they just created is now among those rows.

## Resource-by-resource audit

| Resource | Classification | Why |
|---|---|---|
| **Project Sites** | **A — creator assignment required** | The only resource in this codebase with its own assignment table (`UserSiteAssignment`) whose creation permission (`sites:manage`) doesn't imply prior access. Fixed (see below). |
| **Project Units** | **B — inherits access through parent Site scope** | No assignment table of its own; access is entirely `ProjectSite`-derived. Creating a unit already requires site access to its *parent* site (`requireSiteAccess(..., { globalPermission: SITES_MANAGE })`) — a creator with access to the parent site keeps that same access afterward; nothing regresses. Confirmed by an existing test (`backend/tests/project-units.test.ts`, "a custom role holding sites:manage ... can list units for, and create a unit under, any site"), not a new ownership concept. |
| **Employees** | **B — inherits access through parent Site scope** | `Employee.siteId`, no assignment table. Creating one already requires site access to `siteId` (`assertSiteAccess`); nothing new is needed. |
| **Payroll Cycles** | **D — financial/workflow record** | Has its own `createdBy` column, but that's audit provenance only, not an access gate — cycles aren't site-scoped by assignment. |
| **Payroll Entries** | **D — financial/workflow record** | Scoped via `employee.siteId`, not its own assignment table; access already follows the employee's site. |
| **Advances** | **D — financial/workflow record** | Scoped indirectly via `advance.employee.siteId`. |
| **Corrections** | **D — financial/workflow record** | Scoped via `entry.siteId`/`payrollEntry.siteId`. |
| **Bank Sheets** | **D — financial/workflow record** | Own `siteId` column, filtered via the caller's `siteIds` — same shape as Employees, but a bank sheet entry is a financial record, not a resource a user "owns" going forward. |
| **Cash Receiving** | **D — financial/workflow record** | Same as Bank Sheets. |
| **Users** | **E — other** | Global entity; a User's own `siteIds` are set explicitly as part of the creation input itself (`createUser`), so there's no "created without access" gap to close — the creator of a User account never needs access *to that account*. |
| **Roles** | **C — globally accessible by permission** | Not site-scoped at all; governed by `users:manage`. |

No other resource in the system has the "explicit assignment table + creation permission that
doesn't imply prior access" shape, so Project Sites is, today, the invariant's only call site.

## The Project Site fix

`createProjectSite(currentUser, input)` now:

1. Opens a `prisma.$transaction`.
2. Creates the `ProjectSite` row, including a new `createdById` column (nullable, `onDelete:
   SetNull`) — **audit provenance only**; no access-control decision anywhere reads it.
3. Calls `ensureCreatorSiteAssignment(tx, { creatorIsMasterAdmin, userId, siteId })`, which
   `upsert`s a `UserSiteAssignment` row on the `[userId, siteId]` unique constraint — idempotent,
   so calling it twice (or racing it) can never produce a duplicate.
4. Skips the assignment entirely for a Master Admin creator — consistent with
   `UserSiteAssignment`'s own doc comment ("Master Admin has implicit, unrestricted access and has
   no rows here") and every other assignment-write call site in the codebase.

Both writes are in the same transaction: a crash between them can never leave a site whose own
creator has no assignment to it.

The route (`POST /api/v1/sites`) additionally records a distinct
`project-site.creator_assigned` audit-log entry (separate from the existing `project-site.created`
entry), only when an assignment was actually written — so the audit trail can tell "this
`UserSiteAssignment` came from the creator's own site creation" apart from `user.sites_changed` (a
Master User manually editing someone's site list later).

This never widens the creator's access beyond the one site just created, never assigns anyone else,
and never runs for a Master Admin.

## Existing data

`ProjectSite` had **no creator-identity column at all** before this checkpoint — `createdById` is
new. Every site created before this migration therefore has no recoverable creator identity from
the `ProjectSite` row itself.

The only surviving trace is `AuditLog` (`project-site.created` entries capture `actorUserId`), so a
one-time reconciliation — backfilling a `UserSiteAssignment` for each pre-existing site's audit-log
creator, if they don't already have one — is *technically* possible. **This checkpoint does not
perform that backfill.** It would be a production data mutation with its own review, and for any
site whose `project-site.created` audit entry has since aged out or whose creator account was later
deleted (`actorUserId` is nullable, `ON DELETE SET NULL`), no creator can be recovered at all —
inventing one would be worse than leaving it unassigned. If a future checkpoint wants this
reconciliation, it should run as an explicit, reviewed one-time script against `AuditLog`, not an
automatic migration.
