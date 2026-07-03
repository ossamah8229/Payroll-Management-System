import type { CreateProjectUnitInput, UpdateProjectUnitInput } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../common/http-error';
import { getProjectSite } from '../project-sites/project-sites.service';

/**
 * Dedicated master-data module for `ProjectUnit` (docs/architecture/database-schema.md §8a) — not
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
 * (docs/architecture/database-schema.md §8a) — same defense-in-depth pattern as every other
 * referenced-master-data delete in this schema (app-layer check here, `ON DELETE RESTRICT` as the
 * database-level backstop once those FKs exist).
 *
 * **Sequencing note**: `Employee.unitId` does not exist yet as of this checkpoint (Phase 2.5,
 * Checkpoint 1) — it lands in Checkpoint 2, and `PayrollEntryWorkLine.unitId` in Phase 3. Until
 * then this function has no real dependent to check against, so deletion is unconditional; the
 * moment Checkpoint 2 lands, an `Employee.count({ where: { unitId: id } })` guard belongs here,
 * mirroring `deleteProjectSite`'s employee-count check exactly. Flagged explicitly so this isn't
 * mistaken for a finished guard.
 */
export async function deleteProjectUnit(id: string): Promise<void> {
  await getProjectUnit(id);

  await prisma.projectUnit.delete({ where: { id } });
}
