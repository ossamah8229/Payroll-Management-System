import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Guards the fix for the Render production bug where Puppeteer's Chrome download from the build
 * step wasn't found at runtime (`Could not find Chrome (ver. X.X.X.X)`): the default cache
 * directory (`~/.cache/puppeteer`) sits outside the project directory Render persists from build
 * to runtime. `backend/.puppeteerrc.cjs` must keep pointing `cacheDirectory` at a path inside
 * `backend/` (this file's own directory), not the OS home directory, or the bug regresses even
 * though local dev (which has its own long-lived `~/.cache/puppeteer`) would still pass.
 */
describe('backend/.puppeteerrc.cjs', () => {
  it('points cacheDirectory at a project-local path, not the OS home cache', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../.puppeteerrc.cjs') as { cacheDirectory?: string };

    expect(config.cacheDirectory).toBeDefined();
    expect(resolve(config.cacheDirectory as string)).toBe(config.cacheDirectory);
    expect(config.cacheDirectory).toBe(resolve(__dirname, '..', '.cache', 'puppeteer'));
    // Puppeteer's own default — the exact path this config exists to override — regardless of
    // where the repo itself happens to be checked out (which may well be under the home directory).
    expect(config.cacheDirectory).not.toBe(join(homedir(), '.cache', 'puppeteer'));
  });
});
