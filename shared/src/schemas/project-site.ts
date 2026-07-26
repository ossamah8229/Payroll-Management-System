import { z } from 'zod';

/**
 * Canonical field-length limits for `ProjectSite` — mirrors `backend/prisma/schema.prisma`'s
 * `@db.VarChar(n)` column definitions exactly, same pattern/rationale as `EMPLOYEE_FIELD_LIMITS`
 * (`shared/src/schemas/employee.ts`). The Project Site import template (Import Templates
 * checkpoint, `backend/src/modules/project-sites/project-sites-import-export.service.ts`) reads
 * these same constants for its own Excel text-length validation and Column Guide documentation,
 * so the template can never silently drift from what the API/database actually accept.
 */
export const PROJECT_SITE_FIELD_LIMITS = {
  /** `ProjectSite.name @db.VarChar(160)` — also the table's only `@unique` column. */
  name: 160,
  /** `ProjectSite.address @db.VarChar(300)` */
  address: 300,
  /** `ProjectSite.unitLabel @db.VarChar(40)` */
  unitLabel: 40,
} as const;

export const createProjectSiteSchema = z.object({
  name: z.string().trim().min(1, 'Site name is required').max(PROJECT_SITE_FIELD_LIMITS.name),
  address: z.string().trim().max(PROJECT_SITE_FIELD_LIMITS.address).nullable().optional(),
  /** The term this site's own business uses for its operational sub-divisions (e.g. "Branch",
   * "Department", "Section") — drives every place the UI names a ProjectUnit for this site
   * (docs/architecture/database/sites-and-units.md §8). Free text, not an enum, on purpose. */
  unitLabel: z.string().trim().min(1, 'Unit label is required').max(PROJECT_SITE_FIELD_LIMITS.unitLabel).optional(),
});

export type CreateProjectSiteInput = z.infer<typeof createProjectSiteSchema>;

export const updateProjectSiteSchema = z.object({
  name: z.string().trim().min(1, 'Site name is required').max(PROJECT_SITE_FIELD_LIMITS.name).optional(),
  address: z.string().trim().max(PROJECT_SITE_FIELD_LIMITS.address).nullable().optional(),
  unitLabel: z.string().trim().min(1, 'Unit label is required').max(PROJECT_SITE_FIELD_LIMITS.unitLabel).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateProjectSiteInput = z.infer<typeof updateProjectSiteSchema>;
