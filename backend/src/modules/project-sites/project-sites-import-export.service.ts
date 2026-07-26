import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { createProjectSiteSchema, PROJECT_SITE_FIELD_LIMITS } from '@payroll/shared';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../common/http-error';
import { isMasterAdmin } from '../../common/authz-policy';
import { recordAuditLog } from '../audit-log/audit-log.service';
import type { RequestMeta } from '../../common/request-meta';
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
  styleImportDataSheet,
  type ImportColumnSpec,
  type ImportRowError,
} from '../../common/import-export';
import { createProjectSiteInTransaction } from './project-sites.service';
import { createProjectUnit } from '../project-units/project-units.service';

/**
 * The Project Site import template's header set, in column order — derived from
 * `createProjectSiteSchema` (`shared/src/schemas/project-site.ts`), the exact same contract
 * manual Project Site creation (`POST /sites`, `createProjectSite`) validates against. Deliberately
 * narrow: `ProjectSite` has exactly three user-controlled fields (`name`, `unitLabel`, `address`)
 * plus `isActive` (update-only — a newly imported site is always active, matching manual create's
 * own behavior, so it isn't a column at all). System-generated/audit fields (`id`, `createdById`,
 * `createdAt`, `updatedAt`) and assignment-table fields (`UserSiteAssignment`) are never exposed —
 * see docs/architecture/import-template-architecture.md's Project Site contract section.
 */
export const PROJECT_SITE_TEMPLATE_HEADERS = ['Sr. No', 'Site Name', 'Unit Label', 'Address'] as const;

/** Bumped whenever `PROJECT_SITE_TEMPLATE_HEADERS` changes shape — see
 * `EMPLOYEE_TEMPLATE_VERSION`'s doc comment (`employees-import-export.service.ts`) for why this is
 * a diagnostic-only stamp, never read/enforced by the importer itself. */
export const PROJECT_SITE_TEMPLATE_VERSION = 1;

export const IMPORT_DATA_SHEET_NAME = STANDARD_IMPORT_DATA_SHEET_NAME;
export const EXAMPLE_SHEET_NAME = STANDARD_EXAMPLE_SHEET_NAME;
export const INSTRUCTIONS_SHEET_NAME = STANDARD_INSTRUCTIONS_SHEET_NAME;

const REQUIRED_TEXT = (max: number) => `Text, up to ${max} characters`;

/**
 * Per-column contract for the downloadable Project Site import template — the single source for
 * the Instructions sheet's Column Guide, the Import Data sheet's styling/validation, and the
 * Example sheet's sample row (same `ImportColumnSpec` shape the Employee Registry template uses,
 * `common/import-export.ts`). No column here needs a dropdown or a cross-field custom formula —
 * `ProjectSite` has no enum/reference fields and no cross-field rule — so every column uses the
 * generic text-length default `styleImportDataSheet` falls back to, and this template has no
 * hidden "Lists" sheet at all (Part 4/9: use a Lists sheet only where actually required).
 */
const PROJECT_SITE_TEMPLATE_COLUMNS: readonly ImportColumnSpec[] = [
  {
    header: 'Sr. No',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: 'Any',
    example: '1',
    notes: 'Not imported — a convenience column for the source file only.',
  },
  {
    header: 'Site Name',
    requirement: 'required',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(PROJECT_SITE_FIELD_LIMITS.name),
    maxLength: PROJECT_SITE_FIELD_LIMITS.name,
    example: 'Downtown Regional Office',
    notes:
      'The site\'s official name. Must be unique across every Project Site in the system — a row naming a site that already exists, or a name repeated more than once in this workbook, is rejected.',
    schemaField: 'name',
  },
  {
    header: 'Unit Label',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(PROJECT_SITE_FIELD_LIMITS.unitLabel),
    maxLength: PROJECT_SITE_FIELD_LIMITS.unitLabel,
    example: 'Branch',
    notes:
      'The term this site\'s own business uses for its operational sub-divisions (e.g. "Branch", "Department", "Section") — used everywhere this site\'s own Project Units are named. Defaults to "Branch" if left blank.',
    schemaField: 'unitLabel',
  },
  {
    header: 'Address',
    requirement: 'optional',
    dataType: 'text',
    allowedFormat: REQUIRED_TEXT(PROJECT_SITE_FIELD_LIMITS.address),
    maxLength: PROJECT_SITE_FIELD_LIMITS.address,
    example: '221 Market Street, Downtown',
    notes: 'The site\'s physical work-location address. Optional.',
    schemaField: 'address',
  },
];

