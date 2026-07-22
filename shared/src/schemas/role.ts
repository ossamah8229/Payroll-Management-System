import { z } from 'zod';

/**
 * Administration & Security Management Phase 1 — administrator-defined roles. `name` is a free-text
 * display label (any name an administrator chooses — "Accounts Department", "Lahore Payroll
 * Officer," etc. are all valid); uniqueness is enforced case-insensitively at the service layer,
 * not here (a DB round trip is required either way). `permissionKeys` is validated against the
 * real `Permission` table's own registry at the service layer too — an unknown key is rejected
 * there, not by this schema (the schema only knows the shape of a valid *request*, not which keys
 * currently exist in the database).
 */
export const createRoleSchema = z.object({
  name: z.string().trim().min(1, 'Role name is required').max(80),
  description: z.string().trim().max(500).nullable().optional(),
  permissionKeys: z.array(z.string().min(1)).default([]),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/** All fields optional — a rename-only or description-only or permissions-only edit are all
 * valid partial updates. `permissionKeys`, when provided, *replaces* the role's entire permission
 * set atomically (never a partial add/remove) — see `roles.service.ts`'s `updateRole`. */
export const updateRoleSchema = z.object({
  name: z.string().trim().min(1, 'Role name is required').max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  permissionKeys: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const duplicateRoleSchema = z.object({
  newName: z.string().trim().min(1, 'Role name is required').max(80),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

export type DuplicateRoleInput = z.infer<typeof duplicateRoleSchema>;
