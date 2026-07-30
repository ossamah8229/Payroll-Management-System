import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../common/http-error';
import { logger } from '../../lib/logger';
import { storageProvider } from '../../lib/storage';
import { StorageNotFoundError } from '../../lib/storage/errors';
import { recordAuditLog, type RecordAuditLogInput } from '../audit-log/audit-log.service';
import { validateAndProcessCompanyLogo } from '../../lib/image/logo-image.service';
import { companyLogoObjectKeys } from './company-logo-keys';
import { getCompanySettings } from './settings.service';

const COMPANY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

export type CompanyLogoAssetKind = 'ui' | 'print';

export interface CompanyLogoAsset {
  buffer: Buffer;
  /** The current logo's version identifier — used as this asset's `ETag` by the serving route, so
   * a replace/remove naturally invalidates any cache keyed on it. */
  version: string;
}

interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Best-effort delete of every object under one logo version — logged, never thrown, matching
 * `backup-packages.service.ts`'s own established "cleanup failure leaves an orphaned, unreferenced
 * object, an accepted outcome" convention (docs/architecture/system-conventions.md §2). */
async function deleteLogoVersion(version: string, reason: string): Promise<void> {
  const keys = companyLogoObjectKeys(version);
  for (const key of Object.values(keys)) {
    await storageProvider.delete(key).catch((cleanupError: unknown) => {
      logger.error({ cleanupError, key, version }, `Company logo cleanup (${reason}): failed to delete an object`);
    });
  }
}

/**
 * Upload or replace the company logo. Order matters (this checkpoint's own explicit requirement):
 * 1. validate and write the complete new asset set under a brand-new version key;
 * 2. flip `CompanySettings.logoStorageKey` to the new version;
 * 3. only then best-effort delete the previous version's objects — never before the new version is
 *    safely written and committed, so a mid-upload failure never leaves the working logo deleted.
 */
export async function uploadCompanyLogo(
  actorUserId: string,
  fileBuffer: Buffer,
  requestMeta: RequestMeta,
) {
  const processed = await validateAndProcessCompanyLogo(fileBuffer);

  const previous = await getCompanySettings();
  const newVersion = randomUUID();
  const keys = companyLogoObjectKeys(newVersion);

  await storageProvider.write(keys.original, processed.originalBuffer, {
    contentType: processed.originalContentType,
  });
  await storageProvider.write(keys.ui, processed.uiBuffer, { contentType: 'image/png' });
  await storageProvider.write(keys.print, processed.printBuffer, { contentType: 'image/png' });

  const settings = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { logoStorageKey: newVersion, updatedById: actorUserId },
  });

  const hadExistingLogo = Boolean(previous.logoStorageKey);
  if (previous.logoStorageKey) {
    await deleteLogoVersion(previous.logoStorageKey, 'replaced');
  }

  const auditInput: RecordAuditLogInput = {
    actorUserId,
    action: hadExistingLogo ? 'company.logo.replaced' : 'company.logo.uploaded',
    entityType: 'CompanySettings',
    entityId: settings.id,
    metadata: {
      contentType: processed.originalContentType,
      originalSizeBytes: processed.originalBuffer.length,
      uiSizeBytes: processed.uiBuffer.length,
      printSizeBytes: processed.printBuffer.length,
      hadExistingLogo,
    },
    ipAddress: requestMeta.ipAddress,
    userAgent: requestMeta.userAgent,
  };
  await recordAuditLog(auditInput);

  return settings;
}

export async function removeCompanyLogo(actorUserId: string, requestMeta: RequestMeta) {
  const previous = await getCompanySettings();
  if (!previous.logoStorageKey) {
    throw notFound('No company logo to remove');
  }

  const settings = await prisma.companySettings.update({
    where: { id: COMPANY_SETTINGS_ID },
    data: { logoStorageKey: null, updatedById: actorUserId },
  });

  await deleteLogoVersion(previous.logoStorageKey, 'removed');

  await recordAuditLog({
    actorUserId,
    action: 'company.logo.removed',
    entityType: 'CompanySettings',
    entityId: settings.id,
    metadata: { hadExistingLogo: true },
    ipAddress: requestMeta.ipAddress,
    userAgent: requestMeta.userAgent,
  });

  return settings;
}

/**
 * Reads a derived logo asset back through `storageProvider` — used both by the unauthenticated
 * public routes (`company-logo.routes.ts`, for `ui`/`print` over HTTP) and directly, in-process, by
 * the Payslip/Statement PDF templates (no HTTP round trip needed for a same-process caller).
 * Returns `null` for "no logo set" or "set but the object is unexpectedly missing" alike — both are
 * "there is no logo to show right now" from every caller's point of view; the latter is also logged
 * as the corrupted-state condition it actually is, mirroring
 * `backup-packages.routes.ts`'s own `StorageNotFoundError` handling for a `READY` package's file.
 */
/**
 * `knownLogoStorageKey` lets a caller that has *already* fetched `CompanySettings` for its own
 * purposes (e.g. `statements.service.ts`'s `generateStatementPdf`, which needs `companyName`/
 * `registeredAddress` too) pass that same row's `logoStorageKey` straight through instead of
 * triggering a second, redundant `getCompanySettings()` read — the exact N+1 a query-count
 * regression test (`tests/statements.test.ts`) caught when this originally called
 * `getCompanySettings()` unconditionally. Omit it (the public routes' own usage) and this fetches
 * settings itself.
 */
export async function getCompanyLogoAsset(
  kind: CompanyLogoAssetKind,
  knownLogoStorageKey?: string | null,
): Promise<CompanyLogoAsset | null> {
  const logoStorageKey =
    knownLogoStorageKey !== undefined ? knownLogoStorageKey : (await getCompanySettings()).logoStorageKey;
  if (!logoStorageKey) return null;

  const keys = companyLogoObjectKeys(logoStorageKey);
  const key = kind === 'ui' ? keys.ui : keys.print;

  try {
    const buffer = await storageProvider.read(key);
    return { buffer, version: logoStorageKey };
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      logger.error(
        { logoStorageKey, kind },
        'Company logo: storage object missing for a set logoStorageKey — corrupted state',
      );
      return null;
    }
    throw error;
  }
}

/**
 * The print asset, pre-encoded as a `data:` URI — what `templates/payslip.ts`/`templates/
 * statement.ts` actually embed. Puppeteer's `page.setContent()` has no live backend to fetch an
 * `<img src="/api/...">` from (`render-pdf.ts`'s own doc comment: a static HTML string, no
 * navigation, no cookie/session handoff) — a base64 data URI is the one way to embed this image
 * with no network round trip. Fetched **once per request** by each PDF route (single Payslip,
 * Statement, or an entire Payslip batch) and passed through that request's own `*PdfMeta`, never
 * re-fetched per document — a batch of 300 Payslips must not turn into 300 avoidable
 * `storageProvider.read` calls for the exact same, unchanging bytes. See `getCompanyLogoAsset`'s own
 * doc comment for `knownLogoStorageKey`'s purpose.
 */
export async function getCompanyLogoDataUri(knownLogoStorageKey?: string | null): Promise<string | null> {
  const asset = await getCompanyLogoAsset('print', knownLogoStorageKey);
  if (!asset) return null;
  return `data:image/png;base64,${asset.buffer.toString('base64')}`;
}
