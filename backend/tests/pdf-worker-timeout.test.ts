/**
 * Phase 7H — proves the PDF test worker client's own request-timeout mechanism deterministically,
 * without needing a real Puppeteer render to actually hang (slow, and not reliably reproducible on
 * demand). Stands a plain, deliberately unresponsive TCP server in for the worker — connectable
 * (so `ensureWorkerRunning()`'s fast path succeeds immediately, no real worker is ever spawned),
 * but it never writes a response — and points the client at it via `PDF_TEST_WORKER_SOCKET`, with
 * `PDF_TEST_WORKER_REQUEST_TIMEOUT_MS` set to a small value so the test runs in milliseconds. This
 * exercises the exact same timeout/reject code path a genuinely hung worker would trigger.
 *
 * Reliability Checkpoint 2D-C — `tests/setup.ts` (Jest `setupFilesAfterEnv`, loaded into this same
 * module registry ahead of this file's own body) statically imports `../src/app`, whose route
 * graph transitively imports `pdf-worker-client.ts` before the env vars below are ever set. A
 * plain `require()` at that point would just return that already-cached instance — bound to the
 * *default* socket/timeout, not this file's dedicated ones — which is how this test could end up
 * silently talking to a real, shared worker instead of the unresponsive mock below. `jest.
 * isolateModules` forces a genuinely fresh evaluation that reads the env vars set immediately
 * above, mirroring the established pattern in `pdf-worker-mode-selection.test.ts` /
 * `storage-provider-selection.test.ts`.
 */
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SOCKET_PATH = `/tmp/payroll-pdf-test-worker-timeout-${process.pid}.sock`;
const DEFAULT_SOCKET_PATH = path.join(os.tmpdir(), 'payroll-pdf-test-worker.sock');
process.env.PDF_TEST_WORKER_SOCKET = SOCKET_PATH;
process.env.PDF_TEST_WORKER_REQUEST_TIMEOUT_MS = '500';

let workerClient!: typeof import('../src/lib/pdf/worker/pdf-worker-client');
jest.isolateModules(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see file header
  workerClient = require('../src/lib/pdf/worker/pdf-worker-client') as typeof import('../src/lib/pdf/worker/pdf-worker-client');
});
const { renderViaTestWorker, __TEST_ONLY__ } = workerClient;

describe('PDF test worker client — request timeout (Phase 7H)', () => {
  let unresponsiveServer: net.Server;
  const openSockets = new Set<net.Socket>();
  let acceptedSocket: net.Socket | undefined;

  beforeAll(async () => {
    // Ownership guards — the rest of this test is only meaningful if the client actually resolved
    // *this* file's dedicated socket/timeout, not a stale cached instance bound to the shared
    // default worker every real-PDF suite in the run uses.
    expect(__TEST_ONLY__.SOCKET_PATH).toBe(SOCKET_PATH);
    expect(__TEST_ONLY__.SOCKET_PATH).not.toBe(DEFAULT_SOCKET_PATH);
    expect(__TEST_ONLY__.REQUEST_TIMEOUT_MS).toBe(500);

    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // Nothing to remove.
    }
    unresponsiveServer = net.createServer((socket) => {
      // Deliberately never writes anything back — simulates a wedged/hung worker. Tracked so
      // afterAll can force-close it: the client already destroyed its own end once its timeout
      // fired, but `server.close()`'s callback wouldn't otherwise reliably observe that in time.
      acceptedSocket = socket;
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
      socket.on('error', () => {});
    });
    await new Promise<void>((resolve) => unresponsiveServer.listen(SOCKET_PATH, resolve));
  });

  afterAll(async () => {
    for (const socket of openSockets) socket.destroy();
    await new Promise<void>((resolve) => unresponsiveServer.close(() => resolve()));
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // Already removed.
    }
  });

  it('rejects with a clear timeout error instead of hanging forever', async () => {
    const start = Date.now();
    await expect(renderViaTestWorker('<html></html>', {})).rejects.toThrow(/timed out/i);
    const elapsed = Date.now() - start;
    // Bounded — proves the configured timeout was actually honored, not some unrelated failure.
    expect(elapsed).toBeLessThan(5000);

    // Proves the client genuinely exercised this dedicated silent mock rather than resolving
    // against some other (real or shared) worker — `net.Socket`'s own byte counters, not sleeps.
    expect(acceptedSocket).toBeDefined(); // the dedicated mock accepted the connection
    expect(acceptedSocket!.bytesRead).toBeGreaterThan(0); // it received the request bytes
    expect(acceptedSocket!.bytesWritten).toBe(0); // and deliberately sent no response
  }, 10000);
});
