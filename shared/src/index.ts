// Explicit named re-exports rather than `export *` — TypeScript compiles `export *` to a
// dynamic __exportStar helper in CommonJS output, which Rollup's static CJS-to-ESM interop
// (used by the frontend's Vite build) cannot see through, causing named imports to silently
// fail to resolve. Named re-exports compile to statically analyzable per-export bindings instead.

export { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from './constants/permissions';
export type { PermissionKey, RoleCode } from './constants/permissions';

export { loginSchema } from './schemas/auth';
export type { LoginInput } from './schemas/auth';

export type { SessionUser } from './types/session-user';
