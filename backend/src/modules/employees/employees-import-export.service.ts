import ExcelJS from 'exceljs';
import {
  createEmployeeSchema,
  EMPLOYEE_EOBI_AMOUNT_MAX,
  EMPLOYEE_FIELD_LIMITS,
  EMPLOYEE_GROSS_PAY_MAX,
  formatDate,
  isoDateToUtcDate,
  PAY_TYPE_LABELS,
  PAY_TYPE_VALUES,
  pluralize,
  type PayTypeValue,
} from '@payroll/shared';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../common/http-error';
import {
  addColumnGuideTable,
  assertExactHeaderMatch,
  buildExampleSheet,
  createInstructionsSheet,
  formatImportValidationError,
  parseTableFromFile,
  STANDARD_EXAMPLE_SHEET_NAME,
  STANDARD_IMPORT_DATA_SHEET_NAME,
  STANDARD_INSTRUCTIONS_SHEET_NAME,
  stringifyCsvSafe,
  styleImportDataSheet,
  type ImportColumnSpec,
  type ImportRowError,
} from '../../common/import-export';
import {
  assertUnitBelongsToSite,
  findEmployeeByCnic,
  listEmployees,
  reactivateEmployee,
  recordEmployeeTransfer,
  type RequestMeta,
} from './employees.service';
import { assertSiteAccess } from '../../common/authz-policy';
import { syncEmployeeIntoCurrentDraftCycle } from '../payroll-processing/payroll-processing.service';
import { listProjectSites } from '../project-sites/project-sites.service';
import { listBanks } from '../banks/banks.service';

/**
 * The official Employee Registry template header set, in column order — extracted verbatim from
 * real client files (reference/PROJECT_SPEC.md, "Official Data Template") for columns 1–19; this
 * exact set (plus the four fields below) is required, not a house style. The importer maps a row
 * to `createEmployeeSchema` positionally by this order (`rowsFromTable`), so column order here is
 * load-bearing, not cosmetic — see `assertExactHeaderMatch`'s structural-mismatch reporting
 * (`backend/src/common/import-export.ts`, shared with the Project Site importer).
 *
 * **Column mapping finalized in Phase 2.5 Checkpoint 3** (docs/architecture/database/sites-and-units.md
 * §8's revision note: these columns map onto `ProjectUnit` fields, not `ProjectSite` ones):
 * - `Project` → the employee's `ProjectSite.name` (unchanged).
 * - `Area` → the employee's `ProjectUnit.name` — the operational Branch/Department/Section.
 * - `Branch Code` → the employee's `ProjectUnit.code` (never the site's — `ProjectSite.branchCode`
 *   no longer exists; also unrelated to `Bank Branch Code`, the employee's own bank's code).
 * - `Area/Location` → alias of `Area` (`ProjectUnit.name`) — the source template's two
 *   near-duplicate columns are both unit-level; they previously both aliased the site name here.
 * On import, a row's unit is resolved within its named site by `Branch Code` first, then
 * `Area`/`Area/Location`; every provided column must agree on one unit (see importEmployees).
 *
 * **Pay Type / IBAN / Default EOBI Amount / Default EOBI Applicable added (Import Templates
 * checkpoint):** all four are real, user-editable fields on the manual Employee create/edit form
 * (`frontend/src/routes/employees-page.tsx`) and real optional columns on `Employee` itself, but
 * were missing from every prior version of this template — a bulk-imported employee could never
 * be given a Monthly pay type, an IBAN, or a non-default EOBI configuration, only ever created via
 * the manual form and edited afterwards. Adding them closes that template/application contract gap
 * (Part D's "the application must not secretly require/support something the template doesn't
 * present" principle) rather than expanding scope — the field already existed everywhere else.
 *
 * **`Project Bank` renamed to `Employee Bank` (post-deployment UAT correction)** — the original
 * name was misleading (these columns describe the *employee's own* payment/banking details, not a
 * property of the Project). `"Project Bank"` is still accepted on upload as a legacy header alias
 * (`LEGACY_HEADER_ALIASES` below) so a previously-downloaded template keeps working; every newly
 * generated template uses the new name.
 *
 * **`Employee Bank` made explicitly required (final refinement, same checkpoint)** — a blank cell
 * is rejected, not silently treated as `"Cash"`: every row must say `"Cash"` or a real bank name.
 * `bankId: null` remains the single internal representation of a cash-paid employee either way
 * (`"Cash"` is a parsing-only sentinel, never a real `Bank` row selection — see `importEmployees`);
 * only the *input contract* tightened, removing the ambiguity of "did this row intend Cash, or did
 * the operator just skip this column."
 */
export const EMPLOYEE_TEMPLATE_HEADERS = [
  'Sr. No',
  'Project',
  'Employee Number/Code',
  'Religion',
  'Name',
  'Father Name',
  'CNIC',
  'DOB',
  'DOJ',
  'DOL',
  'Mobile Number',
  'Designation',
  'Area',
  'Branch Code',
  'Area/Location',
  'Employee Bank',
  'Bank Branch Code',
  'Account Number',
  'Basic/Gross Pay',
  'Pay Type',
  'IBAN',
  'Default EOBI Amount',
  'Default EOBI Applicable',
] as const;

/** Upload-only header aliasing (post-deployment UAT correction) — a header cell matching a key
 * here is treated as if it read the mapped, current canonical name before structural validation
 * runs, so a workbook downloaded before the `Project Bank` → `Employee Bank` rename above still
 * imports without modification. Never used for anything the user sees (Instructions/Column Guide/
 * Example/newly generated Import Data headers all use the canonical name only) — purely a
 * backward-compatibility shim at the parsing boundary. */
const LEGACY_HEADER_ALIASES: Readonly<Record<string, string>> = {
  'Project Bank': 'Employee Bank',
};

