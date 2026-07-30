import { Router, type NextFunction, type Request, type Response } from 'express';
import { getCompanyLogoAsset, type CompanyLogoAssetKind } from './company-logo.service';

/**
 * Deliberately unauthenticated (Phase 7C's own explicit requirement) — the Login page has no
 * session yet, so a route gated behind `requireAuth` could never serve it its own company logo.
 * Mounted separately from `settingsRouter` (which keeps `requireAuth` for everything else under
 * `/api/v1/settings`) so this stays the one place in the entire Settings surface that
 * intentionally skips authentication, rather than threading an exception into the authenticated
 * router itself.
 *
 * Exposes **only** image bytes — never a `CompanySettings` field, never a storage key. A missing
 * logo (no logo set, or a corrupted "set but object missing" state — `company-logo.service.ts`'s
 * own `getCompanyLogoAsset` already logs that case) is a plain 404; every caller (the login page,
 * the sidebar, `<PrintContextHeader>`) is required to fall back to `LogoPlaceholder`/omit the
 * image on anything other than a 200, never to block on it.
 */
export const companyLogoPublicRouter = Router();

async function serveLogoAsset(
  kind: CompanyLogoAssetKind,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // `helmet()`'s app-wide default (`app.ts`) sends `Cross-Origin-Resource-Policy: same-origin` on
  // every response — correct as a default (most responses are JSON, only ever meant for this
  // app's own frontend to `fetch()`), but it also blocks a browser from loading a cross-origin
  // `<img src>` pointing at this exact route, which is precisely how the Login page/Sidebar/print
  // headers consume it (frontend and backend are separate origins in production, and even in this
  // Playwright harness, distinct localhost ports — `docs/architecture/deployment.md`). Overridden
  // here, on this route alone, to the one value that means "any origin may embed this as a
  // subresource" — never applied to any other route, and never relaxes CORS (a separate,
  // JS-readability concern this route doesn't need either, since it's consumed via `<img>`, not
  // `fetch`).
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  try {
    const asset = await getCompanyLogoAsset(kind);
    if (!asset) {
      res.status(404).end();
      return;
    }

    const etag = `"${asset.version}-${kind}"`;
    if (req.get('if-none-match') === etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    // Private (this bucket/route is not meant for a shared CDN cache) and always revalidated via
    // ETag — a replace/remove must never be masked by a stale browser cache, but an unchanged logo
    // still avoids re-sending the same bytes on every navigation.
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('Content-Disposition', 'inline');
    res.status(200).send(asset.buffer);
  } catch (error) {
    next(error);
  }
}

companyLogoPublicRouter.get('/company/logo/ui', (req, res, next) => {
  void serveLogoAsset('ui', req, res, next);
});
companyLogoPublicRouter.get('/company/logo/print', (req, res, next) => {
  void serveLogoAsset('print', req, res, next);
});
