import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { RenderPdfOptions } from '../render-pdf';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Phase 7H — parent-side client for the persistent PDF test worker (`pdf-worker.entry.ts`).
 *
 * Test *files* under Jest's default per-file module registry each get a fresh instance of this
 * module — a JS reference to the worker (a `ChildProcess` object, a socket) cannot be shared
 * between files that way. This coordinates entirely through the filesystem instead: a fixed socket
 * path any file can reconnect to, and a lock *directory* (`fs.mkdirSync`, which is atomic — it
 * either creates the directory or throws `EEXIST`) so that if several files raced to be first, only
 * one of them actually spawns the worker; every other file just waits for the socket to come up.
 *
 * One connection per request, not a shared persistent connection — this codebase's Jest suites run
 * `--runInBand` (test files never run concurrently with each other), and the one place multiple
 * renders run concurrently within a single file (`payslips.routes.ts`'s batch endpoint,
 * `BATCH_RENDER_CONCURRENCY`) already does so as independent `Promise`s; giving each its own
 * connection means the worker's per-connection framing never has to multiplex or correlate
 * concurrent requests by id.
 */

const SOCKET_PATH = process.env.PDF_TEST_WORKER_SOCKET ?? path.join(os.tmpdir(), 'payroll-pdf-test-worker.sock');
const PID_PATH = `${SOCKET_PATH}.pid`;
const LOCK_PATH = `${SOCKET_PATH}.lock`;
const CRASH_PATH = `${SOCKET_PATH}.crash`;
// Written by the worker after every successful render (see its own identical constant) — read
// here so a hung worker's Chrome can still be found and killed even though the worker itself
// isn't responding on the socket to be asked for it.
const CHROME_PID_PATH = `${SOCKET_PATH}.chrome.pid`;

const WORKER_ENTRY = path.join(__dirname, 'pdf-worker.entry.ts');
const READY_TIMEOUT_MS = 30_000;
// Bounded, and comfortably under the 45s jest.setTimeout() real-PDF suites use — overridable so
// `pdf-worker-infrastructure.test.ts` can prove real timeout behavior in milliseconds, not 40 real
// seconds.
const REQUEST_TIMEOUT_MS = Number(process.env.PDF_TEST_WORKER_REQUEST_TIMEOUT_MS) || 40_000;
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_MAX_WAIT_MS = READY_TIMEOUT_MS;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(SOCKET_PATH);
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await canConnect()) return;
    await sleep(100);
  }
  throw new Error(`PDF test worker did not become ready within ${READY_TIMEOUT_MS}ms`);
}