/** Bumped whenever `EMPLOYEE_TEMPLATE_HEADERS` changes shape — stamped into the Instructions sheet
 * purely as a human-readable diagnostic aid (Part G). The importer never reads or enforces this
 * value: `assertExactHeaderMatch`'s structural comparison against the live header set already
 * deterministically catches an outdated template (missing/extra/reordered columns) even if a user
 * hand-edited the workbook and the version stamp went stale or was deleted, so parsing never
 * depends on it. */
export const EMPLOYEE_TEMPLATE_VERSION = 3;

export const IMPORT_DATA_SHEET_NAME = STANDARD_IMPORT_DATA_SHEET_NAME;
export const EXAMPLE_SHEET_NAME = STANDARD_EXAMPLE_SHEET_NAME;
export const INSTRUCTIONS_SHEET_NAME = STANDARD_INSTRUCTIONS_SHEET_NAME;
const LISTS_SHEET_NAME = 'Lists';

const REQUIRED_TEXT = (max: number) => `Text, up to ${max} characters`;

/** The `listContext` shape this module passes to `styleImportDataSheet` — two *independent* row
 * counts, one per "Lists" sheet column (post-deployment UAT correction: the Project and Employee
 * Bank dropdowns previously shared one `Math.max(sites, banks)` count, so whichever list was
 * shorter had its Excel validation range padded with blank rows past its own real data — see
 * `buildValidation`'s doc comment on `ImportColumnSpec`, `common/import-export.ts`). */
interface EmployeeListContext {
  siteRowCount: number;
  bankRowCount: number;
}

/**
 * Per-column contract for the downloadable Employee import template (Import Templates checkpoint)
 * — the single source for the Instructions sheet's "Column Guide" table, the Import Data sheet's
 * required/optional header styling and Excel validation, and the Example sheet's sample row, so
 * all three (and the importer's own error messages) describe the same 23 columns rather than three
 * independently hand-maintained copies. Every `maxLength` here is `EMPLOYEE_FIELD_LIMITS`/
 * `EMPLOYEE_GROSS_PAY_MAX`/`EMPLOYEE_EOBI_AMOUNT_MAX` from `@payroll/shared` — the exact same
 * constants `createEmployeeSchema` validates against and that mirror `Employee`'s own
 * `@db.VarChar(n)`/`@db.Decimal(p,s)` column definitions, never a re-typed number.
 *
 * Built as a plain array of the shared `ImportColumnSpec` shape (`common/import-export.ts`) — four
 * columns (Project, Employee Bank, Pay Type, Default EOBI Applicable) supply their own
 * `buildValidation` for a dropdown sourced from the "Lists" sheet below or an inline enum list;
 * three (Area, Area/Location, Account Number) supply one for a cross-field custom formula
 * (Part C6's "Excel-enforceable" cross-field rules) — everything else uses the generic
 * text/number/date default `styleImportDataSheet` falls back to.
 */
