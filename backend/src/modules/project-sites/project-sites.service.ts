import type { CreateProjectSiteInput, SessionUser, UpdateProjectSiteInput } from '@payroll/shared';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { prisma, type PrismaTransactionClient } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { isMasterAdmin } from '../../common/authz-policy';
import { ensureCreatorSiteAssignment } from '../../common/creator-access';

/**
 * UAT Defect 1 correction (Post-Phase-5 Stabilization Checkpoint 4D correction) — `sites:manage`
 * is one of this system's `CRITICAL_ADMIN_PERMISSIONS` (`shared/src/constants/permissions.ts`),
 * the same class as `users:manage`/`settings:manage`/`audit-log:view` — every one of which is a
 * global, unscoped administrative capability, never site-scoped. A holder of `sites:manage`
 * administers the Site *entity list itself* (create/edit/deactivate/delete any site), which has no
 * meaningful "assigned site" concept to scope by in the first place — a not-yet-created site can't
 * already be in anyone's `UserSiteAssignment` rows, which is exactly why a brand-new custom role
 * granted only `sites:manage` (no site assignments, since none make sense yet) could previously
 * create a site but then see an empty list: `createProjectSite` was correctly unscoped, but this
 * function still gated *visibility* on `UserSiteAssignment` rows for every role except the
 * literal seeded Master Admin.
 *
 * The Master Admin `roleCode` fast path is kept, not replaced — it's the same bypass identity used
 * everywhere else in this system (`require-site-access.ts`, `employees.service.ts`'s
 * `isMasterAdmin`), deliberately unrelated to permissions, and this function should stay
 * consistent with it. `sites:manage` is the *additional* path: any role — system or custom — that
 * currently holds it gets the same unrestricted visibility, exactly as it already gets unrestricted
 * create/edit/delete. Everyone else (Payroll Staff, Finance, or a custom role without
 * `sites:manage`) is unchanged — still scoped to their own `UserSiteAssignment` rows, since they
 * only need to see the sites they actually operate within, not administer.
 */
export async function listProjectSites(currentUser: SessionUser) {
  const hasGlobalSiteVisibility =
    currentUser.roleCode === ROLE_CODES.MASTER_ADMIN || currentUser.permissions.includes(PERMISSIONS.SITES_MANAGE);

  return prisma.projectSite.findMany({
    where: hasGlobalSiteVisibility ? {} : { id: { in: currentUser.siteIds } },
    orderBy: { name: 'asc' },
  });
}

export async function getProjectSite(id: string) {
  const site = await prisma.projectSite.findUnique({ where: { id } });

  if (!site) {
    throw notFound('Project site not found');
  }

  return site;
}

/**
 * RBAC Creator Ownership checkpoint (2026-07-25) — a scoped user (e.g. a custom "Payroll Manager"
 * role holding only `sites:manage`, no pre-existing `UserSiteAssignment` rows) could previously
 * create a Project Site and then immediately lose the ability to use it: `sites:manage` is
 * deliberately a global *administrative* permission (create/edit/delete the site entity), never an
 * *operational* one (`authz-policy.ts`'s doc comment) — every operational module (Employees,
 * Payroll Entry, Advances, ...) still gates on `UserSiteAssignment`, which nothing populated for
 * the site the creator had just made. A Master Admin had to manually assign it back.
 *
 * Fixed by the general creator-access invariant (`common/creator-access.ts`): creation and the
 * creator's own assignment happen atomically, in the same transaction, so the two can never
 * observably diverge (a crash between them could otherwise leave a site with no assignment even
 * for its own creator). `ensureCreatorSiteAssignment` is idempotent and skips Master Admin
 * (unconditional access already, no assignment row needed) — this never widens the creator's
 * access to any site other than the one just created, and never assigns anyone else.
 *
 * `createdById` itself is audit provenance only (nullable — see the schema comment); no access
 * decision anywhere in the codebase reads it.
 *
 * The transaction body itself is factored out into `createProjectSiteInTransaction` below
 * (Import Template Contract checkpoint, Project Site bulk-import extension) so bulk import can
 * compose it with an *additional* operation (creating the row's initial Project Unit) inside one
 * shared transaction, without duplicating this function's own site-creation/creator-assignment
 * logic — `createProjectSite` itself is otherwise unchanged, and manual "New Site" creation still
 * never creates a Unit, exactly as before.
 */
export async function createProjectSite(currentUser: SessionUser, input: CreateProjectSiteInput) {
  return prisma.$transaction((tx) => createProjectSiteInTransaction(tx, currentUser, input));
}

/** The actual site-creation + creator-assignment work, parameterized over an already-open
 * transaction client — see `createProjectSite`'s own doc comment for why this is split out. */
export async function createProjectSiteInTransaction(
  tx: PrismaTransactionClient,
  currentUser: SessionUser,
  input: CreateProjectSiteInput,
) {
  const site = await tx.projectSite.create({
    data: {
      name: input.name,
      address: input.address ?? null,
      createdById: currentUser.id,
      ...(input.unitLabel !== undefined && { unitLabel: input.unitLabel }),
    },
  });

  await ensureCreatorSiteAssignment(tx, {
    creatorIsMasterAdmin: isMasterAdmin(currentUser),
    userId: currentUser.id,
    siteId: site.id,
  });

  return site;
}

export async function updateProjectSite(id: string, input: UpdateProjectSiteInput) {
  await getProjectSite(id);

  return prisma.projectSite.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.unitLabel !== undefined && { unitLabel: input.unitLabel }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

/**
 * Delete is blocked while any employee is still assigned to this site, or any `ProjectUnit` still
 * belongs to it (`PROJECT_SPEC.md`, docs/architecture/database/sites-and-units.md §8's 2026-07-03 revision
 * note) — checked here at the application layer for a clean error message, backed by
 * `Employee.siteId`'s and `ProjectUnit.siteId`'s `ON DELETE RESTRICT` as database-level backstops
 * that hold even if this check is ever bypassed by a bug or a raw query. A site must have both its
 * units and its employees cleared before it can be deleted.
 */
export async function deleteProjectSite(id: string): Promise<void> {
  await getProjectSite(id);

  const employeeCount = await prisma.employee.count({ where: { siteId: id } });
  if (employeeCount > 0) {
    throw badRequest(
      `Cannot delete this site while ${employeeCount} employee(s) are still assigned to it`,
    );
  }

  const unitCount = await prisma.projectUnit.count({ where: { siteId: id } });
  if (unitCount > 0) {
    throw badRequest(
      `Cannot delete this site while ${unitCount} unit(s) still belong to it`,
    );
  }

  await prisma.projectSite.delete({ where: { id } });
}
