import type { CreateProjectUnitInput, UpdateProjectUnitInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { getProjectSite } from '../project-sites/project-sites.service';

/**
 * Dedicated master-data module for `ProjectUnit` (docs/architecture/database/sites-and-units.md §8a) — not
 * folded into the Project Sites module's own CRUD, per the 2026-07-03 architecture decision.
 * Site-level access control (Master Admin unrestricted, Payroll Staff scoped to their assigned
 * sites) is enforced at the route layer via `requireSiteAccess`, the same middleware
 * `docs/architecture/authentication.md` already documents for exactly this shape of route.
 */

export async function listProjectUnits(siteId: string) {
  await getProjectSite(siteId); // 404s a nonexistent siteId with a clean error, not a bare empty list

  return prisma.projectUnit.findMany({
    where: { siteId },
    orderBy: { name: 'asc' },
  });
}

export async function createProjectUnit(siteId: string, input: CreateProjectUnitInput) {
  await getProjectSite(siteId);

  return prisma.projectUnit.create({
    data: {
      siteId,
      name: input.name,
      code: input.code ?? null,
    },
  });
}

async function getProjectUnit(id: string) {
  const unit = await prisma.projectUnit.findUnique({ where: { id } });

  if (!unit) {
    throw notFound('Project unit not found');
  }

  return unit;
}

export async function updateProjectUnit(id: string, input: UpdateProjectUnitInput) {
  await getProjectUnit(id);

  return prisma.projectUnit.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.code !== undefined && { code: input.code }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

/**
 * Delete is blocked while any Employee or PayrollEntryWorkLine still references this unit
 * (docs/architecture/database/sites-and-units.md §8a) — same defense-in-depth pattern as every other
 * referenced-master-data delete in this schema (app-layer check here, `ON DELETE RESTRICT` as the
 * database-level backstop). The `Employee.unitId` half of this guard is now live (Phase 2.5,
 * Checkpoint 2); the `PayrollEntryWorkLine.unitId` half lands in Phase 3 and belongs here too once
 * that table exists.
 */
export async function deleteProjectUnit(id: string): Promise<void> {
  await getProjectUnit(id);

  const employeeCount = await prisma.employee.count({ where: { unitId: id } });
  if (employeeCount > 0) {
    throw badRequest(
      `Cannot delete this unit while ${employeeCount} employee(s) are still assigned to it`,
    );
  }

  await prisma.projectUnit.delete({ where: { id } });
}
