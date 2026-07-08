import type { CreateProjectSiteInput, SessionUser, UpdateProjectSiteInput } from '@payroll/shared';
import { ROLE_CODES } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';

/**
 * Master Admin sees every site (implicit, unrestricted access); Payroll Staff sees only their
 * assigned sites — the same site-scoping rule applied everywhere else
 * (docs/architecture/authentication.md), so this list can double as a management view for Master
 * Admin and a scoped dropdown source for Payroll Staff.
 */
export async function listProjectSites(currentUser: SessionUser) {
  const isMasterAdmin = currentUser.roleCode === ROLE_CODES.MASTER_ADMIN;

  return prisma.projectSite.findMany({
    where: isMasterAdmin ? {} : { id: { in: currentUser.siteIds } },
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

export async function createProjectSite(input: CreateProjectSiteInput) {
  return prisma.projectSite.create({
    data: {
      name: input.name,
      address: input.address ?? null,
      ...(input.unitLabel !== undefined && { unitLabel: input.unitLabel }),
    },
  });
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
