import { z } from 'zod';

/**
 * Administration & Security Management Phase 1 — `roleId` (a real `Role.id`) replaces the old
 * `roleCode` enum fixed to `MASTER_ADMIN | PAYROLL_STAFF | FINANCE`. Any active, assignable role —
 * seeded or administrator-created — can be selected; validity (exists, active) is checked at the
 * service layer (`users.service.ts`), which is also where the "final active administrator" and
 * site-assignment rules live, not here.
 */
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleId: z.string().uuid('A valid role is required'),
  /** Ignored for Master Admin (implicit, unrestricted access — no assignment rows). */
  siteIds: z.array(z.string().uuid()).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  isActive: z.boolean().optional(),
  roleId: z.string().uuid('A valid role is required').optional(),
  siteIds: z.array(z.string().uuid()).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetUserPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
