import { createApp, getSessionPool, getSessionStore, closeSessionPool } from '../src/app';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

/**
 * Reliability Checkpoint 2 regression coverage — proves `closeSessionPool()` actually tears down
 * the real `pg.Pool` behind the session store (app.ts), not merely that some mocked `.end()` was
 * invoked. Against the pre-checkpoint implementation — a bare `const sessionPool = new Pool(...)`
 * at module scope with no exported disposer at all — this file fails outright (no such export);
 * a disposer that existed but didn't actually end the pool would instead fail the final assertion
 * below, since the pool would still happily serve `SELECT 1` after "closing".
 *
 * Checkpoint 2A — also proves the `PGStore` half of the resource graph is actually disposed, not
 * just the pool. Run #88 demonstrated that closing only the pool leaves the store's own
 * self-rescheduling prune timer armed: it later fires, queries the now-ended pool, and logs
 * `"Cannot use a pool after calling end on the pool"` — after Jest considers the test done, which
 * is exactly the "Cannot log after tests are done" failure the run surfaced. `pruneTimer` and
 * `closed` are plain (non-private) fields on connect-pg-simple's `PGStore` (see
 * `node_modules/connect-pg-simple/index.js`), so they can be asserted on directly instead of
 * mocking `.close()` or waiting out the real ~15-minute prune interval.
 */

const PASSWORD = 'CorrectHorseBattery1!';

/**
 * `pruneTimer`/`closed` are real fields connect-pg-simple's `PGStore` sets on itself (see
 * `node_modules/connect-pg-simple/index.js`), but `@types/connect-pg-simple` doesn't declare
 * them — this narrows just those two for direct assertions below instead of reaching for `any`.
 */
type PGStoreLifecycleFields = { closed?: boolean; pruneTimer?: NodeJS.Timeout };

describe('Reliability Checkpoint 2 — session pool lifecycle', () => {
  afterAll(async () => {
    await cleanTestData();
  });

  it('closeSessionPool() shuts down the real pg.Pool backing the session store after it has genuinely been used', async () => {
    const app = createApp();
    const pool = getSessionPool();
    const store = getSessionStore() as unknown as PGStoreLifecycleFields;

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

    // Prove the store's prune timer is genuinely armed before disposal — connect-pg-simple only
    // schedules it (`#initPruneTimer`) the first time `get`/`set`/`destroy`/`touch` runs, so this
    // also confirms the login above really went through this exact store instance.
    expect(store.closed).not.toBe(true);
    expect(store.pruneTimer).toBeDefined();

    await closeSessionPool();

    // `pg.Pool` rejects any query issued after `.end()` resolves — the deterministic proof that
    // the underlying sockets/idle timers were actually released, the exact resource the
    // root-cause report identified as the Jest "did not exit" leak.
    await expect(pool.query('SELECT 1')).rejects.toThrow();

    // The store itself must be marked closed and its prune timer cleared — `PGStore#close()`
    // clears `pruneTimer` synchronously and sets `closed = true`, which also stops
    // `pruneSessions()` from re-arming a new timer even if one was mid-flight at close time. This
    // is what guarantees no delayed prune can ever reach the now-ended pool, without needing to
    // wait for the real interval to fire.
    expect(store.closed).toBe(true);
    expect(store.pruneTimer).toBeUndefined();

    // Must also be idempotent — tests/setup.ts's own global afterAll calls closeSessionPool()
    // again for every file, this one included, and that second call must not throw.
    await expect(closeSessionPool()).resolves.toBeUndefined();
  });
});