/** Reverse lookup from a `createProjectSiteSchema` field path to its template column name — same
 * pattern as the Employee importer's own `SCHEMA_FIELD_TO_COLUMN` (`formatImportValidationError`,
 * `common/import-export.ts`). */
const SCHEMA_FIELD_TO_COLUMN = new Map(
  PROJECT_SITE_TEMPLATE_COLUMNS.filter((column) => column.schemaField).map((column) => [column.schemaField!, column.header]),
);

/**
 * A blank, downloadable Project Site import template (Import Template Contract checkpoint
 * extension) — the same Instructions/Import Data/Example three-sheet structure as the Employee
 * Registry template, built from the same shared infrastructure (`common/import-export.ts`).
 *
 * Unlike the Employee template, this one needs no `currentUser` and queries no data at all: none
 * of `ProjectSite`'s three importable columns reference another entity (no dropdown, no RBAC-
 * scoped list to leak), so the template is pure static content, identical for every caller — the
 * route's own `requirePermission(SITES_MANAGE)` gate is what controls who may download it.
 */
export async function generateProjectSiteImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Payroll Management System';
  workbook.created = new Date();

  // --- Instructions sheet ---
  const { addTitle, addSubheading, addParagraph, addBullet, sheet: instructionsSheet } = createInstructionsSheet(
    workbook,
    INSTRUCTIONS_SHEET_NAME,
  );

  addTitle('Project Sites — Import Template');
  instructionsSheet.addRow([`Template Version: ${PROJECT_SITE_TEMPLATE_VERSION}`]).font = { italic: true, size: 9 };
  instructionsSheet.addRow([`Generated: ${new Date().toISOString().slice(0, 10)}`]).font = { italic: true, size: 9 };
  instructionsSheet.addRow([]);

  addSubheading('What this import does');
  addParagraph(
    'Creates new Project Sites — one per row. This import only ever creates; it never updates an existing Project Site, even if a row\'s Site Name matches one exactly (that row is rejected instead — see "Duplicates" below). Use the ordinary Edit action to change an existing site.',
  );
  addParagraph(
    'Unit Label defines the terminology used for units/branches under this Site (e.g. "Branch", "Department", "Section"). Every imported Site is created with one initial Project Unit already in place, named "Main <Unit Label>" (e.g. "Main Branch") — the Site is immediately ready to have Employees assigned to it, without a separate manual step to create its first Branch/Department/Section. Additional Units can still be added afterward from "Manage Branches" on the Project Sites page.',
  );
  addParagraph(
    'You automatically gain operational access to every Project Site you successfully import, the same way you automatically gain access to a site you create manually — no separate approval or assignment step is needed.',
  );
  addParagraph('Accepted file formats: .xlsx (recommended) or .csv.');
  addParagraph(
    'Do not rename, add, delete, or reorder the header row on the "Import Data" sheet — the importer matches columns by exact name and position. Reusing an old file with a different column layout will be rejected with a description of exactly what differs.',
  );
  addParagraph('This "Instructions" sheet and the "Example" sheet are never uploaded as data — only "Import Data" is read.');

  addSubheading('Required vs. Optional');
  addBullet('Required — every row must provide this column.');
  addBullet('Optional — may be left blank. A blank optional field is stored as empty/unset, or takes its documented default.');
  addParagraph('On the "Import Data" sheet, the Required column is highlighted amber; hover any header cell for its rule.');

  addSubheading('Duplicates');
  addBullet('Site Name is this system\'s unique identifier for a Project Site — matched exactly (case-sensitive), the same rule the database itself enforces.');
  addBullet('A row naming a site that already exists is rejected: "already exists".');
  addBullet('A Site Name repeated more than once in this workbook is rejected for every row it appears on: "appears more than once in this workbook".');
  addBullet('This import never silently overwrites or updates an existing Project Site.');

  addSubheading('Errors');
  addBullet('Each row is validated and applied independently — one invalid row is skipped and reported; it never fails the whole file.');
  addBullet('A structurally invalid file (wrong/missing/reordered columns) creates nothing at all.');
  addBullet('After upload, you will see exactly how many rows were created and skipped, with the reason for every skipped row (naming the row number and column).');

  instructionsSheet.addRow([]);
  addSubheading('Column Guide');
  addColumnGuideTable(instructionsSheet, PROJECT_SITE_TEMPLATE_COLUMNS);

  // --- Import Data sheet: the only sheet the importer reads ---
  const importDataSheet = workbook.addWorksheet(IMPORT_DATA_SHEET_NAME);
  importDataSheet.addRow(PROJECT_SITE_TEMPLATE_HEADERS as unknown as string[]);
  styleImportDataSheet(importDataSheet, PROJECT_SITE_TEMPLATE_COLUMNS);

  // --- Example sheet: same columns, one fully valid neutral sample row, structurally separate
  // from Import Data (Part B3 / Part 4) ---
  buildExampleSheet(workbook, EXAMPLE_SHEET_NAME, PROJECT_SITE_TEMPLATE_HEADERS, PROJECT_SITE_TEMPLATE_COLUMNS);

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
  const expected = PROJECT_SITE_TEMPLATE_HEADERS as unknown as string[];
  assertExactHeaderMatch(header, expected, 'Project Site import template', 'download a fresh copy from Project Sites → Download Import Template');

  return table.slice(1).map((cells, index) => {
    const record: Record<string, string> = {};
    expected.forEach((column, columnIndex) => {
      record[column] = (cells[columnIndex] ?? '').toString().trim();
    });
    return { rowNumber: index + 2, cells: record }; // +2: 1-indexed, plus the header row itself
  });
}

