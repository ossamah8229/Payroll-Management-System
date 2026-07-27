/**
 * Canonical permission-key registry for the Role → Permission RBAC model
 * (docs/architecture/authentication.md). This is the single source of truth for permission
 * keys — the Phase 1 seed script and every later module's route guards both import from here,
 * so a key is never typo'd differently in two places.
 *
 * Only the two Phase 1 roles (Master Admin, Payroll Staff) are seeded against this list right
 * now; keys for modules built in later phases are listed here already so the permission
 * registry doesn't need a schema-affecting change each time a module is implemented — adding
 * a route's enforcement later is a code change, but the permission key itself already exists.
 */
export const PERMISSIONS = {
  EMPLOYEES_VIEW: 'employees:view',
  EMPLOYEES_EDIT: 'employees:edit',
  EMPLOYEES_CREATE: 'employees:create',
  SITES_MANAGE: 'sites:manage',
  /** Master-User-only (Bank Registry, Phase 4 Checkpoint 1, Settings → Banks) — create/edit/
   * activate/deactivate/delete. `GET /banks`'s default (active-only) results need no permission —
   * any authenticated user can populate a bank-selection dropdown with them, same as before this
   * checkpoint. */
  BANKS_MANAGE: 'banks:manage',
  PAYROLL_ENTRY: 'payroll:entry',
  /** Master-User-only cycle lifecycle action (bootstrap/create a Payroll Cycle) — added Phase 3
   * Checkpoint 1. Distinct from `PAYROLL_ENTRY` (Payroll Staff's day-to-day data-entry
   * permission): creating a cycle is a system-lifecycle action, the same class of action as
   * Finalize Cycle (Phase 5), not routine data entry. */
  PAYROLL_CYCLE_MANAGE: 'payroll-cycle:manage',
  /** Read-only visibility into Payroll Cycles/Entries and per-Unit release status — added Phase 4
   * Checkpoint 2 for Finance, who never holds `PAYROLL_ENTRY` (edit access). Every route this
   * gates also accepts `PAYROLL_ENTRY`, so Payroll Staff's existing edit permission continues to
   * imply view access without a separate grant (docs/architecture/authentication.md's "Finance's
   * permission set"). */
  PAYROLL_VIEW: 'payroll:view',
  PAYROLL_RELEASE: 'payroll:release',
  /** Finance-only (+ Master User) — view, generate, and export Bank Sheets, added Phase 4
   * Checkpoint 3. Reserved by name in `docs/architecture/authentication.md`'s "Finance's
   * permission set" since Phase 3's architecture review; Checkpoint 2 deliberately deferred
   * granting it ("Bank Sheets/Cash Receiving view permissions are deferred to the checkpoint that
   * actually builds them"). Payroll Staff never holds this — Bank Sheets are a Finance/Master User
   * capability only, independent of `PAYROLL_ENTRY`/`PAYROLL_VIEW`. */
  BANK_SHEETS_VIEW: 'bank-sheets:view',
  CORRECTIONS_APPROVE: 'corrections:approve',
  ADVANCES_MANAGE: 'advances:manage',
  REPORTS_VIEW: 'reports:view',
  USERS_MANAGE: 'users:manage',
  SETTINGS_MANAGE: 'settings:manage',
  AUDIT_LOG_VIEW: 'audit-log:view',
  /** Master-User-only (Tasks Workspace, Phase 3.5) — gates create/assign/reassign/edit/delete/
   * cancel/reopen. An assignee needs no permission at all to view their own tasks or mark them
   * complete — ownership-based visibility, not a permission grant
   * (docs/architecture/authentication.md's "Tasks: ownership-based visibility" section). */
  TASKS_MANAGE: 'tasks:manage',
  /** Added Phase 4 Checkpoint 6.1 (Payslips backend foundation) — a dedicated permission, not a
   * reuse of `PAYROLL_ENTRY`/`PAYROLL_VIEW`/`BANK_SHEETS_VIEW` (explicit architecture decision):
   * a Payslip exposes one employee's individual net-salary breakdown, a materially more sensitive
   * per-person disclosure than any aggregate sheet those permissions already gate. Granted to
   * Master Admin, Payroll Staff, and Finance (all three role grants below) — Payroll Staff already
   * prepares and sees individual payroll detail via `PAYROLL_ENTRY`; Finance handles released
   * salary outputs via `PAYROLL_VIEW`/`BANK_SHEETS_VIEW`. Gates view, print, export, and download
   * uniformly — there is no separate "generate" action, since a Payslip is never persisted
   * (derived on demand from released `PayrollEntry` data, Principle 1). */
  PAYSLIPS_VIEW: 'payslips:view',
  /** Added Phase 7A Checkpoint 1 (Employee Statement of Account ledger) — a dedicated permission,
   * not a reuse of `PAYROLL_ENTRY`/`PAYROLL_VIEW`/`CORRECTIONS_APPROVE`/`REPORTS_VIEW`: a Statement
   * exposes one employee's full cross-cycle financial history (corrections, balance adjustments,
   * advances), a materially more sensitive per-person disclosure than any single-cycle document.
   * Default grant matches `PAYSLIPS_VIEW` exactly (Master Admin, Payroll Staff, Finance) — the
   * closest existing precedent for "per-employee financial detail visibility," per the Phase 7
   * architecture report's approved decision. */
  STATEMENTS_VIEW: 'statements:view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_CODES = {
  MASTER_ADMIN: 'MASTER_ADMIN',
  PAYROLL_STAFF: 'PAYROLL_STAFF',
  /** Added Phase 4 Checkpoint 2 (docs/architecture/authentication.md) — executes a Project Unit's
   * release once client funding is confirmed. Neither Payroll Staff's data-entry role nor Master
   * User's governance role; site-scoped identically to Payroll Staff via the same
   * `UserSiteAssignment` table, no new scoping mechanism. */
  FINANCE: 'FINANCE',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

/**
 * Master Admin holds every permission (docs/architecture/authentication.md: "Master Admin has
 * implicit, unrestricted access"). Payroll Staff's and Finance's grants are deliberately narrow,
 * broadened only as each module is actually built, never widened speculatively ahead of the
 * routes that would enforce it.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, PermissionKey[]> = {
  [ROLE_CODES.MASTER_ADMIN]: Object.values(PERMISSIONS),
  [ROLE_CODES.PAYROLL_STAFF]: [
    PERMISSIONS.EMPLOYEES_VIEW,
    PERMISSIONS.EMPLOYEES_EDIT,
    PERMISSIONS.EMPLOYEES_CREATE,
    PERMISSIONS.PAYROLL_ENTRY,
    PERMISSIONS.ADVANCES_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.PAYSLIPS_VIEW,
    PERMISSIONS.STATEMENTS_VIEW,
  ],
  /** Deliberately narrow (docs/architecture/authentication.md "Finance's permission set") — no
   * payroll-edit permission, no `payroll:mark-ready`, no corrections approval. Cash Receiving's
   * own view permission is deferred to the checkpoint that actually builds that module. */
  [ROLE_CODES.FINANCE]: [
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_RELEASE,
    PERMISSIONS.BANK_SHEETS_VIEW,
    PERMISSIONS.PAYSLIPS_VIEW,
    PERMISSIONS.STATEMENTS_VIEW,
  ],
};

