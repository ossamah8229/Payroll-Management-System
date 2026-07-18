import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  BACKEND_PORT,
  BACKEND_URL,
  CSRF_SECRET,
  DATABASE_URL,
  E2E_TMP_DIR,
  FRONTEND_PORT,
  FRONTEND_URL,
  MASTER_ADMIN_PASSWORD,
  PG_DATA_DIR,
  PG_DATABASE,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
  REPO_ROOT,
  SESSION_SECRET,
  STATE_FILE,
  STORAGE_ROOT,
} from './config';

const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const LOG_DIR = E2E_TMP_DIR;

interface StateFile {
  pids: number[];
  pgDataDir: string;
}

function logPath(name: string): string {
  return path.join(LOG_DIR, `${name}.log`);
}

/**
 * `@embedded-postgres/<platform>` ships its shared-library symlinks as a `pg-symlinks.json`
 * manifest (npm tarballs can't preserve real symlinks) and normally re-creates them via its own
 * `postinstall` — blocked in this repository by the `allowScripts` convention
 * (`package.json`), the same defense-in-depth this project already applies to every other
 * package with an install script. Re-running the script explicitly (safe: it only recreates
 * symlinks and silently no-ops on ones that already exist — see the script's own source) makes
 * environment startup work regardless of whether that postinstall ran, without having to widen
 * the trusted-script allowlist for a step this function already performs itself.
 */
async function hydratePlatformSymlinks(): Promise<void> {
  const platform = process.platform;
  const arch = process.arch;
  const platformPackage = `@embedded-postgres/${platform}-${arch}`;

  let packageDir: string;
  try {
    // This package's own `package.json` declares `"exports": "./dist/index.js"` with no
    // `./package.json` subpath exported, so it can't be resolved directly — resolving its main
    // entry point and walking back up to the package root works regardless.
    const entryPoint = require.resolve(platformPackage, { paths: [REPO_ROOT] });
    packageDir = path.dirname(path.dirname(entryPoint));
  } catch {
    throw new Error(
      `No embedded-postgres binary package found for ${platform}/${arch} (expected "${platformPackage}"). ` +
        `See tests/e2e/README.md for supported platforms.`,
    );
  }

  const hydrateScript = path.join(packageDir, 'scripts', 'hydrate-symlinks.js');
  if (!fs.existsSync(hydrateScript)) return;

  const result = spawnSync(process.execPath, [hydrateScript], { cwd: packageDir, stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`Failed to hydrate ${platformPackage}'s symlinks (exit code ${result.status})`);
  }
}

