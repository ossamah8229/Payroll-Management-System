import { z } from 'zod';

export const createProjectUnitSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  code: z.string().trim().max(20).nullable().optional(),
});

export type CreateProjectUnitInput = z.infer<typeof createProjectUnitSchema>;

export const updateProjectUnitSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160).optional(),
  code: z.string().trim().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateProjectUnitInput = z.infer<typeof updateProjectUnitSchema>;
