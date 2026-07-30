import sharp, { type Metadata } from 'sharp';
import { badRequest } from '../../common/http-error';

/** Matches the "Maximum file size: 2 MB" copy Settings → Company Details has shown since before
 * this checkpoint (`frontend/src/routes/settings-page.tsx`) — enforced twice, defense in depth:
 * once here (independent of any transport), and again by the upload route's own `multer` limit
 * (`modules/settings/settings.routes.ts`), matching this codebase's existing double-check habit
 * (e.g. `employees.routes.ts`'s CSV import). */
export const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Caps both the accepted source image's own declared dimensions and (via `limitInputPixels`
 * below) the pixel budget `sharp`/`libvips` will decode — bounds decompression-bomb-style input
 * (a tiny file claiming an enormous canvas) independently of the 2 MB byte-size cap above, which
 * says nothing about decoded memory use. */
const MAX_INPUT_DIMENSION_PX = 4096;
const SHARP_PIXEL_LIMIT = MAX_INPUT_DIMENSION_PX * MAX_INPUT_DIMENSION_PX;

/** UI asset — login page, sidebar, Settings preview. None of these display a logo larger than a
 * few dozen CSS pixels; 256px (2x headroom for a retina/HiDPI `<img>`) is generously sized without
 * shipping an oversized payload to the browser on every page load. */
const UI_MAX_DIMENSION_PX = 256;

/** Print asset — embedded in Payslip/Statement PDFs and the Bank Sheet/Cash Receiving print-only
 * header. Printed output benefits from a higher source resolution than an on-screen `<img>` even
 * though it renders at a similarly small physical size, so this is intentionally larger than the
 * UI asset, not the same buffer reused at a different CSS size (this checkpoint's own "generate a
 * separate print asset, do not reuse the UI asset for print" requirement). */
const PRINT_MAX_DIMENSION_PX = 480;

/** A conservative, fast-fail pattern check — rejects the most obviously dangerous SVG content
 * (inline `<script>`, event-handler attributes, `javascript:` URIs, external entity declarations)
 * before ever handing the file to `sharp`. This is deliberately **not** a full SVG sanitizer: the
 * actual safety guarantee against executable SVG content reaching a browser is that this service
 * always rasterizes to PNG for both derived assets below (`sharp(...).png()`) — a browser is never
 * given raw, user-uploaded SVG markup to render, satisfying this checkpoint's "no executable SVG
 * content reaches browsers unchanged" requirement regardless of what this pattern check catches or
 * misses. The check exists purely to fail obviously hostile input quickly and cheaply, without
 * spending a `sharp`/`libvips` decode on it first. */
const SVG_DANGEROUS_PATTERN = /<script[\s>]|on\w+\s*=|javascript:|<!entity|<!doctype[^>]*\[/i;

const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'svg']);

export interface ProcessedCompanyLogo {
  /** Validated, unmodified source bytes — retained for archival purposes only. Never served to a
   * client by any route (see `modules/settings/company-logo.service.ts`), so an SVG original is
   * safe to keep exactly as uploaded even though it is never rendered as SVG again. */
  originalBuffer: Buffer;
  originalContentType: string;
  /** Always a rasterized PNG, regardless of the source format. */
  uiBuffer: Buffer;
  /** Always a rasterized PNG, regardless of the source format. */
  printBuffer: Buffer;
}

function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 512).toString('utf8').trimStart();
  return head.startsWith('<?xml') || /<svg[\s>]/i.test(head);
}

function contentTypeForFormat(format: string): string {
  if (format === 'svg') return 'image/svg+xml';
  if (format === 'jpeg') return 'image/jpeg';
  return 'image/png';
}

/**
 * Validates an uploaded company logo and produces the two approved derived assets (UI, Print) plus
 * the retained original. Throws `HttpError` (400) for anything that fails validation — oversized,
 * unrecognized/corrupt format, disallowed SVG content, or dimensions beyond
 * `MAX_INPUT_DIMENSION_PX` — so a route handler can let it propagate straight to
 * `errorHandler` without its own translation step, matching this codebase's existing convention for
 * request-shape validation (e.g. Zod parse errors thrown directly from a route body).
 *
 * Never trusts a client-supplied filename or `Content-Type` — every accept/reject decision below is
 * based on bytes `sharp` itself decoded (`metadata().format`), the one source of truth for "what
 * kind of image is this."
 */
export async function validateAndProcessCompanyLogo(buffer: Buffer): Promise<ProcessedCompanyLogo> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw badRequest('No file uploaded — expected a multipart field named "file"');
  }
  if (buffer.length > MAX_LOGO_UPLOAD_BYTES) {
    throw badRequest('Logo file exceeds the 2 MB maximum upload size');
  }

  if (looksLikeSvg(buffer) && SVG_DANGEROUS_PATTERN.test(buffer.toString('utf8'))) {
    throw badRequest('This SVG file could not be accepted — it contains disallowed content');
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT }).metadata();
  } catch {
    throw badRequest('The uploaded file is not a valid PNG, JPEG, or SVG image');
  }

  if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
    throw badRequest('Only PNG, JPEG, or SVG logo files are accepted');
  }
  if ((metadata.width ?? 0) > MAX_INPUT_DIMENSION_PX || (metadata.height ?? 0) > MAX_INPUT_DIMENSION_PX) {
    throw badRequest(
      `Logo image dimensions must not exceed ${MAX_INPUT_DIMENSION_PX}x${MAX_INPUT_DIMENSION_PX}px`,
    );
  }

  let uiBuffer: Buffer;
  let printBuffer: Buffer;
  try {
    [uiBuffer, printBuffer] = await Promise.all([
      sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
        .resize(UI_MAX_DIMENSION_PX, UI_MAX_DIMENSION_PX, { fit: 'inside', withoutEnlargement: true })
        // No `.withMetadata()` call — EXIF/ICC/XMP metadata from the source file is dropped by
        // default, satisfying this checkpoint's "strip unsafe metadata" requirement with no extra
        // step needed.
        .png()
        .toBuffer(),
      sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
        .resize(PRINT_MAX_DIMENSION_PX, PRINT_MAX_DIMENSION_PX, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer(),
    ]);
  } catch {
    throw badRequest('The uploaded file could not be processed as an image');
  }

  return {
    originalBuffer: buffer,
    originalContentType: contentTypeForFormat(metadata.format),
    uiBuffer,
    printBuffer,
  };
}
