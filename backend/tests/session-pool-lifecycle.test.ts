import { createApp, getSessionPool, closeSessionPool } from '../src/app';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Reliability Checkpoint 2 regression coverage — proves `closeSessionPool()` actually tears down
 * the real `pg.Pool` behind the session store (app.ts), not merely that some mocked `.end()` was
 * invoked. Against the pre-checkpoint implementation — a bare `const sessionPool = new Pool(...)`
 * at module scope with no exported disposer at all — this file fails outright (no such export);
 * a disposer that existed but didn't actually end the pool would instead fail the final assertion
 * below, since the pool would still happily serve `SELECT 1` after "closing".
 */

const PASSWORD = 'CorrectHorseBattery1!';

describe('Reliability Checkpoint 2 — session pool lifecycle', () => {
  afterAll(async () => {
    await cleanTestData();
  });

  it('closeSessionPool() shuts down the real pg.Pool backing the session store after it has genuinely been used', async () => {
    const app = createApp();
    const pool = getSessionPool();

    // Exercise a real session operation — login regenerates + writes req.session.userId
    // (auth.routes.ts), which `connect-pg-simple` persists through exactly this pool (app.ts), so
    // this is a genuine Postgres round trip through the resource under test, not a mock.
    await createAuthenticatedAgent(app, {
      email: 'session-pool-lifecycle@test.local',
      password: PASSWORD,
      roleCode: 'TEST_SESSION_POOL_LIFECYCLE',
    });

    // Prove the pool was actually live before closing it, so a false pass (a pool that was never
    // really connected in the first place) can't slip through.
    await expect(pool.query('SELECT 1')).resolves.toBeDefined();

    await closeSessionPool();

    // `pg.Pool` rejects any query issued after `.end()` resolves — the deterministic proof that
    // the underlying sockets/idle timers were actually released, the exact resource the
    // root-cause report identified as the Jest "did not exit" leak.
    await expect(pool.query('SELECT 1')).rejects.toThrow();

    // Must also be idempotent — tests/setup.ts's own global afterAll calls closeSessionPool()
    // again for every file, this one included, and that second call must not throw.
    await expect(closeSessionPool()).resolves.toBeUndefined();
  });
});
