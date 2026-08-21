/**
 * Phase 7H — infrastructure tests for the PDF test worker itself
 * (`src/lib/pdf/worker/pdf-worker-client.ts`, `pdf-worker.entry.ts`), not the PDF rendering it
 * performs — that's already covered end-to-end, with real content assertions, by
 * `payslips.test.ts`/`statements.test.ts`/`payroll-hold-workflow.test.ts`, all of which render
 * real PDFs through this exact worker. This file proves the worker's own lifecycle guarantees:
 * a successful render, discard-and-relaunch, a crashed worker being reported clearly (not just
 * silently reconnecting), and no process surviving an explicit shutdown.
 *
 * Uses its own dedicated socket path (`PDF_TEST_WORKER_SOCKET`, set before the client module is
 * ever imported — the socket path is read once at module load) so this file's worker is never the
 * same process every other real-PDF suite shares in a full run; this file specifically needs to
 * kill its own worker without disrupting anyone else's.
 *
 * Reliability Checkpoint 2D-C — `tests/setup.ts` (Jest `setupFilesAfterEnv`, loaded into this same
 * module registry ahead of this file's own body) statically imports `../src/app`, whose route
 * graph transitively imports `pdf-worker-client.ts` before the env var below is ever set. A plain
 * `require()` at that point — even one written after the assignment, as this file previously did —
 * would just return that already-cached instance, bound to the *default* socket rather than this
 * file's dedicated one, which is exactly the scenario this file's crash/SIGKILL tests must not
 * risk. `jest.isolateModules` forces a genuinely fresh evaluation that reads the env var set
 * immediately below, mirroring the established pattern in `pdf-worker-mode-selection.test.ts` /
 * `storage-provider-selection.test.ts`.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const SOCKET_PATH = `/tmp/payroll-pdf-test-worker-infra-${process.pid}.sock`;
const DEFAULT_SOCKET_PATH = path.join(os.tmpdir(), 'payroll-pdf-test-worker.sock');
process.env.PDF_TEST_WORKER_SOCKET = SOCKET_PATH;

let workerClient!: typeof import('../src/lib/pdf/worker/pdf-worker-client');
jest.isolateModules(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see file header
  workerClient = require('../src/lib/pdf/worker/pdf-worker-client') as typeof import('../src/lib/pdf/worker/pdf-worker-client');
});
const { discardTestWorkerBrowser, renderViaTestWorker, shutdownTestWorker, __TEST_ONLY__ } = workerClient;

jest.setTimeout(45000);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls instead of a fixed sleep — a fixed, short wait is exactly the kind of host-speed-
 * dependent assumption this whole checkpoint exists to eliminate from the PDF suites themselves;
 * this file's own tests should not reintroduce it. */
