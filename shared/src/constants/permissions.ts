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
  ],
  /** Deliberately narrow (docs/architecture/authentication.md "Finance's permission set") — no
   * payroll-edit permission, no `payroll:mark-ready`, no corrections approval. Bank Sheets/Cash
   * Receiving view permissions are deferred to the checkpoint that actually builds them. */
  [ROLE_CODES.FINANCE]: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE],
};
