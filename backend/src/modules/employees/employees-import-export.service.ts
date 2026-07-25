import ExcelJS from 'exceljs';
import { createEmployeeSchema, formatDate, isoDateToUtcDate, pluralize } from '@payroll/shared';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../common/http-error';
import { parseTableFromFile, stringifyCsvSafe, type ImportRowError } from '../../common/import-export';
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

/**
 * The official Employee Registry template header set, in column order, extracted verbatim from
 * real client files (reference/PROJECT_SPEC.md, "Official Data Template") — this exact header set
 * is required, not a house style.
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
  'Project Bank',
  'Bank Branch Code',
  'Account Number',
  'Basic/Gross Pay',
] as const;

/**
 * Parses common date representations from real-world spreadsheets (`YYYY-MM-DD`, `DD/MM/YYYY`,
 * `DD-MM-YYYY`) into an ISO date string, or returns null for a blank cell. Throws for anything it
 * can't confidently parse, rather than guessing — an ambiguous date is a row error, not a silent
 * best-effort import.
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
    employee.bank?.name ?? '',
    employee.branchCode ?? '', // "Bank Branch Code" — the employee's own bank branch code
    employee.accountNumber ?? '',
    employee.grossPay.toString(),
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
 * Per-column required/optional/validation documentation for the downloadable Employee import
 * template (Import Templates checkpoint) — kept as data, not just prose, so the "Instructions"
 * sheet below and any future consumer (a future in-app column-hint tooltip, say) share one source
 * rather than a second hand-written copy that could drift from `createEmployeeSchema`
 * (`shared/src/schemas/employee.ts`), the actual authority every one of these notes describes.
 */
const EMPLOYEE_TEMPLATE_COLUMN_NOTES: Record<(typeof EMPLOYEE_TEMPLATE_HEADERS)[number], { required: boolean; note: string }> = {
  'Sr. No': { required: false, note: 'Not imported — a convenience column for the source file only.' },
  Project: { required: true, note: 'Must exactly match an existing Project Site name.' },
  'Employee Number/Code': { required: false, note: 'Unique if provided; left blank to let the system leave it unset.' },
  Religion: { required: false, note: 'Free text.' },
  Name: { required: true, note: 'Employee full name.' },
  'Father Name': { required: false, note: 'Free text.' },
  CNIC: { required: false, note: '13 digits; dashes/spaces are stripped automatically. Must be unique across all employees if provided.' },
  DOB: { required: false, note: 'Date of birth — YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY.' },
  DOJ: { required: false, note: 'Date of joining — same accepted formats as DOB.' },
  DOL: { required: false, note: 'Date of leaving — leave blank for an active employee.' },
  'Mobile Number': { required: false, note: 'Free text, up to 20 characters.' },
  Designation: { required: true, note: 'Job title/role.' },
  Area: { required: true, note: `The employee's Branch/Unit name within their Project Site — must match "Area/Location" and "Branch Code" if both are also provided.` },
  'Branch Code': { required: false, note: 'The Branch/Unit code, if your site uses one — must identify the same unit as "Area".' },
  'Area/Location': { required: false, note: 'Alias of "Area" — must match it if both are provided.' },
  'Project Bank': { required: false, note: 'Bank name — leave every bank column blank for a cash employee.' },
  'Bank Branch Code': { required: false, note: "The employee's own bank branch code (unrelated to \"Branch Code\" above)." },
  'Account Number': { required: false, note: 'Required if "Project Bank" is set; must stay blank for a cash employee.' },
  'Basic/Gross Pay': { required: true, note: 'Numeric, e.g. 35000.00 — the employee\'s starting gross pay for new payroll cycles.' },
};

/**
 * A blank, downloadable Employee Registry import template (Import Templates checkpoint) — every
 * required header (`EMPLOYEE_TEMPLATE_HEADERS`, the exact set `parseEmployeeImportFile` validates
 * against), one fully-filled sample row so a real import file's shape is unambiguous, and a second
 * "Instructions" sheet documenting which columns are required vs. optional and any validation
 * rule that isn't obvious from the sample alone. Never queries real employee data — this is a
 * template, not an export, and needs no `currentUser`/site-scope at all.
 */
