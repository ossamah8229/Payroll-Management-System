'use strict';

const { join } = require('node:path');

/**
 * Render's build and start commands both run with this directory (`backend/`, this service's
 * `rootDir` in `render.yaml`) as their process `cwd`. Puppeteer discovers this file by searching
 * upward from `cwd` — so anything invoked with `backend/` as its own process cwd (the explicit
 * `npx puppeteer browsers install chrome` build step, and the compiled server's
 * `puppeteer.launch()` at runtime) resolves `cacheDirectory` to this project-local path, not
 * Puppeteer's own default (`~/.cache/puppeteer`, outside the built service and not guaranteed to
 * survive from the build step into the running deploy).
 *
 * **Does not cover plain `npm install`'s own `postinstall` download.** npm always runs a
 * lifecycle script with `cwd` set to the installed package's own directory
 * (`node_modules/puppeteer`), never the invoking shell's cwd — confirmed empirically here: even a
 * literal `cd backend && npm install` still downloads to `~/.cache/puppeteer`, because this
 * workspace hoists `puppeteer` to the repo root's `node_modules`, which sits outside `backend/`'s
 * own directory tree and so is never reached by this file's upward search. That download is
 * harmless (nothing ever reads from `~/.cache/puppeteer`) but also does nothing useful — the
 * `npx puppeteer browsers install chrome` step in `render.yaml`'s `buildCommand` is what actually
 * provisions the browser into the path below, not a redundant backup for the postinstall step.
 * See `docs/architecture/deployment.md`'s "PDF Generation (Puppeteer/Chrome)" section.
 *
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
