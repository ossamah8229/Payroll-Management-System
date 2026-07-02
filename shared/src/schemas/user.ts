import { z } from 'zod';
import { ROLE_CODES } from '../constants/permissions';

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleCode: z.enum([ROLE_CODES.MASTER_ADMIN, ROLE_CODES.PAYROLL_STAFF]),
  /** Ignored for Master Admin (implicit, unrestricted access — no assignment rows). */
  siteIds: z.array(z.string().uuid()).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  isActive: z.boolean().optional(),
  siteIds: z.array(z.string().uuid()).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetUserPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
