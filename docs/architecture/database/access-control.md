# Access Control Schema — `Role`, `Permission`, `RolePermission`, `User`, `UserSiteAssignment`, `CompanySettings`, `Session`

**Owner module(s):** Authentication (Role, Permission, RolePermission, Session); Settings/Authentication jointly (User, UserSiteAssignment); Settings (CompanySettings)

**Contains:** `Role`, `Permission`, `RolePermission`, `User`, `UserSiteAssignment`, `Bank`-adjacent RBAC scaffolding, `CompanySettings`, `Session`

**Sections:** §2–§6, §19–§20 · Full index: `database/README.md`

For the RBAC *rationale* (why Finance is a separate role, why permissions are modeled as
Role → Permission rather than hardcoded checks, site-scoping mechanics), see
`docs/architecture/authentication.md` — this file is the schema only.

---

## 2. `Role`

**Purpose:** Defines a named bundle of permissions (Master User, Payroll Staff, Finance, and any
future role such as an ESS "Employee" role).
**Why it exists:** `docs/architecture/authentication.md` requires RBAC to be modeled as
Role → Permission, not hardcoded role checks, so a new role is a data change.
**Business rule tie-in:** Principle 7 (RBAC must never be bypassed).
**Revised 2026-07-05 (Phase 3 architecture review) — `FINANCE` added as a third role:** the new
per-Project-Unit release model (`database/release.md §12b`) introduces a distinct capability —
executing a Unit's release once client funding is confirmed — that is neither Payroll Staff's
data-entry role nor Master User's governance/approval role. See `docs/architecture/authentication.md`
for its full permission set and site-scoping. **"Master Admin" is renamed "Master User" throughout
this document set as of the same review** — same role, no functional change, terminology only.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `code` | varchar(40) | no | — | e.g. `MASTER_USER`, `PAYROLL_STAFF`, `FINANCE` — stable programmatic key |
| `name` | varchar(80) | no | — | display name |
| `description` | text | yes | — | |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `code`
- **Indexes:** unique index on `code` (doubles as lookup index)
- **Module owner:** Authentication
- **Row count:** 2–5 (rarely grows) — now 3 at launch (`MASTER_USER`, `PAYROLL_STAFF`, `FINANCE`)

## 3. `Permission`

**Purpose:** An individual, checkable capability (e.g. `payroll:release`, `sites:manage`,
`corrections:approve`).
**Why it exists:** The atomic unit RBAC middleware checks per route — see
`docs/architecture/authentication.md`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `key` | varchar(80) | no | — | e.g. `payroll:release` |
| `description` | text | yes | — | |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `key`
- **Module owner:** Authentication
- **Row count:** a few dozen, one per protected capability — grows additively as features are added

## 4. `RolePermission`

**Purpose:** Join table — which permissions a role grants.
**Why it exists:** Many-to-many between `Role` and `Permission`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK (surrogate, simpler than composite PK for ORM tooling) |
| `roleId` | uuid | no | — | FK → `Role.id`, `ON DELETE CASCADE` |
| `permissionId` | uuid | no | — | FK → `Permission.id`, `ON DELETE CASCADE` |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`roleId`, `permissionId`)
- **Indexes:** (`roleId`), (`permissionId`)
- **Cascade:** `CASCADE` on both FKs — a pure join row has no meaning without both parents (one of
  the few tables in this schema where cascade delete is appropriate, since `Role`/`Permission`
  themselves are never expected to be deleted in practice, only deactivated/unused).
- **Module owner:** Authentication

## 5. `User`

**Purpose:** A login account — Master User, Payroll Staff, or (added 2026-07-05) Finance.
**Why it exists:** Core identity for everyone who accesses the system (not to be confused with
`Employee`, who is paid but does not log in, at least until an ESS module exists).
**Business rule tie-in:** Principle 7; `docs/architecture/authentication.md`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `roleId` | uuid | no | — | FK → `Role.id`, `ON DELETE RESTRICT` |
| `name` | varchar(120) | no | — | display name |
| `email` | varchar(255) | no | — | login identifier |
| `passwordHash` | varchar(255) | no | — | argon2 hash; never plaintext |
| `avatarStorageKey` | text | yes | — | `StorageProvider` key, see `docs/architecture/system-conventions.md §2` |
| `themeAccentColor` | varchar(7) | yes | `'#1B4F72'` | per-user hex color, doesn't affect other users |
| `isActive` | boolean | no | `true` | deactivation flag — never hard-delete a `User` |
| `lastLoginAt` | timestamptz | yes | — | |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `email`
- **Check constraints:** `email` matches a basic email format (defense in depth; real validation is
  app-layer via Zod)
- **Indexes:** unique(`email`), (`roleId`), partial index on `isActive = true` for fast "active
  users" listings
- **Cascade:** `roleId` is `RESTRICT` — a role in active use cannot be deleted out from under a user
- **Module owner:** Settings (account management) jointly with Authentication (login mechanics) — see
  `docs/architecture/overview.md`
- **Row count:** single-digit to low double-digit (internal staff only)

## 6. `UserSiteAssignment`

**Purpose:** Which project sites a Payroll Staff **or Finance** user may access.
**Why it exists:** Site-based permission scoping, independent of role
(`docs/architecture/authentication.md`).
**Business rule tie-in:** "Payroll Staff can enter attendance/payroll data only for their assigned
project sites" (`PROJECT_SPEC.md`); the same site-scoping mechanism was reused, unchanged, for
Finance's own site assignment when that role was added 2026-07-05 (Phase 3 architecture review) —
no new assignment table was needed, since Finance's scoping model is identical in shape to Payroll
Staff's.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `userId` | uuid | no | — | FK → `User.id`, `ON DELETE CASCADE` |
| `siteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE CASCADE` |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`userId`, `siteId`)
- **Indexes:** (`userId`), (`siteId`)
- **Note:** Master User has implicit access to all sites and has no rows here — absence of rows for
  Master User is not treated as "no access"; this table is only consulted for Payroll Staff and
  Finance.
- **Module owner:** Settings/Authentication

---

## 19. `CompanySettings`

**Purpose:** Company name, address, and logo shown on payslips, bank sheets, and the app shell.
**Why it exists:** Settings module, Master-Admin-only editable.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | fixed constant (see below) | PK |
| `companyName` | varchar(200) | no | — | |
| `registeredAddress` | varchar(300) | yes | — | |
| `phone` | varchar(30) | yes | — | |
| `email` | varchar(255) | yes | — | |
| `logoStorageKey` | text | yes | — | `StorageProvider` key |
| `updatedAt` | timestamptz | no | `now()` | |
| `updatedById` | uuid | yes | — | FK → `User.id`, `ON DELETE SET NULL` |

- **Singleton enforcement:** `id` is fixed to a single well-known constant UUID
  (e.g. `00000000-0000-0000-0000-000000000001`), so the primary key itself guarantees at most one
  row can ever exist — simpler than a separate partial-unique-index trick.
- **Module owner:** Settings
- **Row count:** exactly 1

## 20. `Session` (external, library-owned)

**Purpose:** Server-side session storage for `express-session` via `connect-pg-simple`.
**Why it's different:** Its schema (`sid` varchar PK, `sess` json, `expire` timestamp) is dictated by
the library, not this application — it is the one deliberate exception to the UUID-primary-key rule
(`database/conventions-and-enums.md §0`) and is not otherwise part of this specification's design
surface.

---