/**
 * Administration & Security Management Phase 1 — presentational grouping/labeling for the
 * permission-matrix UI (`GET /api/v1/roles/permissions`, `role-management` frontend). Purely
 * cosmetic: authorization never reads `group`/`label`/`action`, only the permission `key` itself
 * (`requirePermission`, `hasPermission`). Shared between backend (enriches each real `Permission`
 * DB row before returning it) and frontend (renders the same grouping) so the two can never drift
 * — this is what "the frontend must not hardcode the permission matrix as the *sole* source of
 * truth" means in practice: the matrix's *membership* (which keys exist) is DB-driven; its
 * *grouping* is this one shared, presentational lookup, not a frontend-only invention.
 *
 * A permission key with no entry here still round-trips through the catalog API (falls back to an
 * "Other" group in the backend catalog service) — this table is deliberately not treated as a
 * second source of truth for *which permissions exist*, only how to display the ones that do.
 */
export const PERMISSION_GROUPS: Record<PermissionKey, { group: string; label: string }> = {
  [PERMISSIONS.EMPLOYEES_VIEW]: { group: 'Employees', label: 'View employees' },
  [PERMISSIONS.EMPLOYEES_EDIT]: { group: 'Employees', label: 'Edit employees' },
  [PERMISSIONS.EMPLOYEES_CREATE]: { group: 'Employees', label: 'Create employees (incl. import)' },
  [PERMISSIONS.SITES_MANAGE]: { group: 'Sites and Units', label: 'Manage project sites & units' },
  [PERMISSIONS.BANKS_MANAGE]: { group: 'Settings', label: 'Manage bank registry' },
  [PERMISSIONS.PAYROLL_ENTRY]: { group: 'Payroll Entry', label: 'Edit payroll entries' },
  [PERMISSIONS.PAYROLL_CYCLE_MANAGE]: {
    group: 'Payroll Lifecycle',
    label: 'Create, finalize, and archive payroll cycles',
  },
  [PERMISSIONS.PAYROLL_VIEW]: { group: 'Salary Release', label: 'View payroll & salary release' },
  [PERMISSIONS.PAYROLL_RELEASE]: { group: 'Salary Release', label: 'Release payroll by unit' },
  [PERMISSIONS.BANK_SHEETS_VIEW]: {
    group: 'Bank Sheets',
    label: 'View & export bank sheets (also gates Cash Receiving)',
  },
  [PERMISSIONS.CORRECTIONS_APPROVE]: { group: 'Corrections', label: 'Approve or reject corrections' },
  [PERMISSIONS.ADVANCES_MANAGE]: { group: 'Advances', label: 'Manage advances' },
  [PERMISSIONS.REPORTS_VIEW]: { group: 'Reports', label: 'View reports' },
  [PERMISSIONS.USERS_MANAGE]: { group: 'Users', label: 'Manage users and roles' },
  [PERMISSIONS.SETTINGS_MANAGE]: { group: 'Settings', label: 'Manage company settings' },
  [PERMISSIONS.AUDIT_LOG_VIEW]: { group: 'Audit Log', label: 'View audit log' },
  [PERMISSIONS.TASKS_MANAGE]: { group: 'Tasks', label: 'Manage tasks' },
  [PERMISSIONS.PAYSLIPS_VIEW]: { group: 'Payslips', label: 'View & download payslips' },
  [PERMISSIONS.STATEMENTS_VIEW]: { group: 'Statements', label: 'View employee statements of account' },
};

/**
 * The critical permission set the "final active administrator" safeguard requires
 * (Administration & Security Management Phase 1 — `roles.service.ts`'s `assertFinalAdminSafe`).
 * "Full administrative capability" is defined as an *active* user whose *active* role grants every
 * one of these — deliberately not `payroll-cycle:manage`: this safeguard exists to guarantee the
 * *system itself* (users, roles, sites, settings, the audit trail) always remains administrable,
 * not to guarantee someone can always run payroll, which is an operational capability, not an
 * administrative one. See docs/architecture/authentication.md for the full rationale.
 */
export const CRITICAL_ADMIN_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.SITES_MANAGE,
  PERMISSIONS.AUDIT_LOG_VIEW,
];
