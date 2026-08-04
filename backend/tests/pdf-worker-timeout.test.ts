/**
 * Phase 7H — proves the PDF test worker client's own request-timeout mechanism deterministically,
 * without needing a real Puppeteer render to actually hang (slow, and not reliably reproducible on
 * demand). Stands a plain, deliberately unresponsive TCP server in for the worker — connectable
 * (so `ensureWorkerRunning()`'s fast path succeeds immediately, no real worker is ever spawned),
 * but it never writes a response — and points the client at it via `PDF_TEST_WORKER_SOCKET`, with
 * `PDF_TEST_WORKER_REQUEST_TIMEOUT_MS` set to a small value so the test runs in milliseconds. This
 * exercises the exact same timeout/reject code path a genuinely hung worker would trigger.
 */
import * as net from 'node:net';
import * as fs from 'node:fs';

const SOCKET_PATH = `/tmp/payroll-pdf-test-worker-timeout-${process.pid}.sock`;
process.env.PDF_TEST_WORKER_SOCKET = SOCKET_PATH;
process.env.PDF_TEST_WORKER_REQUEST_TIMEOUT_MS = '500';

// See pdf-worker-infrastructure.test.ts's identical comment — `require()`, not a top-level
// `import`, so the env vars above are set before the client module reads them.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
const { renderViaTestWorker } = require('../src/lib/pdf/worker/pdf-worker-client') as typeof import('../src/lib/pdf/worker/pdf-worker-client');

describe('PDF test worker client — request timeout (Phase 7H)', () => {
  let unresponsiveServer: net.Server;
  const openSockets = new Set<net.Socket>();

  beforeAll(async () => {
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {
      // Nothing to remove.
    }
    unresponsiveServer = net.createServer((socket) => {
      // Deliberately never writes anything back — simulates a wedged/hung worker. Tracked so
      // afterAll can force-close it: the client already destroyed its own end once its timeout
      // fired, but `server.close()`'s callback wouldn't otherwise reliably observe that in time.
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
  }, 10000);
});
