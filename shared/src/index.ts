// Explicit named re-exports rather than `export *` — TypeScript compiles `export *` to a
// dynamic __exportStar helper in CommonJS output, which Rollup's static CJS-to-ESM interop
// (used by the frontend's Vite build) cannot see through, causing named imports to silently
// fail to resolve. Named re-exports compile to statically analyzable per-export bindings instead.

export { CRITICAL_ADMIN_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from './constants/permissions';
export type { PermissionKey, RoleCode } from './constants/permissions';

export { CASH_BANK_CODE } from './constants/bank';
export { MAX_BATCH_PAYSLIPS_PER_REQUEST } from './constants/payslips';

export { loginSchema } from './schemas/auth';
export type { LoginInput } from './schemas/auth';

export { createBankSchema, updateBankSchema } from './schemas/bank';
export type { CreateBankInput, UpdateBankInput } from './schemas/bank';

export { createProjectSiteSchema, PROJECT_SITE_FIELD_LIMITS, updateProjectSiteSchema } from './schemas/project-site';
export type { CreateProjectSiteInput, UpdateProjectSiteInput } from './schemas/project-site';

export { createProjectUnitSchema, updateProjectUnitSchema } from './schemas/project-unit';
export type { CreateProjectUnitInput, UpdateProjectUnitInput } from './schemas/project-unit';

export {
  createEmployeeSchema,
  EMPLOYEE_EOBI_AMOUNT_MAX,
  EMPLOYEE_FIELD_LIMITS,
  EMPLOYEE_GROSS_PAY_MAX,
  markEmployeeLeftSchema,
  PAY_TYPE_LABELS,
  PAY_TYPE_VALUES,
  updateEmployeeSchema,
} from './schemas/employee';
export type {
  CreateEmployeeInput,
  MarkEmployeeLeftInput,
  PayTypeValue,
  UpdateEmployeeInput,
} from './schemas/employee';

export { changePasswordSchema, updateProfileSchema } from './schemas/profile';
export type { ChangePasswordInput, UpdateProfileInput } from './schemas/profile';

export { updateCompanySettingsSchema } from './schemas/company-settings';
export type { UpdateCompanySettingsInput } from './schemas/company-settings';

export { createUserSchema, resetUserPasswordSchema, updateUserSchema } from './schemas/user';
export type { CreateUserInput, ResetUserPasswordInput, UpdateUserInput } from './schemas/user';

export { createRoleSchema, duplicateRoleSchema, updateRoleSchema } from './schemas/role';
export type { CreateRoleInput, DuplicateRoleInput, UpdateRoleInput } from './schemas/role';

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
  cancelAdvanceSchema,
  createAdvanceSchema,
  deferAdvanceScheduleSchema,
  listAdvancesQuerySchema,
  updateAdvanceSchema,
} from './schemas/advance';
export type {
  AdvanceRepaymentType,
  AdvanceStatus,
  AdvanceType,
  CancelAdvanceInput,
  CreateAdvanceInput,
  DeferAdvanceScheduleInput,
  ListAdvancesQuery,
  UpdateAdvanceInput,
} from './schemas/advance';

export {
  approveCorrectionRequestSchema,
  balanceAdjustmentPaymentTimingSchema,
  balanceAdjustmentStatusSchema,
  balanceAdjustmentTypeSchema,
  correctionFieldSchema,
  correctionRequestStatusSchema,
  createCorrectionRequestSchema,
  listBalanceAdjustmentsQuerySchema,
  listCorrectionRequestsQuerySchema,
  materializeBalanceAdjustmentSchema,
  previewCorrectionSchema,
  previewSettlementSchema,
  recordBalanceAdjustmentSettlementSchema,
  recordCorrectionPaymentSchema,
  rejectCorrectionRequestSchema,
  WORK_LINE_CORRECTION_FIELDS,
} from './schemas/correction';
export type {
  ApproveCorrectionRequestInput,
  BalanceAdjustmentPaymentTiming,
  BalanceAdjustmentStatus,
  BalanceAdjustmentType,
  CorrectionField,
  CorrectionRequestStatus,
  CreateCorrectionRequestInput,
  ListBalanceAdjustmentsQuery,
  ListCorrectionRequestsQuery,
  MaterializeBalanceAdjustmentInput,
  PreviewCorrectionInput,
  PreviewSettlementInput,
  RecordBalanceAdjustmentSettlementInput,
  RecordCorrectionPaymentInput,
  RejectCorrectionRequestInput,
} from './schemas/correction';

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

export { batchPayslipsSchema } from './schemas/payslip';
export type { BatchPayslipsInput } from './schemas/payslip';

export type { SessionUser } from './types/session-user';

export { decimalString } from './schemas/common';

export { formatDate, isoDateToUtcDate, parseDateInput, toIsoDateOnly } from './lib/date';
export { pluralize } from './lib/text';
export { normalizeCnic } from './lib/cnic';
export { normalizeIban, normalizeAccountNumber } from './lib/banking';
export { formatMoney, formatNumber } from './lib/number';
export { calcNet, sumMoney } from './lib/calc-net';
export type {
  CalcNetResult,
  MoneyInput,
  PayrollEntryCalcInput,
  PayrollWorkLineCalcInput,
  PayrollWorkLineCalcResult,
} from './lib/calc-net';
