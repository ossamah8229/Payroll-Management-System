import * as net from 'node:net';
import * as fs from 'node:fs';
import { renderOnce } from '../render-pdf';
import { closeBrowser, discardBrowser, peekBrowserProcessPid } from '../browser';
import { normalizeError } from '../normalize-error';
import type { WorkerRequest, WorkerResponse } from './protocol';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Phase 7H — the persistent PDF test worker. Spawned lazily (`pdf-worker-client.ts`) by whichever
 * Jest test file first needs a real Puppeteer render, and reused by every file for the rest of the
 * `--runInBand` run — this process is never itself inside a Jest VM realm, so it is structurally
 * immune to the `"Test environment has been torn down"` race that motivated this checkpoint (see
 * `render-pdf.ts`'s own comment on `renderHtmlToPdf`). Calls `renderOnce`/`browser.ts` directly —
 * the exact same production rendering code, not a reimplementation.
 *
 * Ownership/cleanup: exits on an explicit `shutdown` message (sent by `globalTeardown.ts` once, at
 * the very end of the whole test run), on `SIGTERM`/`SIGINT`, or — as a last-resort safety net, in
 * case cleanup is ever skipped (e.g. a hard crash of the parent) — after `IDLE_TIMEOUT_MS` with no
 * request. Always closes its own browser first.
 */

const socketPathArg = process.argv[2];
if (!socketPathArg) {
  console.error('pdf-worker: missing socket path argument');
  process.exit(1);
}
const socketPath: string = socketPathArg;
// Written after every successful render, read by `pdf-worker-client.ts`'s `killWorkerHard()` —
// a hung worker can't be asked nicely for Chrome's pid over the socket it's not responding on, so
// the client needs an independent, already-on-disk way to find Chrome's own process group when it
// has to force a hung worker down (see `shutdown()`'s identical backstop, below, for why this
// worker's own process group isn't sufficient on its own).
const chromePidPath = `${socketPath}.chrome.pid`;

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
let idleTimer: NodeJS.Timeout;

function resetIdleTimer(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void shutdown(0);
  }, IDLE_TIMEOUT_MS);
  idleTimer.unref();
}

let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(idleTimer);

  // Captured *before* closing — `closeBrowser()` clears the module's own reference to it, and a
  // read-only pid lookup afterward would find nothing to look up.
  const chromePid = peekBrowserProcessPid();

  await closeBrowser().catch(() => {
    // Best-effort — a worker that's shutting down anyway must not fail to exit because its own
    // browser was already dead.
  });

  // Backstop (Phase 7H, confirmed directly under repeated stress runs to matter):
  // `browser.close()` above is the correct, graceful way to ask Chrome to exit, but not always
  // sufficient to terminate every Chrome helper process (renderer/GPU/utility) — confirmed
  // directly via `ps`: Puppeteer launches Chrome *detached* into its own OS process group,
  // separate from this worker's own, specifically so Puppeteer can manage its lifecycle
  // independently — so a signal to *this* process's group (or its own graceful exit) never
  // reaches Chrome's. In the previous in-process architecture a straggler like that stayed a
  // child of the test process itself; this worker is spawned `detached: true` specifically so
  // Jest's own VM-realm churn can never take it down with a test file, which also means nothing
  // else in the system will ever notice or clean up a Chrome process that outlives it. Killing
  // Chrome's *own* process group directly — every helper process it spawned inherited membership
  // in that group, confirmed directly via `ps -eo pid,ppid,pgid` — guarantees none survive.
  if (chromePid !== undefined && isProcessAlive(chromePid)) {
    try {
      process.kill(-chromePid, 'SIGKILL');
    } catch {
      // Already gone between the check and the signal — nothing left to do.
    }
  }

  server.close();
  for (const file of [socketPath, chromePidPath]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Already removed, or never created — nothing left to clean up.
    }
  }
  process.exit(code);
}

function writeResponse(socket: net.Socket, response: WorkerResponse): void {
  socket.write(`${JSON.stringify(response)}\n`);
}