function spawnWorker(): void {
  try {
    fs.unlinkSync(CRASH_PATH); // stale crash record from a prior worker — this is a fresh one
  } catch {
    // Nothing to remove — the common case.
  }

  // Orphan sweep (Phase 7H, confirmed directly to matter): if the *previous* worker generation
  // was killed hard enough that it never ran its own graceful shutdown (e.g. an external SIGKILL
  // targeting only the worker itself, not its children — a realistic OOM-killer shape, and
  // exactly what `pdf-worker-infrastructure.test.ts`'s own crash-simulation does deliberately),
  // `CHROME_PID_PATH` still names that generation's Chrome, alive and unreachable, with nothing
  // else in the system ever positioned to notice. Every new spawn is exactly the right moment to
  // check: about to become the sole owner of this socket's Chrome lineage, so a leftover from the
  // previous one is unambiguously an orphan now, not a resource some other live process still owns.
  try {
    const priorChromePid = Number(fs.readFileSync(CHROME_PID_PATH, 'utf8'));
    if (Number.isInteger(priorChromePid) && priorChromePid > 0) {
      try {
        process.kill(-priorChromePid, 'SIGKILL');
      } catch {
        // Already gone — nothing to clean up.
      }
    }
    fs.unlinkSync(CHROME_PID_PATH);
  } catch {
    // No prior record — the common case (the previous worker, if any, shut down gracefully).
  }

  // `--import tsx` (Node's native loader-registration flag) runs the worker directly under this
  // same process — unlike spawning `tsx`'s own CLI (`tsx/cli`), which re-execs a *second* Node
  // process as its child. That extra hop matters here: `child.pid` below would then be the CLI
  // wrapper's pid, not the actual worker process actually holding the browser, so a hard-kill
  // (`killWorkerHard`) would kill the wrapper and orphan the real worker rather than the browser
  // it's meant to stop (confirmed directly, under Phase 7H's own repeated full-suite stress runs).
  const child = spawn(process.execPath, ['--import', 'tsx', WORKER_ENTRY, SOCKET_PATH], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  if (typeof child.pid === 'number') {
    try {
      fs.writeFileSync(PID_PATH, String(child.pid));
    } catch {
      // Best-effort — a missing pidfile only means a future hung-worker kill can't target it by
      // pid and falls back to just discarding the connection; it doesn't affect a healthy run.
    }
  }
  // Observability (Phase 7H requirement): if this worker process exits on its own — a crash, an
  // OOM kill, anything other than the graceful `shutdown` message this same process's own
  // `sendRequest`/`killWorkerHard` already account for — record its exit code/signal so the next
  // failed request can report *why* the worker is gone, not just that it is.
  child.on('exit', (code, signal) => {
    try {
      fs.writeFileSync(CRASH_PATH, JSON.stringify({ code, signal, exitedAt: new Date().toISOString() }));
    } catch {
      // Best-effort diagnostic only — never let this throw into an unrelated code path.
    }
  });
  // This process must be able to exit without waiting on the worker it just spawned.
  child.unref();
}

/** Reads back the most recent unexpected-exit record (Phase 7H observability), if any — used to
 * enrich a connection-failure error with *why* the worker is unreachable. Best-effort: a missing
 * or unreadable file just means no extra detail is available, never itself a failure. */
function readCrashInfo(): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(CRASH_PATH, 'utf8')) as { code: number | null; signal: string | null; exitedAt: string };
    return `worker exited unexpectedly (code=${raw.code ?? 'null'}, signal=${raw.signal ?? 'null'}, at=${raw.exitedAt})`;
  } catch {
    return undefined;
  }
}

/** Acquires the spawn lock, spawns if nobody else holds it, and either way waits for the socket to
 * become connectable. Idempotent — safe to call before every request. */
async function ensureWorkerRunning(): Promise<void> {
  if (await canConnect()) return;

  let acquiredLock = false;
  try {
    fs.mkdirSync(LOCK_PATH);
    acquiredLock = true;
  } catch {
    // Another file is already spawning (or just did) — fall through to waiting below.
  }

  if (acquiredLock) {
    try {
      spawnWorker();
      await waitUntilReady();
    } finally {
      try {
        fs.rmdirSync(LOCK_PATH);
      } catch {
        // Already removed, or never created — nothing left to clean up.
      }
    }
    return;
  }

  // Didn't get the lock — someone else is spawning. Wait for either the lock to clear or the
  // socket to come up, whichever happens first, bounded so a wedged spawn can't hang forever.
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (await canConnect()) return;
    await sleep(LOCK_POLL_INTERVAL_MS);
  }
  throw new Error(`PDF test worker did not become ready within ${LOCK_MAX_WAIT_MS}ms (waiting on another spawn)`);
}

/** Hard-kills the worker by pid and clears its socket/lock files — used when a request times out,
 * since a worker that's unresponsive enough to blow the request timeout may not be able to service
 * a graceful `shutdown` message either. The next request transparently spawns a fresh worker. */
