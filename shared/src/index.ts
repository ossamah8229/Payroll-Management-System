// Explicit named re-exports rather than `export *` — TypeScript compiles `export *` to a
// dynamic __exportStar helper in CommonJS output, which Rollup's static CJS-to-ESM interop
// (used by the frontend's Vite build) cannot see through, causing named imports to silently
// fail to resolve. Named re-exports compile to statically analyzable per-export bindings instead.

export { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from './constants/permissions';
export type { PermissionKey, RoleCode } from './constants/permissions';

export { CASH_BANK_CODE } from './constants/bank';

export { loginSchema } from './schemas/auth';
export type { LoginInput } from './schemas/auth';

export { createBankSchema, updateBankSchema } from './schemas/bank';
export type { CreateBankInput, UpdateBankInput } from './schemas/bank';

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

export { createPayrollCycleSchema } from './schemas/payroll-cycle';
export type { CreatePayrollCycleInput } from './schemas/payroll-cycle';

export {
  addWorkLineSchema,
  bulkUpdatePayrollEntriesSchema,
  createPayrollEntrySchema,
  entryWorkLineSeedSchema,
  updatePayrollEntrySchema,
  updateWorkLineSchema,
} from './schemas/payroll-entry';
export type {
  AddWorkLineInput,
  BulkUpdatePayrollEntriesInput,
  CreatePayrollEntryInput,
  EntryWorkLineSeedInput,
  UpdatePayrollEntryInput,
  UpdateWorkLineInput,
} from './schemas/payroll-entry';

export {
  advanceRepaymentTypeSchema,
  advanceStatusSchema,
  advanceTypeSchema,
  createAdvanceSchema,
  deferAdvanceScheduleSchema,
  listAdvancesQuerySchema,
  updateAdvanceSchema,
} from './schemas/advance';
export type {
  AdvanceRepaymentType,
  AdvanceStatus,
  AdvanceType,
  CreateAdvanceInput,
  DeferAdvanceScheduleInput,
  ListAdvancesQuery,
  UpdateAdvanceInput,
} from './schemas/advance';

export {
  createTaskSchema,
  listTasksQuerySchema,
  taskPrioritySchema,
  taskStatusSchema,
  updateTaskSchema,
} from './schemas/task';
export type {
  CreateTaskInput,
  ListTasksQuery,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from './schemas/task';

export type { SessionUser } from './types/session-user';

export { decimalString } from './schemas/common';

export { formatDate, isoDateToUtcDate, parseDateInput, toIsoDateOnly } from './lib/date';
export { pluralize } from './lib/text';
export { normalizeCnic } from './lib/cnic';
export { formatMoney, formatNumber } from './lib/number';
export { calcNet, sumMoney } from './lib/calc-net';
export type {
  CalcNetResult,
  MoneyInput,
  PayrollEntryCalcInput,
  PayrollWorkLineCalcInput,
  PayrollWorkLineCalcResult,
} from './lib/calc-net';