async function handleRequest(socket: net.Socket, request: WorkerRequest): Promise<void> {
  resetIdleTimer();
  if (request.type === 'render') {
    try {
      const buffer = await renderOnce(request.html, request.options);
      const chromePid = peekBrowserProcessPid();
      if (chromePid !== undefined) {
        try {
          fs.writeFileSync(chromePidPath, String(chromePid));
        } catch {
          // Best-effort — only affects killWorkerHard()'s backstop precision, not correctness.
        }
      }
      writeResponse(socket, { type: 'result', ok: true, buffer: buffer.toString('base64') });
    } catch (error) {
      writeResponse(socket, { type: 'result', ok: false, error: normalizeError(error) });
    }
    return;
  }
  if (request.type === 'discard') {
    discardBrowser();
    // Stale otherwise — the pid it names is being discarded, and the next render (a fresh
    // browser, a fresh pid) will write a current one before this file is ever read again.
    try {
      fs.unlinkSync(chromePidPath);
    } catch {
      // Nothing to remove.
    }
    writeResponse(socket, { type: 'ack' });
    return;
  }
  if (request.type === 'close') {
    // Same backstop as shutdown() — see its own comment for why browser.close() alone isn't
    // always sufficient.
    const chromePid = peekBrowserProcessPid();
    await closeBrowser().catch(() => {});
    if (chromePid !== undefined && isProcessAlive(chromePid)) {
      try {
        process.kill(-chromePid, 'SIGKILL');
      } catch {
        // Already gone between the check and the signal.
      }
    }
    try {
      fs.unlinkSync(chromePidPath);
    } catch {
      // Nothing to remove.
    }
    writeResponse(socket, { type: 'ack' });
    return;
  }
  if (request.type === 'shutdown') {
    writeResponse(socket, { type: 'ack' });
    await shutdown(0);
  }
}

const server = net.createServer((socket) => {
  let buffer = '';
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (let newlineIndex = buffer.indexOf('\n'); newlineIndex !== -1; newlineIndex = buffer.indexOf('\n')) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        const request = JSON.parse(line) as WorkerRequest;
        void handleRequest(socket, request);
      } catch (error) {
        writeResponse(socket, { type: 'result', ok: false, error: normalizeError(error) });
      }
    }
  });
  socket.on('error', () => {
    // A client that disconnects mid-request (e.g. its own timeout fired first) is not this
    // process's problem — nothing to clean up beyond the socket itself, which Node already does.
  });
});

/** Phase 7H — confirmed directly, under repeated full-backend-suite stress: `pdf-worker-client.ts`'s
 * own `canConnect()` check (before deciding to spawn) can occasionally return a false negative
 * under load, so two workers can end up racing to spawn. A first version of this startup sequence
 * checked "is anyone already listening?" and then unconditionally unlinked-and-rebound if not —
 * itself a race (two workers can both see "no listener yet" before either has bound, then the
 * second's `unlink` steals the path out from under the first's already-successful `listen()`,
 * confirmed directly by reproducing exactly that: both alive, neither erroring). This version
 * removes that window entirely by never unlinking pre-emptively — it always attempts to bind
 * first and lets the OS's own atomic `EADDRINUSE` be the sole arbiter of which of two
 * simultaneous starters actually wins; only a bind that's *rejected* ever triggers the
 * is-it-really-alive check, and only a confirmed-dead socket file is ever removed. */
function isAnotherWorkerAlreadyListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection(socketPath);
    probe.once('connect', () => {
      probe.end();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}

function tryListen(): Promise<'bound' | 'in-use'> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (error.code === 'EADDRINUSE') resolve('in-use');
      else reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve('bound');
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

async function start(): Promise<void> {
  if ((await tryListen()) === 'bound') {
    resetIdleTimer();
    return;
  }

  // EADDRINUSE — but Unix domain sockets raise that for *any* existing path, not only one with a
  // live listener, so this alone doesn't say which case it is. Ask directly.
  if (await isAnotherWorkerAlreadyListening()) {
    process.exit(0); // a healthy sibling already owns this socket — yield to it
  }

  // A stale socket file from a worker that didn't exit cleanly (e.g. a hard kill in a previous,
  // unrelated run) — confirmed dead by the check above, safe to remove and retry exactly once.
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Already gone.
  }
  if ((await tryListen()) === 'bound') {
    resetIdleTimer();
    return;
  }
  // Another process won the retry too — vanishingly unlikely, but yield rather than loop forever.
  process.exit(0);
}

start().catch((error) => {
  console.error(`pdf-worker: server error: ${normalizeError(error).message}`);
  process.exit(1);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});
process.on('SIGINT', () => {
  void shutdown(0);
});
