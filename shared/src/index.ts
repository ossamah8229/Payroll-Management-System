// Explicit named re-exports rather than `export *` — TypeScript compiles `export *` to a
// dynamic __exportStar helper in CommonJS output, which Rollup's static CJS-to-ESM interop
// (used by the frontend's Vite build) cannot see through, causing named imports to silently
// fail to resolve. Named re-exports compile to statically analyzable per-export bindings instead.

export { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from './constants/permissions';
export type { PermissionKey, RoleCode } from './constants/permissions';

export { loginSchema } from './schemas/auth';
export type { LoginInput } from './schemas/auth';

export { createProjectSiteSchema, updateProjectSiteSchema } from './schemas/project-site';
export type { CreateProjectSiteInput, UpdateProjectSiteInput } from './schemas/project-site';

export { createProjectUnitSchema, updateProjectUnitSchema } from './schemas/project-unit';
export type { CreateProjectUnitInput, UpdateProjectUnitInput } from './schemas/project-unit';

export { createEmployeeSchema, markEmployeeLeftSchema, updateEmployeeSchema } from './schemas/employee';
export type {
  CreateEmployeeInput,
  MarkEmployeeLeftInput,
  UpdateEmployeeInput,
} from './schemas/employee';

export { changePasswordSchema, updateProfileSchema } from './schemas/profile';
export type { ChangePasswordInput, UpdateProfileInput } from './schemas/profile';

export { updateCompanySettingsSchema } from './schemas/company-settings';
export type { UpdateCompanySettingsInput } from './schemas/company-settings';

export { createUserSchema, resetUserPasswordSchema, updateUserSchema } from './schemas/user';
export type { CreateUserInput, ResetUserPasswordInput, UpdateUserInput } from './schemas/user';

export type { SessionUser } from './types/session-user';

export { formatDate, isoDateToUtcDate, parseDateInput, toIsoDateOnly } from './lib/date';
export { pluralize } from './lib/text';
export { normalizeCnic } from './lib/cnic';