/**
 * Parses an uploaded CSV or XLSX buffer into header-keyed rows, validating the header set first —
 * same shared CSV/XLSX-to-table logic and "Import Data"-sheet targeting as the Employee Registry
 * importer (`common/import-export.ts`'s `parseTableFromFile`), so the Example sheet's sample row
 * can never be uploaded as a real Project Site even if the workbook's tabs are reordered.
 */
export async function parseProjectSiteImportFile(buffer: Buffer, filename: string): Promise<ParsedRow[]> {
  const table = await parseTableFromFile(buffer, filename, {
    preferredSheetNames: [IMPORT_DATA_SHEET_NAME],
    excludeSheetNames: [INSTRUCTIONS_SHEET_NAME, EXAMPLE_SHEET_NAME],
  });
  return rowsFromTable(table);
}

export interface ImportResult {
  created: number;
  skipped: ImportRowError[];
}

/** The initial Project Unit every imported Site is provisioned with (final delta — "operational
 * Site onboarding" requirement) — named from the Site's own *actual, persisted* `unitLabel`
 * (its parsed input value, or the `"Branch"` database default if the row left it blank), never
 * `code` (nullable/optional on `createProjectUnitSchema`; nothing in the Project Site import
 * contract can safely derive one). Manual Project Site creation was confirmed to have **no**
 * equivalent existing invariant (`createProjectSite` never created a Unit) — this deterministic
 * naming is new, introduced specifically for bulk import, and documented in the template's own
 * Instructions sheet so it's never a surprise. */
function initialUnitName(siteUnitLabel: string): string {
  return `Main ${siteUnitLabel}`;
}

/**
 * Imports parsed rows, each as a brand-new Project Site with one initial Project Unit already in
 * place — this import **creates only**, never updates (Part 10's default requirement, confirmed
 * against the actual architecture: `ProjectSite` has no natural "this is the same real-world site"
 * match key beyond its own unique `name`, and unlike Employee Registry's CNIC-based rehire
 * workflow, there is no existing product concept of "re-importing a site to update it"). A row
 * naming an already-existing site, or a name repeated within the same workbook, is rejected rather
 * than silently creating a duplicate or overwriting.
 *
 * Each row is validated and applied independently — row-atomic, not file-atomic, the same
 * documented behavior as Employee Registry import (docs/architecture/import-template-architecture.md):
 * one bad row is skipped and reported, never a whole-file failure. Scaled for ~600-site onboarding
 * (Part 6): the existing-Project-Site-name set is fetched **once**, up front, rather than once per
 * row — the only genuine N+1 risk in this importer — and within-workbook duplicates are detected
 * by a single in-memory pre-pass before any row is written, not per-row.
 *
 * **Site + initial Unit + creator assignment, one transaction, for every row** (final delta) —
 * `createProjectSiteInTransaction` (site creation + `ensureCreatorSiteAssignment`, the exact same
 * primitive manual Project Site creation's own `createProjectSite` wraps) composed with
 * `createProjectUnit` (the exact same primitive manual Unit creation uses, given this same `tx`),
 * inside one `prisma.$transaction`. If Unit creation fails, the Site (and its would-be assignment)
 * never persists; if the assignment fails, neither the Site nor the Unit persists — the whole row
 * is one indivisible operation, never a partial write. Master Admin follows the same
 * no-explicit-assignment behavior `ensureCreatorSiteAssignment` already gives manual creation
 * (unconditional access; no `UserSiteAssignment` row is ever written). RBAC: creating this initial
 * Unit needs no permission beyond the `sites:manage` the importer already holds to reach this
 * endpoint at all — the same permission manual Unit creation itself requires (`project-units.routes.ts`),
 * confirmed from the repository rather than assumed.
 *
 * Audit logging mirrors the manual creation route's own two entries (`project-site.created`, and
 * — unless the importer is Master Admin — `project-site.creator_assigned`), plus manual Unit
 * creation's own `project-unit.created` for the initial Unit — the same three action names every
 * one of these operations already has when done manually, each tagged `metadata.source: 'import'`
 * so the import path stays distinguishable without a new action-name taxonomy — plus one additional
 * `project-site.import` summary entry for the whole operation (created/skipped counts), the same
 * "one summary entry for the bulk action" precedent `employee.import` set.
 *
 * A same-named-Site race against a *concurrent, independent* request (not another row in this same
 * file — the in-workbook pre-pass already catches that) is narrow enough to leave uncaught by the
 * up-front existing-name snapshot; `Prisma.PrismaClientKnownRequestError` P2002 on `ProjectSite`'s
 * `name` unique constraint is caught here and rewritten to the same friendly message the ordinary
 * pre-check produces, rather than surfacing a raw database error for that one row.
 */
