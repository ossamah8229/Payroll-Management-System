import { z } from 'zod';

export const createProjectSiteSchema = z.object({
  name: z.string().trim().min(1, 'Site name is required').max(160),
  address: z.string().trim().max(300).nullable().optional(),
  /** The term this site's own business uses for its operational sub-divisions (e.g. "Branch",
   * "Department", "Section") — drives every place the UI names a ProjectUnit for this site
   * (docs/architecture/database-schema.md §8). Free text, not an enum, on purpose. */
  unitLabel: z.string().trim().min(1, 'Unit label is required').max(40).optional(),
});

export type CreateProjectSiteInput = z.infer<typeof createProjectSiteSchema>;

export const updateProjectSiteSchema = z.object({
  name: z.string().trim().min(1, 'Site name is required').max(160).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  unitLabel: z.string().trim().min(1, 'Unit label is required').max(40).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateProjectSiteInput = z.infer<typeof updateProjectSiteSchema>;