async function waitForUrl(url: string, timeoutMs: number, processLabel: string, proc: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const log = fs.existsSync(logPath(processLabel))
        ? fs.readFileSync(logPath(processLabel), 'utf-8').slice(-2000)
        : '(no log)';
      throw new Error(`${processLabel} exited early (code ${proc.exitCode}) while waiting for ${url}:\n${log}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const log = fs.existsSync(logPath(processLabel)) ? fs.readFileSync(logPath(processLabel), 'utf-8').slice(-2000) : '';
  throw new Error(
    `Timed out waiting for ${processLabel} (${url}) after ${timeoutMs}ms. Last error: ${String(lastError)}\n${log}`,
  );
}

/** Spawns a detached, log-redirected child process — detached so it forms its own process group,
 * letting `stopEnvironment` kill the whole group (`-pid`) and take any of its own subprocesses
 * (e.g. a wrapper script's own children) down with it, never leaving an orphan behind. */
function spawnLogged(label: string, command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  const out = fs.openSync(logPath(label), 'a');
  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', out, out],
    detached: true,
  });
  return proc;
}

function runSync(label: string, command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): void {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: 'utf-8' });
  fs.writeFileSync(logPath(label), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit code ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}

/**
 * Provisions an entirely disposable stack for the E2E suite: a fresh embedded PostgreSQL cluster
 * (own port, own credentials, own data directory — never `payroll_dev`), migrated and seeded, then
 * the real compiled backend and the real production frontend build, both started as ordinary child
 * processes. Idempotent to call repeatedly across local runs — any stale state directory from a
 * previous, uncleanly-terminated run is removed first, so a crashed prior run can never leave this
 * one reading half-written data.
 */
export async function startEnvironment(): Promise<void> {
  await fsp.rm(E2E_TMP_DIR, { recursive: true, force: true });
  await fsp.mkdir(E2E_TMP_DIR, { recursive: true });
  await fsp.mkdir(STORAGE_ROOT, { recursive: true });

  await hydratePlatformSymlinks();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const EmbeddedPostgres = require('embedded-postgres').default;
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DATA_DIR,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(PG_DATABASE);

  const pids: number[] = [];

  // Build shared first — `prisma/seed.ts` itself imports `@payroll/shared` (`ROLE_CODES`, etc.),
  // so this must happen before migrate+seed below, not just before starting the backend/frontend
  // (a fresh clone with no prior `npm run build` has no `shared/dist` yet at all).
  runSync('build-shared', 'npm', ['run', 'build', '--workspace', 'shared'], { cwd: REPO_ROOT, env: process.env });

  // Migrate + seed the fresh E2E database — the same migrations/seed script every environment
  // uses, run against DATABASE_URL pointed at the just-created E2E-only database.
  const dbEnv = { ...process.env, DATABASE_URL };
  runSync('prisma-migrate', 'npx', ['prisma', 'migrate', 'deploy'], { cwd: BACKEND_DIR, env: dbEnv });
  runSync('prisma-seed', 'npx', ['tsx', 'prisma/seed.ts'], {
    cwd: BACKEND_DIR,
    env: { ...dbEnv, SEED_MASTER_ADMIN_PASSWORD: MASTER_ADMIN_PASSWORD },
  });

  runSync('build-backend', 'npm', ['run', 'build', '--workspace', 'backend'], { cwd: REPO_ROOT, env: process.env });

  const backendEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(BACKEND_PORT),
    DATABASE_URL,
    SESSION_SECRET,
    CSRF_SECRET,
    CORS_ORIGIN: FRONTEND_URL,
    STORAGE_ROOT,
  };
  const backendProc = spawnLogged('backend', 'node', ['dist/server.js'], { cwd: BACKEND_DIR, env: backendEnv });
  if (backendProc.pid) pids.push(backendProc.pid);
  await waitForUrl(`${BACKEND_URL}/health`, 30_000, 'backend', backendProc);

  // The frontend is built (not `vite dev`) so the E2E suite exercises the real production
  // output — genuine route-level code-split chunks (AUD-012), not Vite's unbundled dev module
  // graph — then served statically via `vite preview`, matching the topology real deployment
  // uses (docs/architecture/deployment.md) and the same approach this project's own prior
  // real-browser verification passes have used.
  runSync('build-frontend', 'npm', ['run', 'build', '--workspace', 'frontend'], {
    cwd: REPO_ROOT,
    env: { ...process.env, VITE_API_URL: BACKEND_URL },
  });
  const frontendProc = spawnLogged(
    'frontend',
    'npx',
    ['vite', 'preview', '--port', String(FRONTEND_PORT), '--strictPort'],
    { cwd: FRONTEND_DIR, env: process.env },
  );
  if (frontendProc.pid) pids.push(frontendProc.pid);
  await waitForUrl(FRONTEND_URL, 30_000, 'frontend', frontendProc);

  const state: StateFile = { pids, pgDataDir: PG_DATA_DIR };
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Tears down everything `startEnvironment` started — reads the state file rather than relying on
 * in-memory handles, since Playwright invokes `globalSetup` and `globalTeardown` as independent
 * calls with no guaranteed shared process state between them. Each process is killed by its own
 * process group (negative pid) so a wrapper's own child processes (e.g. `npx`'s own spawned
 * `vite` binary) are taken down too, never left orphaned. `embedded-postgres`'s own `stop()` (with
 * `persistent: false`) removes the ephemeral data directory itself; the rest of `E2E_TMP_DIR`
 * (logs, storage, the state file) is removed last.
 */
export async function stopEnvironment(): Promise<void> {
  let state: StateFile | undefined;
  try {
    state = JSON.parse(await fsp.readFile(STATE_FILE, 'utf-8')) as StateFile;
  } catch {
    // No state file — nothing was started, or a previous teardown already ran. Fine either way.
  }

  for (const pid of state?.pids ?? []) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Already exited, or never a valid process group leader — nothing more to do for this pid.
    }
  }
  // Give each process a moment to exit cleanly before the data directory it may still be
  // flushing to gets removed out from under it.
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (state?.pgDataDir && fs.existsSync(state.pgDataDir)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const EmbeddedPostgres = require('embedded-postgres').default;
      const pg = new EmbeddedPostgres({ databaseDir: state.pgDataDir, port: PG_PORT, persistent: false });
      await pg.stop();
    } catch {
      // Best-effort — if this fails, the recursive rm below still removes the data directory.
    }
  }

  await fsp.rm(E2E_TMP_DIR, { recursive: true, force: true });
}