const EMPLOYEE_TEMPLATE_COLUMNS: readonly ImportColumnSpec[] = [
  {
    header: 'Sr. No',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: 'Any',
    example: '1',
    notes: 'Not imported — a convenience column for the source file only.',
  },
  {
    header: 'Project',
    requirement: 'required',
    dataType: 'enum',
    allowedFormat: 'Must exactly match an existing Project Site name (see the "Project" dropdown)',
    example: 'Downtown Regional Office',
    notes:
      'Must exactly match an existing Project Site name — matched case-insensitively. The dropdown lists every Project Site you currently have access to; a site created after this template was downloaded will not appear until you download a fresh copy.',
    schemaField: 'siteId',
    buildValidation: (context) => {
      const { siteRowCount } = context as EmployeeListContext;
      if (siteRowCount === 0) return undefined; // no accessible sites yet — nothing to populate the dropdown with
      return {
        type: 'list',
        allowBlank: false,
        formulae: [`=${LISTS_SHEET_NAME}!$A$2:$A$${siteRowCount + 1}`],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Invalid Project',
        error: 'Choose a Project Site from the dropdown list.',
      };
    },
  },
  {
    header: 'Employee Number/Code',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.employeeCode),
    maxLength: EMPLOYEE_FIELD_LIMITS.employeeCode,
    example: 'EMP-0001',
    notes: 'Unique if provided; leave blank to let the system leave it unset. Stored as text — leading zeros are preserved.',
    preserveLeadingZeros: true,
    schemaField: 'employeeCode',
  },
  {
    header: 'Religion',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.religion),
    maxLength: EMPLOYEE_FIELD_LIMITS.religion,
    example: 'Islam',
    notes: 'Free text.',
    schemaField: 'religion',
  },
  {
    header: 'Name',
    requirement: 'required',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.name),
    maxLength: EMPLOYEE_FIELD_LIMITS.name,
    example: 'Muhammad Ali',
    notes: "Employee's full name.",
    schemaField: 'name',
  },
  {
    header: 'Father Name',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.fatherName),
    maxLength: EMPLOYEE_FIELD_LIMITS.fatherName,
    example: 'Ghulam Ali',
    notes: 'Free text.',
    schemaField: 'fatherName',
  },
  {
    header: 'CNIC',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: '13 digits (dashes/spaces are stripped automatically)',
    maxLength: 15,
    example: '3520112345671',
    notes:
      'Exactly 13 digits once dashes/spaces are removed — enforced on upload; the spreadsheet only limits raw length to 15 characters (13 digits plus up to 2 separators). Must be unique across all employees if provided. Stored as text — leading zeros are preserved.',
    preserveLeadingZeros: true,
    schemaField: 'cnic',
  },
  {
    header: 'DOB',
    requirement: 'optional',
    dataType: 'date',
    allowedFormat: 'Date — DD-MM-YYYY (YYYY-MM-DD and DD/MM/YYYY are also accepted on upload)',
    example: '15-01-1990',
    notes: 'Date of birth.',
    schemaField: 'dateOfBirth',
  },
  {
    header: 'DOJ',
    requirement: 'optional',
    dataType: 'date',
    allowedFormat: 'Date — DD-MM-YYYY (YYYY-MM-DD and DD/MM/YYYY are also accepted on upload)',
    example: '01-06-2020',
    notes: 'Date of joining.',
    schemaField: 'dateOfJoining',
  },
  {
    header: 'DOL',
    requirement: 'optional',
    dataType: 'date',
    allowedFormat: 'Date — DD-MM-YYYY (YYYY-MM-DD and DD/MM/YYYY are also accepted on upload)',
    example: '',
    notes:
      'Date of leaving — leave blank for an active employee. Updating an existing (departed) employee with a blank DOL reactivates them via the same workflow as the Reactivate action.',
  },
  {
    header: 'Mobile Number',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.mobileNumber),
    maxLength: EMPLOYEE_FIELD_LIMITS.mobileNumber,
    example: '03001234567',
    notes: 'Free text. Stored as text — leading zeros are preserved.',
    preserveLeadingZeros: true,
    schemaField: 'mobileNumber',
  },
  {
    header: 'Designation',
    requirement: 'required',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.designation),
    maxLength: EMPLOYEE_FIELD_LIMITS.designation,
    example: 'Security Guard',
    notes: 'Job title/role.',
    schemaField: 'designation',
  },
  {
    header: 'Area',
    requirement: 'conditional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.name),
    maxLength: 160,
    example: 'Main Branch',
    notes:
      'The Branch/Unit name within the chosen Project Site. At least one of "Area", "Area/Location", or "Branch Code" is required per row; if more than one is given they must all identify the same unit.',
    // Part C6 "Excel-enforceable" cross-field checks — column letters are load-bearing here
    // (M=Area, N=Branch Code, O=Area/Location), matching EMPLOYEE_TEMPLATE_HEADERS' fixed order.
    buildValidation: () => ({
      type: 'custom',
      allowBlank: true,
      formulae: ['=AND(OR($M{row}<>"",$N{row}<>"",$O{row}<>""),LEN($M{row})<=160)'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid Area',
      error: 'Provide at least one of "Area", "Area/Location", or "Branch Code" (max 160 characters).',
    }),
  },
  {
    header: 'Branch Code',
    requirement: 'conditional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.unitCode),
    maxLength: EMPLOYEE_FIELD_LIMITS.unitCode,
    example: 'MB-01',
    notes:
      'The Branch/Unit\'s own code, if your site uses one. At least one of "Area", "Area/Location", or "Branch Code" is required per row. Stored as text — leading zeros are preserved.',
    preserveLeadingZeros: true,
  },
  {
    header: 'Area/Location',
    requirement: 'conditional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.name),
    maxLength: 160,
    example: 'Main Branch',
    notes: 'Alias of "Area" — must match it if both are provided. At least one of "Area", "Area/Location", or "Branch Code" is required per row.',
    buildValidation: () => ({
      type: 'custom',
      allowBlank: true,
      formulae: ['=AND(OR($M{row}="",$O{row}="",LOWER($M{row})=LOWER($O{row})),LEN($O{row})<=160)'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid Area/Location',
      error: '"Area/Location" must match "Area" if both are provided (max 160 characters).',
    }),
  },
  {
    header: 'Employee Bank',
    requirement: 'required',
    dataType: 'enum',
    allowedFormat: 'Must exactly match "Cash" or an active Bank name (see the "Employee Bank" dropdown) — never blank',
    example: 'Acme Commercial Bank',
    notes:
      'The employee\'s own payment method — required on every row, explicitly. Enter "Cash" for a cash-paid employee (a blank cell is rejected, not treated as Cash — post-deployment UAT refinement), or an exact active Bank name for a bank-paid employee. Matched case-insensitively either way. Previously named "Project Bank" — files using that older header are still accepted, but must still provide an explicit value.',
    schemaField: 'bankId',
    buildValidation: (context) => {
      const { bankRowCount } = context as EmployeeListContext;
      return {
        type: 'list',
        allowBlank: false,
        formulae: [`=${LISTS_SHEET_NAME}!$B$2:$B$${bankRowCount + 1}`],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Invalid Employee Bank',
        error: 'Choose "Cash" or a Bank from the dropdown list — this column cannot be blank.',
      };
    },
  },
  {
    header: 'Bank Branch Code',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.bankBranchCode),
    maxLength: EMPLOYEE_FIELD_LIMITS.bankBranchCode,
    example: '0470',
    notes: "The employee's own bank branch code (unrelated to \"Branch Code\" above). Stored as text — leading zeros are preserved.",
    preserveLeadingZeros: true,
    schemaField: 'branchCode',
  },
  {
    header: 'Account Number',
    requirement: 'conditional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.accountNumber),
    maxLength: EMPLOYEE_FIELD_LIMITS.accountNumber,
    example: '01234567890123',
    notes:
      'Required when Employee Bank is a real bank (not "Cash" or blank) — this is the only banking-detail field the backend actually requires; Bank Branch Code and IBAN stay optional either way (verified against the schema, not assumed). Stored as text — leading zeros are preserved.',
    preserveLeadingZeros: true,
    schemaField: 'accountNumber',
    // Post-deployment UAT correction: "Cash" in the Employee Bank cell must be treated exactly
    // like a blank cell here — otherwise the literal text "Cash" (a non-blank string) would
    // incorrectly trip this "Account Number required" rule.
    buildValidation: () => ({
      type: 'custom',
      allowBlank: true,
      formulae: [`=AND(OR($P{row}="",LOWER($P{row})="cash",$R{row}<>""),LEN($R{row})<=${EMPLOYEE_FIELD_LIMITS.accountNumber})`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid Account Number',
      error: `Required when Employee Bank is a real bank (max ${EMPLOYEE_FIELD_LIMITS.accountNumber} characters).`,
    }),
  },
  {
    header: 'Basic/Gross Pay',
    requirement: 'required',
    dataType: 'number',
    numericRange: { min: 0, max: EMPLOYEE_GROSS_PAY_MAX },
    allowedFormat: `Positive number, up to 2 decimal places (max ${EMPLOYEE_GROSS_PAY_MAX.toLocaleString('en-US')})`,
    example: '35000.00',
    notes: "Numeric, e.g. 35000.00 — the employee's starting gross pay for new payroll cycles.",
    schemaField: 'grossPay',
  },
  {
    header: 'Pay Type',
    requirement: 'optional',
    dataType: 'enum',
    allowedFormat: `One of: ${PAY_TYPE_VALUES.map((value) => `"${PAY_TYPE_LABELS[value]}"`).join(', ')}`,
    example: PAY_TYPE_LABELS.DAILY_WAGE,
    notes: `Defaults to "${PAY_TYPE_LABELS.DAILY_WAGE}" if left blank.`,
    schemaField: 'payType',
    buildValidation: () => ({
      type: 'list',
      allowBlank: true,
      formulae: [`"${PAY_TYPE_VALUES.map((value) => PAY_TYPE_LABELS[value]).join(',')}"`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid Pay Type',
      error: `Choose one of: ${PAY_TYPE_VALUES.map((value) => PAY_TYPE_LABELS[value]).join(', ')}.`,
    }),
  },
  {
    header: 'IBAN',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(EMPLOYEE_FIELD_LIMITS.iban),
    maxLength: EMPLOYEE_FIELD_LIMITS.iban,
    example: '',
    notes: "Optional; many employees don't provide one. Stored uppercase automatically.",
    schemaField: 'iban',
  },
  {
    header: 'Default EOBI Amount',
    requirement: 'optional',
    dataType: 'number',
    numericRange: { min: 0, max: EMPLOYEE_EOBI_AMOUNT_MAX },
    allowedFormat: `Positive number, up to 2 decimal places (max ${EMPLOYEE_EOBI_AMOUNT_MAX.toLocaleString('en-US')})`,
    example: '400.00',
    notes: 'Defaults to 400.00 if left blank.',
    schemaField: 'defaultEobiAmount',
  },
  {
    header: 'Default EOBI Applicable',
    requirement: 'optional',
    dataType: 'enum',
    allowedFormat: 'One of: "Yes", "No"',
    example: 'Yes',
    notes: 'Defaults to "Yes" if left blank.',
    schemaField: 'defaultEobiApplicable',
    buildValidation: () => ({
      type: 'list',
      allowBlank: true,
      formulae: ['"Yes,No"'],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid Default EOBI Applicable',
      error: 'Choose "Yes" or "No".',
    }),
  },
];

/** Reverse lookup from a `createEmployeeSchema` field path (e.g. `"designation"`) to its template
 * column name (e.g. `"Designation"`) — used so a Zod validation issue reads in terms of the column
 * the user actually edited, not the API's internal field name
 * (`formatImportValidationError`, `common/import-export.ts`). */
const SCHEMA_FIELD_TO_COLUMN = new Map(
  EMPLOYEE_TEMPLATE_COLUMNS.filter((column) => column.schemaField).map((column) => [column.schemaField!, column.header]),
);

/**
 * Parses common date representations from real-world spreadsheets (`YYYY-MM-DD`, `DD/MM/YYYY`,
 * `DD-MM-YYYY` — the last of which is this application's own canonical display format, per
 * `shared/src/lib/date.ts`) into an ISO date string, or returns null for a blank cell. Throws for
 * anything it can't confidently parse, rather than guessing — an ambiguous date is a row error,
 * not a silent best-effort import.
 */
function parseImportDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slashOrDash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashOrDash) {
    const [, day, month, year] = slashOrDash;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }

  throw new Error(`Unrecognized date format: "${raw}"`);
}