export async function generateEmployeeImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const templateSheet = workbook.addWorksheet('Employee Import Template');
  templateSheet.addRow(EMPLOYEE_TEMPLATE_HEADERS as unknown as string[]);
  templateSheet.addRow([
    '1',
    'Downtown Regional Office',
    'EMP-0001',
    'Islam',
    'Muhammad Ali',
    'Ghulam Ali',
    '3520112345671',
    '1990-01-15',
    '2020-06-01',
    '',
    '03001234567',
    'Security Guard',
    'Main Branch',
    'MB-01',
    'Main Branch',
    'Acme Commercial Bank',
    '0470',
    '01234567890123',
    '35000.00',
  ]);
  templateSheet.getRow(1).font = { bold: true };

  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.addRow(['Column', 'Required', 'Notes']);
  instructionsSheet.getRow(1).font = { bold: true };
  for (const header of EMPLOYEE_TEMPLATE_HEADERS) {
    const { required, note } = EMPLOYEE_TEMPLATE_COLUMN_NOTES[header];
    instructionsSheet.addRow([header, required ? 'Required' : 'Optional', note]);
  }
  instructionsSheet.getColumn(1).width = 22;
  instructionsSheet.getColumn(2).width = 12;
  instructionsSheet.getColumn(3).width = 90;

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

  const header = table[0]!.map((cell) => cell.trim());
  const expected = EMPLOYEE_TEMPLATE_HEADERS as unknown as string[];
  const headerMatches = expected.every((column, index) => header[index] === column);
  if (!headerMatches) {
    throw badRequest(
      `Header row does not match the official Employee Registry template. Expected: ${expected.join(', ')}`,
    );
  }

  return table.slice(1).map((cells, index) => {
    const record: Record<string, string> = {};
    expected.forEach((column, columnIndex) => {
      record[column] = (cells[columnIndex] ?? '').toString().trim();
    });
    return { rowNumber: index + 2, cells: record }; // +2: 1-indexed, plus the header row itself
  });
}

/** Parses an uploaded CSV or XLSX buffer into header-keyed rows, validating the header set first.
 * The CSV/XLSX-to-table half is shared with every other importer in this codebase
 * (`backend/src/common/import-export.ts`); header validation and column-keying stay here since
 * they're specific to this template. */
export async function parseEmployeeImportFile(buffer: Buffer, filename: string): Promise<ParsedRow[]> {
  const table = await parseTableFromFile(buffer, filename);
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
 * reported, never a whole-file failure (per docs/IMPLEMENTATION_PLAN.md Phase 2 testing strategy).
 * A single summary audit log entry is written for the whole operation rather than one per row, to
 * keep the audit log readable for a bulk action instead of spammed with hundreds of near-identical
 * entries — with one deliberate exception: an update that changes an employee's site/unit is a
 * *transfer* (docs/architecture/database/employee.md §8b/§9, a business event in its own right) and
 * writes its `EmployeeTransferHistory` row plus dedicated `employee.transferred` audit entry via
 * the same shared `recordEmployeeTransfer()` the ordinary update path uses, atomically with the
 * row update. Transfers are never folded into a generic/summary-only path, per the 2026-07-03
 * decision.
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

      const bankName = row.cells['Project Bank'];
      const bank = bankName ? bankByName.get(bankName.toLowerCase()) : undefined;
      if (bankName && !bank) {
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
        grossPay: row.cells['Basic/Gross Pay'],
        bankId: bank?.id ?? null,
        branchCode: row.cells['Bank Branch Code'] || null,
        accountNumber: row.cells['Account Number'] || null,
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
      skipped.push({ row: row.rowNumber, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { created, updated, skipped };
}