function killWorkerHard(): void {
  // The worker's own process group — confirmed directly (`ps -eo pid,ppid,pgid`) to cover only
  // the worker itself, *not* Chrome: Puppeteer launches Chrome detached into its own separate OS
  // process group on purpose, so Puppeteer can manage its lifecycle independently. A plain
  // `process.kill(pid, 'SIGKILL')` on just the worker's own pid would leave that group alone
  // entirely; the negative form here at least reaches anything else that *did* inherit the
  // worker's own group, which is why this is still worth doing even though it isn't sufficient by
  // itself for Chrome — see the `CHROME_PID_PATH` kill below for that.
  try {
    const pid = Number(fs.readFileSync(PID_PATH, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) process.kill(-pid, 'SIGKILL');
  } catch {
    // No pidfile, already dead, or already reaped — nothing more to do.
  }
  // Chrome's own process group, read from the file the worker itself keeps current after every
  // successful render (it can't be asked for this over the socket it's hung on) — every Chrome
  // helper process (renderer/GPU/utility) inherited membership in this specific group, confirmed
  // directly, so this one signal reaches all of them.
  try {
    const chromePid = Number(fs.readFileSync(CHROME_PID_PATH, 'utf8'));
    if (Number.isInteger(chromePid) && chromePid > 0) process.kill(-chromePid, 'SIGKILL');
  } catch {
    // No pidfile (no render ever completed), already dead, or already reaped.
  }
  for (const file of [SOCKET_PATH, PID_PATH, CHROME_PID_PATH]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Already removed.
    }
  }
}

async function sendRequest(request: WorkerRequest): Promise<WorkerResponse> {
  await ensureWorkerRunning();

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      killWorkerHard();
      reject(new Error(`PDF test worker request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    timer.unref();

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer.slice(0, newlineIndex)) as WorkerResponse);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        socket.end();
      }
    });
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const crashInfo = readCrashInfo();
      reject(crashInfo ? new Error(`${error.message} (${crashInfo})`) : error);
    });
  });
}

export async function renderViaTestWorker(html: string, options: RenderPdfOptions): Promise<Buffer> {
  const response = await sendRequest({ type: 'render', html, options });
  if (response.type !== 'result') {
    throw new Error(`Unexpected PDF test worker response type: ${response.type}`);
  }
  if (!response.ok) {
    const error = new Error(response.error.message);
    error.name = response.error.name;
    if (response.error.stack) error.stack = response.error.stack;
    throw error;
  }
  return Buffer.from(response.buffer, 'base64');
}

export async function discardTestWorkerBrowser(): Promise<void> {
  await sendRequest({ type: 'discard' }).catch(() => {
    // The worker may already be gone (e.g. just hard-killed by a prior timeout) — the next
    // request transparently respawns it, so a failed discard here is not itself an error.
  });
}

/** For suites that proactively recycle the browser (e.g. after a memory-heavy batch render) — see
 * `render-pdf.ts`'s `closePdfRenderer()`, which is what test files actually call. */
export async function closeTestWorkerBrowser(): Promise<void> {
  if (!(await canConnect())) return; // never started — nothing to close
  await sendRequest({ type: 'close' }).catch(() => {
    // Already gone — nothing left to close.
  });
}

/** Sent exactly once, from `tests/globalTeardown.ts`, at the very end of the whole Jest run — the
 * one place guaranteed to run regardless of which individual suites passed or failed, so the
 * worker never outlives the test process it exists to serve. */
export async function shutdownTestWorker(): Promise<void> {
  if (!(await canConnect())) return; // never started — nothing to shut down
  await sendRequest({ type: 'shutdown' }).catch(() => {
    // If the worker is already unresponsive, hard-kill it directly rather than leaving it running.
    killWorkerHard();
  });
}

// Test-only export — `pdf-worker-infrastructure.test.ts` needs these real paths to assert against
// the worker directly (e.g. confirming no process remains after shutdown, or reading back a
// recorded crash).
export const __TEST_ONLY__ = { SOCKET_PATH, PID_PATH, CRASH_PATH };