/** "Daily Wage"/"DAILY_WAGE"/"monthly" (any case) -> the enum value `createEmployeeSchema`
 * expects, or `undefined` for a blank cell (the schema/database default applies). Accepts both the
 * template's own friendly dropdown label and the raw enum value, so re-uploading this module's own
 * CSV/XLSX export — which writes the friendly label, see `buildExportRows` — always round-trips. */
function parsePayType(raw: string): PayTypeValue | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const byValue = PAY_TYPE_VALUES.find((value) => value.toLowerCase() === trimmed.toLowerCase());
  if (byValue) return byValue;

  const byLabel = PAY_TYPE_VALUES.find((value) => PAY_TYPE_LABELS[value].toLowerCase() === trimmed.toLowerCase());
  if (byLabel) return byLabel;

  throw new Error(`Pay Type must be one of: ${PAY_TYPE_VALUES.map((value) => `"${PAY_TYPE_LABELS[value]}"`).join(', ')} (received "${raw}")`);
}

/** "Yes"/"No" (any case, plus "true"/"false"/"1"/"0") -> boolean, or `undefined` for a blank cell
 * (the schema/database default applies). */
function parseYesNo(raw: string, columnName: string): boolean | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (['yes', 'true', '1'].includes(trimmed)) return true;
  if (['no', 'false', '0'].includes(trimmed)) return false;
  throw new Error(`${columnName} must be "Yes" or "No" (received "${raw}")`);
}

async function buildExportRows(currentUser: SessionUser, siteIds?: string[]) {
  const employees = await listEmployees(currentUser, { siteIds });

  return employees.map((employee, index) => [
    String(index + 1),
    employee.site.name,
    employee.employeeCode ?? '',
    employee.religion ?? '',
    employee.name,
    employee.fatherName ?? '',
    employee.cnic ?? '',
    formatDate(employee.dateOfBirth),
    formatDate(employee.dateOfJoining),
    formatDate(employee.dateOfLeaving),
    employee.mobileNumber ?? '',
    employee.designation,
    employee.unit.name, // "Area" — the employee's ProjectUnit name (Checkpoint 3 remap, see header)
    employee.unit.code ?? '', // "Branch Code" — the employee's ProjectUnit code
    employee.unit.name, // "Area/Location" — alias of "Area", see header comment
    employee.bank?.name ?? 'Cash', // "Employee Bank" — explicit "Cash" for bankId: null (post-deployment UAT correction)
    employee.branchCode ?? '', // "Bank Branch Code" — the employee's own bank branch code
    employee.accountNumber ?? '',
    employee.grossPay.toString(),
    PAY_TYPE_LABELS[employee.payType as PayTypeValue],
    employee.iban ?? '',
    employee.defaultEobiAmount.toString(),
    employee.defaultEobiApplicable ? 'Yes' : 'No',
  ]);
}

