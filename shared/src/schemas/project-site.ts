import { z } from 'zod';

export const createProjectSiteSchema = z.object({
  name: z.string().trim().min(1, 'Site name is required').max(160),
  branchCode: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
});

export type CreateProjectSiteInput = z.infer<typeof createProjectSiteSchema>;

export const updateProjectSiteSchema = z.object({
  name: z.string().trim().min(1, 'Site name is required').max(160).optional(),
  branchCode: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateProjectSiteInput = z.infer<typeof updateProjectSiteSchema>;
