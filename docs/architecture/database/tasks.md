# Tasks Schema — `Task`, `TaskNotification`

**Owner module(s):** Tasks

**Contains:** `Task`, `TaskNotification`

**Sections:** §27–§27a · Full index: `database/README.md`

**Added 2026-07-10 (Phase 3.5 architecture revision, documentation-only) — supersedes the "Team
Collaboration panel (Chat/To-Do)" concept previously planned for Phase 8** (`reference/PROJECT_SPEC.md`
§"Team Collaboration panel"; `reference/payroll_prototype.html`'s Team Panel). That original concept
is permanently retired, not deferred — the right-side slide-out panel becomes a Tasks Workspace only.
There will never be chat, messaging, comments, discussion threads, attachments, subtasks, a Kanban
view, or recurring tasks on this table; it is deliberately kept this lightweight, not an
under-specified placeholder for a larger tool. `reference/PROJECT_SPEC.md` and
`reference/payroll_prototype.html` are unedited, frozen historical artifacts — this document, not
those, is the authoritative current design.

---

## 27. `Task`

**Purpose:** A single unit of internally-delegated work — Master User assigns something to one other
user and tracks whether it gets done. Not a project-management tool: no subtasks, no dependencies, no
recurrence, no comment thread.
**Why it exists:** Internal operational coordination (e.g. "review this month's fines before release,"
"confirm the new site's bank details") needs *some* lightweight tracking mechanism, but the originally
planned Chat panel was both unbuilt and, per the 2026-07-10 revision, permanently out of scope. Tasks
is the sole replacement for that panel's slide-out real estate.
**Business rule tie-in — ownership-based visibility, not site- or role-based (see
`docs/architecture/authentication.md`'s "Tasks: ownership-based visibility" section for the full
rule):** a task is visible only to Master User and the one user in `assignedToUserId` — this holds
regardless of either user's site assignments or role, and is enforced at the application/query layer,
not by any site-scoping middleware (which does not apply to this table at all).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `title` | varchar(200) | no | — | |
| `description` | text | yes | — | |
| `assignedToUserId` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — the sole viewer besides Master User |
| `assignedByUserId` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — recorded as the real acting user rather than hardcoded, even though only Master User can create/assign a task today (§ Permissions, below); this is a "store the fact" column, not a hook for a future peer-assignment feature that isn't being built |
| `assignedAt` | timestamptz | no | `now()` | set on creation; updated whenever `assignedToUserId` changes (a reassignment) — drives the "Recently Assigned" sort and the `task.reassigned` notification's timing, independent of `createdAt` |
| `priority` | enum `TaskPriority` (`LOW`, `MEDIUM`, `HIGH`) | no | `MEDIUM` | |
| `status` | enum `TaskStatus` (`TO_DO`, `COMPLETED`, `CANCELLED`) | no | `TO_DO` | **deliberately no `IN_PROGRESS` value** — a two-state-plus-terminal model was evaluated and rejected as unnecessary granularity for a lightweight delegation list (frozen decision, 2026-07-10) |
| `dueDate` | date | yes | — | optional; no recurrence concept exists or is planned |
| `module` | varchar(60) | yes | — | free text, not a native enum, by deliberate choice — mirrors `AuditLog.entityType`'s own convention (`database/audit-log.md §16`), since the set of "modules a task might be about" grows every phase and a native enum would force a migration each time one does |
| `relatedEntityType` | varchar(60) | yes | — | polymorphic reference, reusing `AuditLog`'s own `entityType`/`entityId` shape rather than inventing a second pattern for the same idea |
| `relatedEntityId` | uuid | yes | — | no FK constraint (same reasoning as `AuditLog.entityId` — the referenced table varies) |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |
| `completedAt` | timestamptz | yes | — | set when `status` becomes `COMPLETED`; cleared on reopen (§ Reopen, below) |

- **Unique constraints:** none
- **Indexes:** (`assignedToUserId`) — every assignee-scoped query filters on this first; (`dueDate`),
  (`priority`), (`assignedAt`) — one per frozen sort option (Due Date / Priority / Recently Assigned,
  2026-07-10 decision), each usable for both Master User's unfiltered view and an assignee's own
  filtered-then-sorted view; (`status`) — the To Do/Completed/Cancelled filter every list view applies