export async function exportEmployeesToCsv(currentUser: SessionUser, siteIds?: string[]): Promise<Buffer> {
  const rows = await buildExportRows(currentUser, siteIds);
  const csv = stringifyCsvSafe([EMPLOYEE_TEMPLATE_HEADERS as unknown as string[], ...rows]);
  return Buffer.from(csv, 'utf-8');
}

export async function exportEmployeesToXlsx(currentUser: SessionUser, siteIds?: string[]): Promise<Buffer> {
  const rows = await buildExportRows(currentUser, siteIds);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employee Registry');
  sheet.addRow(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * A blank, downloadable Employee Registry import template (Import Templates checkpoint):
 *
 * - **Instructions** — purpose, file-format/behavior rules, and a full Column Guide table.
 * - **Import Data** — the exact importer-compatible header row (frozen, filtered, required/
 *   optional/conditional visually distinguished, Excel data validation on every constrained
 *   column) with no data rows — this is the only sheet `parseEmployeeImportFile` ever reads.
 * - **Example** — the same header row plus one fully valid, neutral sample row, kept structurally
 *   separate from Import Data specifically so an un-deleted example row can never be uploaded as a
 *   real employee (Part B3) — see `parseEmployeeImportFile`'s explicit sheet targeting.
 *
 * `currentUser` scopes the "Project" column's dropdown to only the Project Sites this user can
 * currently access (`listProjectSites`, the same RBAC-scoped list used everywhere else in this
 * codebase) — Part H: a downloadable template must never leak a site a user has no access to,
 * even as a plain dropdown value.
 */
export async function generateEmployeeImportTemplate(currentUser: SessionUser): Promise<Buffer> {
  const [sites, banks] = await Promise.all([listProjectSites(currentUser), listBanks()]);
  const siteNames = sites.map((site) => site.name).sort((a, b) => a.localeCompare(b));
  // "Cash" is prepended as a static, non-database entry, never a row from `listBanks()` — matching
  // the manual Employee create/edit form's own "None (cash payment)" sentinel option
  // (frontend/src/routes/employees-page.tsx): a cash-paid employee is represented by `bankId: null`
  // in this system, never by selecting the reserved, protected `Bank` row whose `code` is `CASH`
  // (`listBanks()` already deliberately excludes that reserved row from every ordinary dropdown —
  // see its own doc comment, banks.service.ts). "Cash" here and a blank cell both parse to the
  // exact same `bankId: null` (see `importEmployees` below) — one business meaning, two accepted
  // spellings, never two representations.
  const bankOptions = ['Cash', ...banks.map((bank) => bank.name).sort((a, b) => a.localeCompare(b))];
  const siteRowCount = siteNames.length;
  const bankRowCount = bankOptions.length;
  // Post-deployment UAT correction: this shared row count is used *only* to decide how many rows
  // to write into the two-column "Lists" sheet below (so neither column's real data gets cut off)
  // — it must never be used as either dropdown's own Excel validation range end. Using it for both
  // (the original bug) meant whichever list was shorter had its range padded with the other
  // list's extra blank rows, producing visible blank dropdown entries.
  const listSheetRowCount = Math.max(siteRowCount, bankRowCount);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Payroll Management System';
  workbook.created = new Date();

  // --- Lists sheet: dropdown source data, very hidden — functional for data validation formulas
  // but never shown as a tab, so it can't be mistaken for a data-entry sheet. ---
  const listsSheet = workbook.addWorksheet(LISTS_SHEET_NAME, { state: 'veryHidden' });
  listsSheet.addRow(['Project Sites', 'Employee Banks']);
  for (let i = 0; i < listSheetRowCount; i += 1) {
    listsSheet.addRow([siteNames[i] ?? '', bankOptions[i] ?? '']);
  }

  // --- Instructions sheet ---
  const { addTitle, addSubheading, addParagraph, addBullet, sheet: instructionsSheet } = createInstructionsSheet(
    workbook,
    INSTRUCTIONS_SHEET_NAME,
  );

  addTitle('Employee Registry — Import Template');
  instructionsSheet.addRow([`Template Version: ${EMPLOYEE_TEMPLATE_VERSION}`]).font = { italic: true, size: 9 };
  instructionsSheet.addRow([`Generated: ${new Date().toISOString().slice(0, 10)}`]).font = { italic: true, size: 9 };
  instructionsSheet.addRow([]);

  addSubheading('What this import does');
  addParagraph(
    'Creates new Employee Registry records, or updates existing ones. A row is matched to an existing employee first by CNIC, then by Employee Number/Code; if neither matches, a new employee is created. Moving an existing employee to a different Project Site/Area on re-import is treated as an official transfer, with its own audit trail — the same as using the Transfer action.',
  );
  addParagraph('Accepted file formats: .xlsx (recommended) or .csv.');
  addParagraph(
    'Do not rename, add, delete, or reorder the header row on the "Import Data" sheet — the importer matches columns by exact name and position. Downloading a fresh template after your role/site access or the application itself changes is always safe; reusing an old file with a different column layout will be rejected with a description of exactly what differs.',
  );
  addParagraph('This "Instructions" sheet and the "Example" sheet are never uploaded as data — only "Import Data" is read.');

  addSubheading('Required vs. Optional vs. Conditional');
  addBullet('Required — every row must provide this column.');
  addBullet('Conditional — required only in combination with another column; see that column\'s Notes below.');
  addBullet('Optional — may be left blank. A blank optional field is stored as empty/unset, or takes its documented default.');
  addParagraph('On the "Import Data" sheet, Required columns are highlighted amber and Conditional columns blue; hover any header cell for its rule.');

  addSubheading('Formats');
  addBullet('Dates: DD-MM-YYYY (this application\'s own display format). YYYY-MM-DD and DD/MM/YYYY are also accepted.');
  addBullet('Numbers (Basic/Gross Pay, Default EOBI Amount): plain numbers, up to 2 decimal places, no currency symbols or thousands separators.');
  addBullet('Codes and identifiers (Employee Number/Code, CNIC, Branch Code, Bank Branch Code, Account Number) are stored as text — leading zeros are preserved.');
  addBullet('Project Site, Employee Bank, Pay Type, and Default EOBI Applicable values are matched case-insensitively; using the provided dropdown avoids typos entirely.');

  addSubheading('Employee Bank and Cash payments');
  addBullet('Employee Bank is required on every row — it cannot be left blank. Use "Cash" when the employee has no bank account.');
  addBullet('The system stores Cash as bankId = null internally — "Cash" is not a real Bank record, just this template\'s way of saying "no bank."');
  addBullet('For a bank-paid employee, Employee Bank must exactly match an active Bank name from the dropdown, and Account Number is then required.');
  addBullet('Bank Branch Code and IBAN are always optional, whether the employee is paid by Cash or by a real bank.');
  addBullet('This column was previously named "Project Bank" — a file using that older header name is still accepted, but must still provide "Cash" or a real bank name; a blank value is rejected either way.');

  addSubheading('Duplicates, updates, and errors');
  addBullet('Each row is validated and applied independently — one invalid row is skipped and reported; it never fails the whole file.');
  addBullet('Import is not all-or-nothing: valid rows in the same file are still created/updated even if other rows are skipped.');
  addBullet('After upload, you will see exactly how many rows were created, updated, and skipped, with the reason for every skipped row (naming the row number and column).');

  instructionsSheet.addRow([]);
  addSubheading('Column Guide');
  addColumnGuideTable(instructionsSheet, EMPLOYEE_TEMPLATE_COLUMNS);

  // --- Import Data sheet: the only sheet the importer reads ---
  const importDataSheet = workbook.addWorksheet(IMPORT_DATA_SHEET_NAME);
  importDataSheet.addRow(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]);
  const listContext: EmployeeListContext = { siteRowCount, bankRowCount };
  styleImportDataSheet(importDataSheet, EMPLOYEE_TEMPLATE_COLUMNS, { listContext });

  // --- Example sheet: same columns, one fully valid neutral sample row, structurally separate
  // from Import Data (Part B3) ---
  buildExampleSheet(workbook, EXAMPLE_SHEET_NAME, EMPLOYEE_TEMPLATE_HEADERS, EMPLOYEE_TEMPLATE_COLUMNS);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

interface ParsedRow {
  rowNumber: number;
  cells: Record<string, string>;
}

function rowsFromTable(table: string[][]): ParsedRow[] {
  if (table.length === 0) {
    throw badRequest('The uploaded file is empty');
  }

  // Legacy header aliasing applied before structural validation (post-deployment UAT correction)
  // — a workbook downloaded before the "Project Bank" → "Employee Bank" rename still validates and
  // imports without modification; every column beyond this substitution is read positionally
  // against `expected` below regardless of what the uploaded file's own header text said.
  const header = table[0]!.map((cell) => {
    const trimmed = cell.trim();
    return LEGACY_HEADER_ALIASES[trimmed] ?? trimmed;
  });
  const expected = EMPLOYEE_TEMPLATE_HEADERS as unknown as string[];
  assertExactHeaderMatch(header, expected, 'Employee Registry import template', 'download a fresh copy from Employees → Download Import Template');

  return table.slice(1).map((cells, index) => {
    const record: Record<string, string> = {};
    expected.forEach((column, columnIndex) => {
      record[column] = (cells[columnIndex] ?? '').toString().trim();
    });
    return { rowNumber: index + 2, cells: record }; // +2: 1-indexed, plus the header row itself
  });
}

/**
 * Parses an uploaded CSV or XLSX buffer into header-keyed rows, validating the header set first.
 * The CSV/XLSX-to-table half is shared with every other importer in this codebase
 * (`backend/src/common/import-export.ts`); header validation and column-keying stay here since
 * they're specific to this template.
 *
 * For an .xlsx upload, only a sheet literally named "Import Data" — or, failing that, the first
 * sheet that isn't named "Instructions"/"Example" — is ever read (Part B3): re-uploading this
 * module's own generated template can never accidentally import its Example row, and an
 * ad-hoc/hand-built workbook (a single unnamed sheet, or this module's own plain XLSX export,
 * "Employee Registry") still imports exactly as before.
 */
export async function parseEmployeeImportFile(buffer: Buffer, filename: string): Promise<ParsedRow[]> {
  const table = await parseTableFromFile(buffer, filename, {
    preferredSheetNames: [IMPORT_DATA_SHEET_NAME],
    excludeSheetNames: [INSTRUCTIONS_SHEET_NAME, EXAMPLE_SHEET_NAME],
  });
  return rowsFromTable(table);
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: ImportRowError[];
}

type ImportUnit = { id: string; siteId: string; name: string; code: string | null };

/**
 * Resolves an import row's Project Unit within its already-resolved site — Phase 2.5 Checkpoint
 * 3's finalized column mapping, replacing Checkpoint 2's interim single-unit auto-resolution.
 *
 * Resolution keys, all matched case-insensitively after trimming: `Branch Code` matches
 * `ProjectUnit.code`; `Area` and `Area/Location` (aliases) match `ProjectUnit.name`. Every
 * provided column must agree on one unit — a row whose code and name point at different units is
 * an error, never a guess. A row providing none of the three is an error: since Checkpoint 3, a
 * row must say which unit it means.
 *
 * This is **validation layer 1 of 3** (docs/IMPLEMENTATION_PLAN.md, Phase 2.5 Checkpoint 3): a
 * unit that exists but belongs to a *different* site than the row's named site is rejected here
 * with a per-row error naming the mismatch. Layer 2 is `assertUnitBelongsToSite()` at the shared
 * service boundary (called again before every write below); layer 3 is the database's
 * `(unitId, siteId) → ProjectUnit(id, siteId)` composite foreign key.
 */
function resolveRowUnit(
  row: ParsedRow,
  site: { id: string; name: string; unitLabel: string },
  allUnits: ImportUnit[],
): ImportUnit {
  const unitLabel = site.unitLabel.toLowerCase();
  const codeRaw = row.cells['Branch Code']!.trim();
  const areaRaw = row.cells['Area']!.trim();
  const areaLocationRaw = row.cells['Area/Location']!.trim();

  if (areaRaw && areaLocationRaw && areaRaw.toLowerCase() !== areaLocationRaw.toLowerCase()) {
    throw new Error(
      `"Area" ("${areaRaw}") and "Area/Location" ("${areaLocationRaw}") disagree — they are aliases of the same ${unitLabel} name and must match (or leave one blank)`,
    );
  }
  const nameRaw = areaRaw || areaLocationRaw;

  if (!codeRaw && !nameRaw) {
    throw new Error(
      `Row does not specify a ${unitLabel} — provide its name in "Area" (or "Area/Location") and/or its code in "Branch Code"`,
    );
  }

  const siteUnits = allUnits.filter((unit) => unit.siteId === site.id);

  const findMismatchSuffix = (matcher: (unit: ImportUnit) => boolean): string => {
    // Layer 1's explicit cross-site rejection: distinguish "doesn't exist anywhere" from
    // "exists, but under a different site" so the operator sees the real problem.
    const elsewhere = allUnits.find((unit) => unit.siteId !== site.id && matcher(unit));
    return elsewhere
      ? ` — it belongs to a different project site, not "${site.name}"; a row's ${unitLabel} must belong to the row's own site`
      : ` under site "${site.name}"`;
  };

  let byCode: ImportUnit | undefined;
  if (codeRaw) {
    byCode = siteUnits.find((unit) => (unit.code ?? '').trim().toLowerCase() === codeRaw.toLowerCase());
    if (!byCode) {
      throw new Error(
        `No ${unitLabel} with code "${codeRaw}"${findMismatchSuffix(
          (unit) => (unit.code ?? '').trim().toLowerCase() === codeRaw.toLowerCase(),
        )}`,
      );
    }
  }

  let byName: ImportUnit | undefined;
  if (nameRaw) {
    byName = siteUnits.find((unit) => unit.name.trim().toLowerCase() === nameRaw.toLowerCase());
    if (!byName) {
      throw new Error(
        `No ${unitLabel} named "${nameRaw}"${findMismatchSuffix(
          (unit) => unit.name.trim().toLowerCase() === nameRaw.toLowerCase(),
        )}`,
      );
    }
  }

  if (byCode && byName && byCode.id !== byName.id) {
    throw new Error(
      `"Branch Code" ("${codeRaw}") and "Area" ("${nameRaw}") point at two different ${pluralize(site.unitLabel).toLowerCase()} under site "${site.name}" — they must identify the same one`,
    );
  }

  return (byCode ?? byName)!;
}

/**
 * Imports parsed rows: matches an existing employee by CNIC first, then employee code, otherwise
 * creates a new one. Each row is validated and applied independently — one bad row is skipped and
 * reported, never a whole-file failure (per docs/IMPLEMENTATION_PLAN.md Phase 2 testing strategy,
 * reaffirmed by the Import Templates checkpoint's own error-reporting audit: this per-row-atomic,
 * whole-file-non-atomic behavior is this importer's explicit, existing product rule, not an
 * omission — see docs/architecture/import-template-architecture.md). A single summary audit log
 * entry is written for the whole operation rather than one per row, to keep the audit log readable
 * for a bulk action instead of spammed with hundreds of near-identical entries — with one
 * deliberate exception: an update that changes an employee's site/unit is a *transfer*
 * (docs/architecture/database/employee.md §8b/§9, a business event in its own right) and writes
 * its `EmployeeTransferHistory` row plus dedicated `employee.transferred` audit entry via the same
 * shared `recordEmployeeTransfer()` the ordinary update path uses, atomically with the row update.
 * Transfers are never folded into a generic/summary-only path, per the 2026-07-03 decision.
 *
 * A row's Project Unit is resolved from the template's `Branch Code`/`Area`/`Area/Location`
 * columns via `resolveRowUnit()` (validation layer 1); `assertUnitBelongsToSite()` re-asserts the
 * pair at the shared service boundary before every write (layer 2); the composite FK is the
 * database backstop (layer 3).
 */
export async function importEmployees(
  currentUser: SessionUser,
  rows: ParsedRow[],
  requestMeta: RequestMeta,
): Promise<ImportResult> {
  const sites = await prisma.projectSite.findMany();
  const banks = await prisma.bank.findMany();
  const units = await prisma.projectUnit.findMany();
  const siteByName = new Map(sites.map((site) => [site.name.trim().toLowerCase(), site]));
  const bankByName = new Map(banks.map((bank) => [bank.name.trim().toLowerCase(), bank]));

  let created = 0;
  let updated = 0;
  const skipped: ImportRowError[] = [];

  for (const row of rows) {
    try {
      const projectName = row.cells['Project']!.toLowerCase();
      const site = siteByName.get(projectName);
      if (!site) {
        throw new Error(`Unknown project site: "${row.cells['Project']}"`);
      }

      assertSiteAccess(currentUser, site.id);

      const unit = resolveRowUnit(row, site, units);

      // Employee Bank must be an explicit value — "Cash" or a real bank name, never blank (final
      // refinement, post-deployment UAT): a blank/whitespace-only cell (already `.trim()`-ed by
      // `rowsFromTable`) is rejected outright, rather than silently treated as Cash. This removes
      // the ambiguity the earlier correction still allowed (blank and "Cash" both meaning the
      // same thing was fine for the *output*, but left the *input contract* ambiguous about
      // whether a blank cell was an intentional Cash selection or a skipped column).
      const bankName = row.cells['Employee Bank']!.trim();
      if (!bankName) {
        throw new Error('Employee Bank: Select "Cash" or a valid bank');
      }
      // "Cash" is a parsing-only sentinel, never looked up against real Bank rows (the reserved
      // Cash Bank record is deliberately excluded from `banks`/`bankByName` above, matching
      // `listBanks()`'s own default scope) — it parses to exactly the same `bankId: null` a manual
      // "None (cash payment)" selection already produces.
      const isCashSentinel = bankName.toLowerCase() === 'cash';
      const bank = !isCashSentinel ? bankByName.get(bankName.toLowerCase()) : undefined;
      if (!isCashSentinel && !bank) {
        throw new Error(`Unknown bank: "${bankName}"`);
      }

      const input = createEmployeeSchema.parse({
        employeeCode: row.cells['Employee Number/Code'] || null,
        cnic: row.cells['CNIC'] || null,
        name: row.cells['Name'],
        fatherName: row.cells['Father Name'] || null,
        religion: row.cells['Religion'] || null,
        dateOfBirth: parseImportDate(row.cells['DOB']!),
        mobileNumber: row.cells['Mobile Number'] || null,
        designation: row.cells['Designation'],
        siteId: site.id,
        unitId: unit.id,
        dateOfJoining: parseImportDate(row.cells['DOJ']!),
        payType: parsePayType(row.cells['Pay Type']!),
        grossPay: row.cells['Basic/Gross Pay'],
        bankId: bank?.id ?? null,
        branchCode: row.cells['Bank Branch Code'] || null,
        accountNumber: row.cells['Account Number'] || null,
        iban: row.cells['IBAN'] || null,
        defaultEobiAmount: row.cells['Default EOBI Amount'] || undefined,
        defaultEobiApplicable: parseYesNo(row.cells['Default EOBI Applicable']!, 'Default EOBI Applicable'),
      });

      const dateOfLeaving = parseImportDate(row.cells['DOL']!);

      // Prisma's @db.Date columns reject the bare YYYY-MM-DD strings the Zod schema validates —
      // convert to UTC-midnight Dates at this write boundary, same as employees.service.ts.
      const data = {
        ...input,
        dateOfBirth: isoDateToUtcDate(input.dateOfBirth),
        dateOfJoining: isoDateToUtcDate(input.dateOfJoining),
        dateOfLeaving: isoDateToUtcDate(dateOfLeaving),
      };

      // Validation layer 2: the same shared service-layer assertion the ordinary create/update
      // path uses, re-asserted here so the check holds even if a future caller bypasses the
      // import-layer resolution above. Layer 3 (the composite FK) backstops both.
      await assertUnitBelongsToSite(unit.id, site.id);

      // Uses the same normalized-CNIC lookup the check-cnic endpoint uses (findEmployeeByCnic,
      // employees.service.ts) — a raw comparison against the row's un-normalized cell was a real
      // bug: a dashed CNIC in the file would never match the digits-only value already stored,
      // so a rehire's row would fall through to "create new" instead of finding the existing one.
      const existing = input.cnic
        ? await findEmployeeByCnic(input.cnic)
        : input.employeeCode
          ? await prisma.employee.findFirst({ where: { employeeCode: input.employeeCode } })
          : null;

      if (existing) {
        assertSiteAccess(currentUser, existing.siteId);
        const isTransfer = existing.siteId !== site.id || existing.unitId !== unit.id;

        if (existing.dateOfLeaving && dateOfLeaving === null) {
          // A departed employee reappearing with a blank DOL column is a rehire. Route through the
          // same Reactivate workflow every other reactivation path uses — single source of truth,
          // docs/architecture/database/schema-invariants.md §26 item 6 — rather than a bare field update, so
          // the employee.reactivated audit entry (and, when site/unit also changed, the
          // EmployeeTransferHistory row + employee.transferred entry) fire identically regardless
          // of whether the reactivation came from the UI or an import. Leave-via-import stays out
          // of scope (unchanged below) — this only ever moves departed -> active, never the reverse.
          await reactivateEmployee(
            currentUser,
            existing.id,
            { ...input, transferReason: isTransfer ? 'Employee Registry import' : undefined },
            requestMeta,
          );
        } else {
          await prisma.$transaction(async (tx) => {
            await tx.employee.update({
              where: { id: existing.id },
              data,
            });
            if (isTransfer) {
              await recordEmployeeTransfer(tx, {
                employeeId: existing.id,
                fromSiteId: existing.siteId,
                toSiteId: site.id,
                fromUnitId: existing.unitId,
                toUnitId: unit.id,
                actorUserId: currentUser.id,
                reason: 'Employee Registry import',
                requestMeta,
              });
            }
          });
        }
        updated += 1;
      } else {
        await prisma.$transaction(async (tx) => {
          const employee = await tx.employee.create({ data });
          // Operational Stabilization Checkpoint (2026-07-24) — same sync a form-created employee
          // gets (employees.service.ts's createEmployee); an imported employee is just as newly
          // eligible for the current Draft cycle. See syncEmployeeIntoCurrentDraftCycle's own doc
          // comment.
          await syncEmployeeIntoCurrentDraftCycle(tx, employee, currentUser.id, requestMeta);
        });
        created += 1;
      }
    } catch (error) {
      skipped.push({ row: row.rowNumber, reason: formatImportValidationError(error, SCHEMA_FIELD_TO_COLUMN) });
    }
  }

  return { created, updated, skipped };
}
