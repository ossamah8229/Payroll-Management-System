import { test, expect } from '../fixtures/auth';
import { apiGet, apiPost } from '../helpers/api';
import { createSiteWithEmployee } from '../helpers/fixtures';

/**
 * Backup Package generation has no frontend UI (Phase 5 Checkpoint 2's own approved scope —
 * `docs/PROJECT_PROGRESS.md`) — this spec is API-driven throughout, exactly matching how a real
 * client of this feature (today: none; the API exists ahead of a future UI) would use it.
 *
 * **Scope boundary, explicitly documented per this checkpoint's own instruction:** AUD-011's
 * crash-recovery path (a `BackupPackage` left `GENERATING` by a killed process, recovered on the
 * next startup or reservation) is *not* re-tested here — killing and restarting the real backend
 * process mid-suite would make this harness's own process lifecycle unstable. That path already
 * has dedicated, real-stack coverage in `backend/tests/backup-packages.test.ts`'s
 * `AUD-011: stale GENERATING recovery` block (added Post-Phase-5 Stabilization Checkpoint 3),
 * which starts and kills the real compiled server exactly the same way this harness's own
 * `tests/e2e/setup/e2e-environment.ts` does, just without needing a live browser attached.
 */
test.describe('Backup Package generation smoke', () => {
  test('generation reaches READY through the real stack, and the response never leaks a storage key', async ({
    authenticatedPage: page,
  }) => {
    const context = page.context();

    let cycleId: string;
    const existingCycles = await apiGet<{ cycles: { id: string; status: string }[] }>(
      context,
      '/api/v1/payroll-cycles',
    );
    const usable = existingCycles.body.cycles.find((c) => c.status === 'RELEASED' || c.status === 'ARCHIVED');

    if (usable) {
      cycleId = usable.id;
    } else {
      // Standalone-run fallback — bootstrap, release, and finalize a fresh cycle of our own.
      const fixture = await createSiteWithEmployee(context, `backup-${Date.now()}`);
      const created = await apiPost<{ cycle: { id: string } }>(context, '/api/v1/payroll-cycles', {
        year: 2900,
        month: 1,
      });
      await apiPost(context, `/api/v1/payroll-cycles/${created.cycle.id}/units/${fixture.unitId}/release`, {});
      await apiPost(context, `/api/v1/payroll-cycles/${created.cycle.id}/finalize`, {});
      cycleId = created.cycle.id;
    }

    const generated = await apiPost<{ backupPackage: { id: string; status: string; version: number } }>(
      context,
      `/api/v1/payroll-cycles/${cycleId}/backup-packages`,
      {},
    );
    expect(generated.backupPackage.status).toBe('READY');

    const detail = await apiGet<{ backupPackage: Record<string, unknown> }>(
      context,
      `/api/v1/backup-packages/${generated.backupPackage.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.backupPackage.status).toBe('READY');

    const serialized = JSON.stringify(detail.body);
    expect(serialized).not.toContain('storageKey');

    const list = await apiGet<{ backupPackages: { id: string }[] }>(
      context,
      `/api/v1/payroll-cycles/${cycleId}/backup-packages`,
    );
    expect(list.status).toBe(200);
    expect(list.body.backupPackages.some((p) => p.id === generated.backupPackage.id)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('storageKey');
  });
});