async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function readWorkerPid(): number | undefined {
  try {
    const pid = Number(fs.readFileSync(__TEST_ONLY__.PID_PATH, 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

describe('PDF test worker infrastructure (Phase 7H)', () => {
  afterAll(async () => {
    await shutdownTestWorker();
  });

  it('renders a real PDF through the worker (spawns it on first use)', async () => {
    const buffer = await renderViaTestWorker('<html><body><h1>Infra test</h1></body></html>', {});
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('discards and relaunches the browser, and still renders correctly afterward', async () => {
    await discardTestWorkerBrowser();
    const buffer = await renderViaTestWorker('<html><body>after discard</body></html>', {});
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('records exit code/signal when the worker crashes, and self-heals on the next render', async () => {
    await renderViaTestWorker('<html></html>', {}); // ensure a worker is actually running

    // Ownership guards (Reliability Checkpoint 2D-C) — this test kills a process by pid; before
    // doing so, prove that pid can only belong to *this file's* dedicated worker, never the
    // shared/default one every other real-PDF suite in the run uses.
    expect(__TEST_ONLY__.SOCKET_PATH).toBe(SOCKET_PATH);
    expect(__TEST_ONLY__.SOCKET_PATH).not.toBe(DEFAULT_SOCKET_PATH);
    expect(__TEST_ONLY__.PID_PATH).toBe(`${SOCKET_PATH}.pid`); // pid path derives from this socket
    expect(fs.existsSync(SOCKET_PATH)).toBe(true); // this file's own worker is actually listening

    const pid = readWorkerPid();
    expect(pid).toBeDefined();

    // Negative pid — the whole process group (worker + its own Chrome, spawned without its own
    // `detached`, so it inherits the worker's group). A container/CI OOM killer typically kills a
    // whole cgroup, not one hand-picked process, and a single-process kill here would just leak
    // Chrome as an unreachable orphan (SIGKILL gives the worker no chance to run closeBrowser()) —
    // confirmed directly, this test used to leave exactly that behind before this was fixed.
    process.kill(-pid!, 'SIGKILL'); // simulate an external crash (e.g. OOM kill)
    await waitUntil(() => fs.existsSync(__TEST_ONLY__.CRASH_PATH), 5000); // let the child's own 'exit' event land

    // Observability (Phase 7H requirement): the crash's signal is recorded, not silently dropped —
    // `pdf-worker-timeout.test.ts` separately proves this record actually reaches a caller-visible
    // error message when a request is in flight at the moment of a crash.
    const crashRecord = JSON.parse(fs.readFileSync(__TEST_ONLY__.CRASH_PATH, 'utf8')) as { signal: string | null };
    expect(crashRecord.signal).toBe('SIGKILL');

    // Self-healing: ensureWorkerRunning() finds the dead socket unconnectable and transparently
    // respawns before this request is ever sent — no visible failure for an ordinary caller.
    const buffer = await renderViaTestWorker('<html>recovered</html>', {});
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('yields immediately rather than stealing the socket when a worker is already listening', async () => {
    // Confirmed directly, under Phase 7H's own repeated full-backend-suite stress runs, to matter:
    // the client's own connect-then-spawn check can false-negative under load, so two workers can
    // end up racing to spawn at the same socket path. Bypasses the client entirely here — spawns
    // two raw worker processes directly, pointed at one fresh, dedicated socket, to prove the
    // *worker's own* defense (not the client's spawn lock, already exercised by every other test
    // in this file).
    const dupSocketPath = `/tmp/payroll-pdf-worker-dup-spawn-${process.pid}.sock`;
    const entry = path.join(__dirname, '..', 'src', 'lib', 'pdf', 'worker', 'pdf-worker.entry.ts');
    const spawnRaw = () =>
      spawn(process.execPath, ['--import', 'tsx', entry, dupSocketPath], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });

    // Which of the two actually wins the OS-level bind race is inherently unpredictable — JS-side
    // call order says nothing about which child process's `bind()` syscall the OS schedules first.
    // Only the outcome is deterministic: exactly one survives.
    const first = spawnRaw();
    const second = spawnRaw();

    try {
      await waitUntil(() => !isAlive(first.pid!) || !isAlive(second.pid!), 10000);

      const firstAlive = isAlive(first.pid!);
      const secondAlive = isAlive(second.pid!);
      expect(firstAlive !== secondAlive).toBe(true); // exactly one survives, never both, never neither

      // The survivor must actually be serving the socket, not merely still running.
      const socket = net.createConnection(dupSocketPath);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
    } finally {
      // Group-kill (see the crash-simulation test's identical comment) — harmless for whichever of
      // the two never launched Chrome, but consistent regardless of which one that turned out to be.
      if (isAlive(first.pid!)) process.kill(-first.pid!, 'SIGKILL');
      if (isAlive(second.pid!)) process.kill(-second.pid!, 'SIGKILL');
      try {
        fs.unlinkSync(dupSocketPath);
      } catch {
        // Already removed by the worker's own exit.
      }
    }
  }, 15000);

  it('leaves no worker process alive after shutdown', async () => {
    await renderViaTestWorker('<html></html>', {}); // ensure a worker is running
    const pid = readWorkerPid();
    expect(pid).toBeDefined();

    await shutdownTestWorker();
    await waitUntil(() => !isAlive(pid!), 5000);

    expect(isAlive(pid!)).toBe(false);
    expect(fs.existsSync(SOCKET_PATH)).toBe(false);
  });
});