- **Cascade:** `assignedToUserId`/`assignedByUserId` are `RESTRICT` — a `User` with any task assigned
  to or by them cannot be deleted (matches every other FK-to-`User` in this schema, e.g.
  `PayrollEntry.releasedByUser`); reassign or delete the task first
- **Module owner:** Tasks
- **Optimistic locking: deliberately NOT required.** `PayrollEntry.version` exists because that table
  has "the only... realistic concurrent-edit exposure" in this schema (`database/schema-invariants.md`
  §22) — multiple staff editing the same row from multiple tabs. `Task` has no comparable exposure: at
  most two people ever touch one row (Master User, who owns every field-level mutation; the assignee,
  whose only possible write is a single status flip to `COMPLETED`), and those two write disjoint
  fields. Noted explicitly so a future implementer doesn't wonder whether a `version` column was
  overlooked.
- **Transactions required:** yes, for compound writes — creating a task and its `task.assigned`
  `AuditLog`/`TaskNotification` rows together; reassigning a task and writing its `task.reassigned`
  pair together; completing a task and writing its `task.completed` pair together — same "the record
  and its audit/notification trail commit together or not at all" discipline this schema already
  applies everywhere (`database/schema-invariants.md` §22's transaction list).
- **Audit logging:** every mutation — `task.created`, `task.assigned`, `task.reassigned`,
  `task.edited` (title/description/priority/due date changes, Master-User-only), `task.completed`,
  `task.reopened`, `task.cancelled`, `task.deleted` — via the existing generic, polymorphic `AuditLog`
  table (no schema change to `AuditLog` itself needed), mirroring `Employee`'s own pattern of naming
  a mutation's specific action rather than a single generic `task.updated` for everything.
- **Row count:** small — an internal delegation list for a single-digit-to-low-double-digit staff
  count, not a high-volume table; no partitioning/archival concern at any realistic scale.

## 27a. `TaskNotification`

**Purpose:** The persisted half of the in-app notification model (2026-07-10 frozen decision) — one
row per discrete *event* a user should be told about. Due-today/overdue are **not** rows here; they
are computed live from `Task.dueDate`/`Task.status` at read time, since a date-based condition that's
always freshly true/false has no business being persisted and risking staleness or duplication.
**Why it exists:** The Tasks panel's notification badge needs an "unread count" that survives across
page loads without recomputing "was this task just assigned to me" from scratch — a lightweight event
log, not a general-purpose notification system (deliberately scoped to Tasks only; a second real
consumer would be the trigger to generalize this, not anticipated demand).
**No WebSockets/SSE** — delivered via ordinary client polling (a short-interval refetch on a small
unread-count endpoint), matching this project's own stated reasoning for choosing Postgres sessions
over Redis (`docs/architecture/authentication.md`: this system's user count doesn't justify additional
realtime infrastructure).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `userId` | uuid | no | — | FK → `User.id`, `ON DELETE CASCADE` — the recipient |
| `taskId` | uuid | no | — | FK → `Task.id`, `ON DELETE CASCADE` |
| `type` | enum `TaskNotificationType` (`ASSIGNED`, `REASSIGNED`, `COMPLETED`) | no | — | exactly the three events named in the 2026-07-10 frozen decision — `COMPLETED` notifies Master User (the delegator) that an assignee finished their task, closing the delegation loop; no other event type exists |
| `createdAt` | timestamptz | no | `now()` | |
| `readAt` | timestamptz | yes | — | null = unread; the badge count is `COUNT(*) WHERE userId = :current AND readAt IS NULL` |

- **Unique constraints:** none
- **Indexes:** (`userId`, `readAt`) — the one query this table exists to serve
- **Cascade:** both FKs `CASCADE` — unlike `AuditLog` (an immutable historical record, `SET NULL` on
  actor deletion) or `Task` itself (`RESTRICT`), a notification has no standalone historical value
  once its `User` or `Task` is gone; it is ephemeral UI state, not a record of what happened. This is
  a deliberate, narrow exception to this schema's general RESTRICT-by-default convention
  (`database/schema-invariants.md` — cascade notes throughout), not an inconsistency.
- **Module owner:** Tasks
- **Row count:** small and self-limiting — bounded by task-mutation frequency for a small internal
  user base, not a growth-without-bound table; no retention/archival policy is needed at this scale.

---
