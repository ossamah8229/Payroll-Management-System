import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../common/http-error';
import type { RequestMeta } from '../../common/request-meta';
import { logger } from '../../lib/logger';
import { recordAuditLog } from '../audit-log/audit-log.service';
import { storageProvider } from '../../lib/storage';
import { StorageError } from '../../lib/storage/errors';
import { getPayrollCycle } from '../payroll-processing/payroll-processing.service';
import { exportPayrollEntriesToCsv, exportPayrollEntriesToXlsx } from '../payroll-entry/payroll-entry-import-export.service';
import { buildCombinedBankSheetCsv } from '../bank-sheets/bank-sheets.service';
import { exportCashReceivingSheetToCsv } from '../cash-receiving/cash-receiving.service';
import { getCompanySettings } from '../settings/settings.service';

/**
 * Backup Packages (Phase 5 Checkpoint 2, docs/architecture/database/payroll-cycle.md §17-18) —
 * the reusable, versioned backup-generation domain. Generation is **manually triggered only** in
 * this checkpoint (no automatic month-end generation, no cycle archiving — both later, separately
 * authorized Phase 5 checkpoints); this module builds the generator those later checkpoints will
 * eventually call from inside their own transactions.
 *
 * **Content, per the approved architecture review (2026-07-14):** Payroll Entry CSV + XLSX,
 * one combined Bank Sheets CSV (every active Bank plus Cash), Cash Receiving CSV, and
 * `manifest.json`. Payslip PDFs and an Audit Log export were both evaluated and explicitly
 * deferred — absent from this checkpoint entirely, not stubbed.
 *
 * **Reuse boundary (Principle 6 — no parallel calculation path):** every data file is produced by
 * calling this codebase's own existing, already-shipped export builders
 * (`exportPayrollEntriesToCsv`/`Xlsx`, `buildCombinedBankSheetCsv`, `exportCashReceivingSheetToCsv`)
 * exactly as the live export routes already do — this module only orchestrates *which* builders run
 * and *how* their output is bundled/persisted, never recomputing a payroll figure itself.
 */

const MANIFEST_FILENAME = 'manifest.json';

/** Reads `backend/package.json`'s own `version` field, resolved the same way `STORAGE_ROOT`/
 * `DATABASE_URL` already are — relative to the process's working directory
 * (`backend/src/lib/storage/resolve-root.ts`'s own established convention), since this backend is
 * always run from the `backend/` directory. Falls back to `'unknown'` rather than throwing — a
 * missing/unreadable `package.json` should never block backup generation itself. This project does
 * not yet bump this field per deploy, a known, accepted limitation (docs/PROJECT_PROGRESS.md), not
 * something this checkpoint invents a fix for. */
export function getApplicationVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The latest applied Prisma migration name, read directly from Prisma's own `_prisma_migrations`
 * table — no new schema needed to track this. Falls back to `'unknown'` if the table is somehow
 * unreadable rather than blocking generation over a purely descriptive field. */
export async function getDatabaseSchemaVersion(): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return rows[0]?.migration_name ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Released/held/pending counts at generation time — computed identically to Finalize Cycle's own
 * `payroll_cycle.released` audit metadata shape (`entryCount`/`releasedCount`/`heldCount`), not a
 * new calculation. */
async function computeReleaseStatusSummary(cycleId: string) {
  const [entryCount, releasedCount, heldCount] = await Promise.all([
    prisma.payrollEntry.count({ where: { cycleId } }),
    prisma.payrollEntry.count({ where: { cycleId, released: true } }),
    prisma.payrollEntry.count({ where: { cycleId, hold: true } }),
  ]);
  return { entryCount, releasedCount, heldCount };
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Recursively sorts every object's own keys (arrays keep their element order — the manifest's own
 * `files` list order is meaningful) before `JSON.stringify`, so the manifest's serialized bytes —
 * and therefore its checksum — never depend on JS's own key-insertion order. */