export async function importProjectSites(
  currentUser: SessionUser,
  rows: ParsedRow[],
  requestMeta: RequestMeta,
): Promise<ImportResult> {
  const existingSites = await prisma.projectSite.findMany({ select: { name: true } });
  const existingNames = new Set(existingSites.map((site) => site.name.trim()));

  // Within-workbook duplicate pre-pass (Part 6/10): a single scan over every row, before any
  // write, so both/all rows sharing a name are rejected together — never "first one wins."
  const rowNumbersByName = new Map<string, number[]>();
  for (const row of rows) {
    const name = row.cells['Site Name']!.trim();
    if (!name) continue; // a blank required Site Name is its own (separate) validation error below
    const existing = rowNumbersByName.get(name) ?? [];
    existing.push(row.rowNumber);
    rowNumbersByName.set(name, existing);
  }

  let created = 0;
  const skipped: ImportRowError[] = [];

  for (const row of rows) {
    const name = row.cells['Site Name']!.trim();

    try {
      const siblingRows = (rowNumbersByName.get(name) ?? []).filter((rowNumber) => rowNumber !== row.rowNumber);
      if (name && siblingRows.length > 0) {
        throw new Error(
          `Site Name: Duplicate value "${name}" appears more than once in this workbook (also row(s) ${siblingRows.join(', ')})`,
        );
      }
      if (name && existingNames.has(name)) {
        throw new Error(`Site Name: "${name}" already exists`);
      }

      const input = createProjectSiteSchema.parse({
        name,
        unitLabel: row.cells['Unit Label'] || undefined,
        address: row.cells['Address'] || null,
      });

      // Site + initial Unit + creator assignment, one transaction — see this function's own doc
      // comment for why each piece reuses its module's own canonical creation primitive rather
      // than a parallel, ad-hoc implementation.
      const { site, unit } = await prisma.$transaction(async (tx) => {
        const site = await createProjectSiteInTransaction(tx, currentUser, input);
        const unit = await createProjectUnit(site.id, { name: initialUnitName(site.unitLabel), code: null }, tx);
        return { site, unit };
      });

      await recordAuditLog({
        actorUserId: currentUser.id,
        action: 'project-site.created',
        entityType: 'ProjectSite',
        entityId: site.id,
        metadata: { name: site.name, source: 'import' },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      });
      await recordAuditLog({
        actorUserId: currentUser.id,
        action: 'project-unit.created',
        entityType: 'ProjectUnit',
        entityId: unit.id,
        metadata: { name: unit.name, siteId: unit.siteId, source: 'import', reason: 'initial unit auto-provisioned on site import' },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      });
      if (!isMasterAdmin(currentUser)) {
        await recordAuditLog({
          actorUserId: currentUser.id,
          action: 'project-site.creator_assigned',
          entityType: 'ProjectSite',
          entityId: site.id,
          metadata: { userId: currentUser.id, reason: 'auto-assigned to creator on site import', source: 'import' },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        });
      }

      created += 1;
    } catch (error) {
      // A narrow, safe rewrite of the one race the up-front existing-name snapshot can't catch
      // (a genuinely concurrent, independent request creating the same name) — not a redesign of
      // this importer's concurrency handling, just the same friendly message the ordinary
      // pre-check already produces for the far more common case.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined) ?? [];
        if (target.includes('name')) {
          skipped.push({ row: row.rowNumber, reason: `Site Name: "${name}" already exists` });
          continue;
        }
      }
      skipped.push({ row: row.rowNumber, reason: formatImportValidationError(error, SCHEMA_FIELD_TO_COLUMN) });
    }
  }

  return { created, skipped };
}