function canonicalJsonStringify(value: unknown, indent = 2): string {
  function sortKeys(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map(sortKeys);
    }
    if (input !== null && typeof input === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        sorted[key] = sortKeys((input as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return input;
  }
  return JSON.stringify(sortKeys(value), null, indent);
}

/** A short, non-sensitive diagnostic for `BackupPackage.failureReason` — never a stack trace, SQL
 * detail, or filesystem path. `StorageError` subclasses guarantee their own `message` is safe to
 * log (`backend/src/lib/storage/errors.ts`'s own log-hygiene note); anything else (a Prisma error,
 * an exporter throwing) may carry raw SQL or path detail in its own `message`, so only its error
 * class name is recorded, never that message. */
function safeFailureReason(error: unknown): string {
  if (error instanceof StorageError) {
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${error.constructor.name} occurred during Backup Package generation`;
  }
  return 'Unknown error occurred during Backup Package generation';
}

function formatCycleLabel(year: number, month: number): string {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export interface ManifestFileEntry {
  fileType: string;
  filename: string;
  sizeBytes: number;
  checksum: string;
}

export interface ManifestPayload {
  packageVersion: number;
  cycle: { id: string; year: number; month: number };
  generatedAt: string;
  generatedBy: { id: string; name: string };
  applicationVersion: string;
  databaseSchemaVersion: string;
  releaseStatusSummary: { entryCount: number; releasedCount: number; heldCount: number };
  files: ManifestFileEntry[];
  totalDataSizeBytes: number;
}

/**
 * Generates a new, versioned Backup Package for one payroll cycle — the reusable primitive
 * (docs/architecture/system-conventions.md §2's cross-system atomicity ordering): assemble content
 * → write storage objects → one final Postgres transaction (package + file rows + audit) → commit.
 * If anything fails after the version is reserved, this attempt's own storage objects are
 * best-effort cleaned up and the reserved row is marked `FAILED` with a safe diagnostic — it is
 * never left `GENERATING` forever by a caught error, and never partially `READY`.
 *
 * **Rejects a Draft cycle** — a Backup Package is a historical-snapshot artifact
 * (docs/architecture/workflows/payroll-lifecycle.md §5); backing up payroll still being entered
 * would be confusing at best. `RELEASED` and `ARCHIVED` cycles are both accepted (the latter has no
 * code path that sets it yet — Checkpoint 3 — but this check already permits it so that future
 * checkpoint needs no change here).
 *
 * **Version allocation is race-safe**: the next version is computed and reserved via an ordinary
 * `create()` relying on the `(cycleId, version)` unique constraint as the concurrency backstop — a
 * losing concurrent attempt gets a clean, typed `409 CONFLICT` (never a raw constraint-violation
 * leak, never two successful generations landing on the same version). The reservation happens
 * *before* any storage write begins, so two concurrent callers can never write to the same
 * version's storage keys.
 */
export async function generateBackupPackage(
  currentUser: SessionUser,
  cycleId: string,
  requestMeta: RequestMeta,
) {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) {
    throw notFound('Payroll cycle not found');
  }
  if (cycle.status === 'DRAFT') {
    throw badRequest('Cannot generate a Backup Package for a Draft payroll cycle');
  }

  const releaseStatusSummary = await computeReleaseStatusSummary(cycleId);
  const applicationVersion = getApplicationVersion();
  const databaseSchemaVersion = await getDatabaseSchemaVersion();

  const maxVersion = await prisma.backupPackage.aggregate({ where: { cycleId }, _max: { version: true } });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  let reserved: Prisma.BackupPackageGetPayload<Record<string, never>>;
  try {
    reserved = await prisma.backupPackage.create({
      data: {
        cycleId,
        version: nextVersion,
        status: 'GENERATING',
        generatedBy: currentUser.id,
        applicationVersion,
        databaseSchemaVersion,
        releaseStatusSummary,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict(
        'A Backup Package generation was already reserved for this cycle at this version — retry to allocate the next one',
      );
    }
    throw error;
  }

  const keyPrefix = `backups/${cycleId}/v${nextVersion}`;
  const writtenKeys: string[] = [];

  try {
    // Assemble content — every byte comes from an existing, already-shipped export builder;
    // nothing here recomputes a payroll figure.
    const [payrollCsv, payrollXlsx, bankSheetsCsv] = await Promise.all([
      exportPayrollEntriesToCsv(currentUser, cycleId),
      exportPayrollEntriesToXlsx(currentUser, cycleId),
      buildCombinedBankSheetCsv(currentUser, cycleId),
    ]);

    const companySettings = await getCompanySettings();
    const cashReceivingCsv = await exportCashReceivingSheetToCsv(currentUser, cycleId, {
      companyName: companySettings.companyName,
      cycleLabel: formatCycleLabel(cycle.year, cycle.month),
      generatedByName: currentUser.name,
      generatedAt: new Date(),
    });

    // Deterministic order + checksums for the four data files.
    const dataFiles = [
      {
        fileType: 'PAYROLL_ENTRY_CSV' as const,
        filename: 'payroll-entry.csv',
        contentType: 'text/csv',
        buffer: payrollCsv.buffer,
      },
      {
        fileType: 'PAYROLL_ENTRY_XLSX' as const,
        filename: 'payroll-entry.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: payrollXlsx.buffer,
      },
      {
        fileType: 'BANK_SHEETS_CSV' as const,
        filename: 'bank-sheets.csv',
        contentType: 'text/csv',
        buffer: bankSheetsCsv.buffer,
      },
      {
        fileType: 'CASH_RECEIVING_CSV' as const,
        filename: 'cash-receiving.csv',
        contentType: 'text/csv',
        buffer: cashReceivingCsv.buffer,
      },
    ].map((file) => ({ ...file, sizeBytes: file.buffer.length, checksum: sha256Hex(file.buffer) }));

    // Manifest is computed last (it needs every other file's checksum/size to be meaningful) but
    // published/listed/stored first — the deterministic order this checkpoint's own spec requires.
    const manifestPayload: ManifestPayload = {
      packageVersion: nextVersion,
      cycle: { id: cycle.id, year: cycle.year, month: cycle.month },
      generatedAt: new Date().toISOString(),
      generatedBy: { id: currentUser.id, name: currentUser.name },
      applicationVersion,
      databaseSchemaVersion,
      releaseStatusSummary,
      files: dataFiles.map((file) => ({
        fileType: file.fileType,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
        checksum: file.checksum,
      })),
      totalDataSizeBytes: dataFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    };
    const manifestBuffer = Buffer.from(canonicalJsonStringify(manifestPayload), 'utf-8');
    const manifestChecksum = sha256Hex(manifestBuffer);

    const allFiles = [
      {
        fileType: 'MANIFEST' as const,
        filename: MANIFEST_FILENAME,
        contentType: 'application/json',
        buffer: manifestBuffer,
        sizeBytes: manifestBuffer.length,
        checksum: manifestChecksum,
      },
      ...dataFiles,
    ];

    // Write storage objects — manifest.json first, then the data files, matching the deterministic
    // order above. Keys are recorded as each write succeeds so a later failure can best-effort
    // clean up exactly (and only) what this attempt itself wrote.
    for (const file of allFiles) {
      const key = `${keyPrefix}/${file.filename}`;
      await storageProvider.write(key, file.buffer, { contentType: file.contentType });
      writtenKeys.push(key);
    }

    const totalSizeBytes = allFiles.reduce((sum, file) => sum + file.sizeBytes, 0);

    // One final transaction: file rows, package -> READY, audit entry — all together or not at all.
    await prisma.$transaction(
      async (tx) => {
        for (const [index, file] of allFiles.entries()) {
          await tx.backupPackageFile.create({
            data: {
              backupPackageId: reserved.id,
              fileType: file.fileType,
              filename: file.filename,
              storageKey: `${keyPrefix}/${file.filename}`,
              contentType: file.contentType,
              sizeBytes: file.sizeBytes,
              checksum: file.checksum,
              sortOrder: index,
            },
          });
        }

        await tx.backupPackage.update({
          where: { id: reserved.id },
          data: {
            status: 'READY',
            generatedAt: new Date(),
            totalSizeBytes,
            fileCount: allFiles.length,
            manifestChecksum,
          },
        });

        await recordAuditLog(
          {
            actorUserId: currentUser.id,
            action: 'backup_package.generated',
            entityType: 'BackupPackage',
            entityId: reserved.id,
            metadata: { cycleId, version: nextVersion, fileCount: allFiles.length, totalSizeBytes },
            ipAddress: requestMeta.ipAddress,
            userAgent: requestMeta.userAgent,
          },
          tx,
        );
      },
      { timeout: 30_000 },
    );

    return prisma.backupPackage.findUniqueOrThrow({
      where: { id: reserved.id },
      include: { files: { orderBy: { sortOrder: 'asc' } } },
    });
  } catch (error) {
    // Best-effort cleanup — never blocks or masks the original error; a cleanup failure leaves an
    // orphaned (unreferenced by any READY row) storage object, an accepted outcome per
    // docs/architecture/system-conventions.md §2's cross-system atomicity note, not a reason to
    // fail differently.
    for (const key of writtenKeys) {
      await storageProvider.delete(key).catch((cleanupError: unknown) => {
        logger.error(
          { cleanupError, key, cycleId, version: nextVersion },
          'Backup Package generation cleanup: failed to delete an orphaned storage object',
        );
      });
    }

    const failureReason = safeFailureReason(error);
    await prisma.backupPackage
      .update({ where: { id: reserved.id }, data: { status: 'FAILED', failureReason } })
      .catch((updateError: unknown) => {
        logger.error(
          { updateError, backupPackageId: reserved.id },
          'Backup Package generation: failed to mark the package FAILED after an earlier error',
        );
      });

    await recordAuditLog({
      actorUserId: currentUser.id,
      action: 'backup_package.generation_failed',
      entityType: 'BackupPackage',
      entityId: reserved.id,
      metadata: { cycleId, version: nextVersion, failureReason },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    }).catch((auditError: unknown) => {
      logger.error(
        { auditError, backupPackageId: reserved.id },
        'Backup Package generation: failed to write the generation_failed audit entry',
      );
    });

    throw error;
  }
}

export async function listBackupPackages(cycleId: string) {
  await getPayrollCycle(cycleId); // 404s cleanly if the cycle doesn't exist
  return prisma.backupPackage.findMany({
    where: { cycleId },
    include: { files: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { version: 'desc' },
  });
}

export async function getBackupPackage(id: string) {
  const backupPackage = await prisma.backupPackage.findUnique({
    where: { id },
    include: { files: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!backupPackage) {
    throw notFound('Backup package not found');
  }
  return backupPackage;
}

/** Resolves and authorizes a single stored file for download — the one place a raw `storageKey`
 * is ever read off a `BackupPackageFile` row; the caller (the download route) never accepts one
 * from the client. Only a file belonging to a `READY` package is ever returned — a `GENERATING`/
 * `FAILED` package's files are never downloadable, matching the "complete and downloadable, or
 * does not exist as a usable domain record" invariant. */
export async function getBackupPackageFile(fileId: string) {
  const file = await prisma.backupPackageFile.findUnique({
    where: { id: fileId },
    include: { backupPackage: true },
  });
  if (!file || file.backupPackage.status !== 'READY') {
    throw notFound('Backup package file not found');
  }
  return file;
}
