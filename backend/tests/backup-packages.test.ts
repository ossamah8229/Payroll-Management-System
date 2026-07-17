import { createHash } from 'crypto';
import fs from 'fs';
import request from 'supertest';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { storageProvider, resolveStorageRoot } from '../src/lib/storage';
import * as payrollEntryExportService from '../src/modules/payroll-entry/payroll-entry-import-export.service';
import { recoverStaleGeneratingBackupPackages } from '../src/modules/backup-packages/backup-packages.service';
import { cleanTestData, createAuthenticatedAgent, extractCookie } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

/** supertest/superagent only auto-buffers `res.body` for content-types it recognizes as binary —
 * matches every other export/PDF test file's own locally-duplicated `binaryParser`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function binaryParser(res: any, callback: (err: Error | null, body: unknown) => void) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk: string) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('Phase 5 Checkpoint 2 — Backup Packages', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
    // This checkpoint is the StorageProvider singleton's first real consumer — its own generated
    // content lives under the test-only storage root (backend/tests/env.setup.ts's STORAGE_ROOT
    // fallback, gitignored as backend/storage-test-unused/). Removed wholesale here so no test
    // artifact survives a run; nothing else in this test process legitimately writes real content
    // there (every other test file's own import of src/app.ts only constructs the empty root
    // directory as a side effect, never writes into it).
    await fs.promises.rm(resolveStorageRoot(), { recursive: true, force: true });
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY, PERMISSIONS.PAYROLL_RELEASE],
    });
  }

  async function payrollStaffAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: [PERMISSIONS.PAYROLL_ENTRY],
      siteIds,
    });
  }

  async function financeAgent(email: string, siteIds: string[]) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.FINANCE,
      permissionKeys: [PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_RELEASE, PERMISSIONS.BANK_SHEETS_VIEW],
      siteIds,
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return { site, unit };
  }

  async function makeBank(code: string, name: string) {
    return prisma.bank.create({ data: { code, name, isActive: true } });
  }

  async function makeEmployee(
    siteId: string,
    unitId: string,
    name: string,
    options: { bankId?: string; accountNumber?: string; grossPay?: string } = {},
  ) {
    return prisma.employee.create({
      data: {
        name,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: options.grossPay ?? '30000',
        bankId: options.bankId,
        accountNumber: options.accountNumber,
      },
    });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number, year = 2900) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year, month });
    if (res.status !== 201) throw new Error(`cycle create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; year: number; month: number; status: string };
  }

  async function createEntry(
    admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>,
    cycleId: string,
    employeeId: string,
  ) {
    // createPayrollCycle's own bootstrap already seeds an entry for every active employee that
    // existed at cycle-creation time — makeReadyCycle creates its employees before the cycle, so
    // an entry already exists here; fetch it rather than attempting a duplicate POST (409).
    const existing = await admin.agent.get(
      `/api/v1/payroll-cycles/${cycleId}/entries?employeeId=${employeeId}`,
    );
    if (existing.status === 200 && existing.body.entries?.length > 0) {
      return existing.body.entries[0] as { id: string; version: number };
    }

    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/entries`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ employeeId });
    if (res.status !== 201) throw new Error(`entry create failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number };
  }

  async function releaseUnit(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string, unitId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/units/${unitId}/release`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 201) throw new Error(`release failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  async function holdEntry(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, entryId: string, version: number) {
    const res = await admin.agent
      .patch(`/api/v1/payroll-entries/${entryId}`)
      .set('x-csrf-token', admin.csrfToken)
      .send({ version, hold: true });
    if (res.status !== 200) throw new Error(`hold failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.entry as { id: string; version: number };
  }

  async function finalizeCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, cycleId: string) {
    const res = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/finalize`)
      .set('x-csrf-token', admin.csrfToken)
      .send({});
    if (res.status !== 200) throw new Error(`finalize failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.cycle as { id: string; status: string };
  }

  async function generateBackup(agent: { agent: ReturnType<typeof request.agent>; csrfToken: string }, cycleId: string) {
    return agent.agent
      .post(`/api/v1/payroll-cycles/${cycleId}/backup-packages`)
      .set('x-csrf-token', agent.csrfToken)
      .send({});
  }

  /** Standard fixture: one Bank (+ implicit Cash), one released bank-account employee, one held
   * cash employee — enough to exercise every one of the five generated files with genuinely
   * non-empty content, then finalized so the cycle is eligible for backup generation. */
  async function makeReadyCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number, year = 2900) {
    const { site, unit } = await makeSiteWithUnit(`Test Site Backup ${year}-${month}`);
    const bank = await makeBank(`TBK${year}${month}`.slice(0, 10), `Test Backup Bank ${year}-${month}`);
    const bankedEmployee = await makeEmployee(site.id, unit.id, `Backup Banked Employee ${year}-${month}`, {
      bankId: bank.id,
      accountNumber: '1234567890',
    });
    const cashEmployee = await makeEmployee(site.id, unit.id, `Backup Cash Employee ${year}-${month}`);
    const cycle = await makeDraftCycle(admin, month, year);
    const bankedEntry = await createEntry(admin, cycle.id, bankedEmployee.id);
    const cashEntry = await createEntry(admin, cycle.id, cashEmployee.id);
    await holdEntry(admin, cashEntry.id, cashEntry.version);
    await releaseUnit(admin, cycle.id, unit.id);
    const finalized = await finalizeCycle(admin, cycle.id);
    return { site, unit, bank, bankedEmployee, cashEmployee, bankedEntry, cashEntry, cycle: finalized };
  }

  // --- Generation: precondition ------------------------------------------------------------------

  it('rejects generating a Backup Package for a Draft cycle', async () => {
    const admin = await masterAdminAgent('backup-draft-admin@test.local');
    const cycle = await makeDraftCycle(admin, 1);

    const res = await generateBackup(admin, cycle.id);
    expect(res.status).toBe(400);

    const count = await prisma.backupPackage.count({ where: { cycleId: cycle.id } });
    expect(count).toBe(0);
  });

  it('returns a generic 404 for a nonexistent cycle', async () => {
    const admin = await masterAdminAgent('backup-notfound-admin@test.local');
    const res = await generateBackup(admin, '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('succeeds generating a Backup Package for a Released cycle', async () => {
    const admin = await masterAdminAgent('backup-released-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 2);

    const res = await generateBackup(admin, cycle.id);
    expect(res.status).toBe(201);
    expect(res.body.backupPackage.status).toBe('READY');
    expect(res.body.backupPackage.version).toBe(1);
    expect(res.body.backupPackage.cycleId).toBe(cycle.id);
    expect(res.body.backupPackage.fileCount).toBe(5);
    expect(res.body.backupPackage.files).toHaveLength(5);
    // BigInt fields must be JSON-safe strings on the wire.
    expect(typeof res.body.backupPackage.totalSizeBytes).toBe('string');
    expect(Number(res.body.backupPackage.totalSizeBytes)).toBeGreaterThan(0);
  });

  // --- Generation: versioning ----------------------------------------------------------------------

  it('increments the version on each subsequent generation for the same cycle', async () => {
    const admin = await masterAdminAgent('backup-version-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 3);

    const first = await generateBackup(admin, cycle.id);
    expect(first.status).toBe(201);
    expect(first.body.backupPackage.version).toBe(1);

    const second = await generateBackup(admin, cycle.id);
    expect(second.status).toBe(201);
    expect(second.body.backupPackage.version).toBe(2);

    const versions = await prisma.backupPackage.findMany({ where: { cycleId: cycle.id }, select: { version: true } });
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it('creating version 2 never overwrites, mutates, or deletes version 1\'s database rows or storage objects', async () => {
    const admin = await masterAdminAgent('backup-v2-immutable-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 4);

    const v1Res = await generateBackup(admin, cycle.id);
    expect(v1Res.status).toBe(201);
    const v1Before = await prisma.backupPackage.findUniqueOrThrow({
      where: { id: v1Res.body.backupPackage.id },
      include: { files: { orderBy: { sortOrder: 'asc' } } },
    });
    const v1FileContents = await Promise.all(
      v1Before.files.map(async (file) => ({ file, buffer: await storageProvider.read(file.storageKey) })),
    );

    const v2Res = await generateBackup(admin, cycle.id);
    expect(v2Res.status).toBe(201);
    expect(v2Res.body.backupPackage.version).toBe(2);

    const v1After = await prisma.backupPackage.findUniqueOrThrow({
      where: { id: v1Res.body.backupPackage.id },
      include: { files: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(v1After).toEqual(v1Before);

    for (const { file, buffer } of v1FileContents) {
      expect(await storageProvider.exists(file.storageKey)).toBe(true);
      expect((await storageProvider.read(file.storageKey)).equals(buffer)).toBe(true);
      expect(sha256Hex(await storageProvider.read(file.storageKey))).toBe(file.checksum);
    }

    // v2's own files live under a completely separate key prefix — no overlap with v1's keys.
    const v2Files = await prisma.backupPackageFile.findMany({ where: { backupPackageId: v2Res.body.backupPackage.id } });
    const v1Keys = new Set(v1Before.files.map((f) => f.storageKey));
    for (const file of v2Files) {
      expect(v1Keys.has(file.storageKey)).toBe(false);
    }
  });

  it('reserves versions safely under a true concurrent-generation race (direct service call)', async () => {
    const admin = await masterAdminAgent('backup-race-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 4);

    const { generateBackupPackage } = await import('../src/modules/backup-packages/backup-packages.service');
    const sessionUser = { id: (await prisma.user.findUniqueOrThrow({ where: { email: 'backup-race-admin@test.local' } })).id, name: 'Race Admin' } as Parameters<typeof generateBackupPackage>[0];
    const requestMeta = { ipAddress: null, userAgent: null };

    const results = await Promise.allSettled([
      generateBackupPackage(sessionUser, cycle.id, requestMeta),
      generateBackupPackage(sessionUser, cycle.id, requestMeta),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ version: number }>[];
    const rejected = results.filter((r) => r.status === 'rejected');
    // Either both succeed with distinct versions, or one succeeds and the other loses the
    // reservation race with a clean, typed conflict — never two successes with the same version,
    // never an unhandled crash.
    expect(fulfilled.length + rejected.length).toBe(2);
    const versions = fulfilled.map((r) => r.value.version);
    expect(new Set(versions).size).toBe(versions.length);

    const rows = await prisma.backupPackage.findMany({ where: { cycleId: cycle.id }, select: { version: true } });
    const rowVersions = rows.map((r) => r.version);
    expect(new Set(rowVersions).size).toBe(rowVersions.length);
  });

  it('rejects an HTTP-level concurrent generation race cleanly — no duplicate version, no crash', async () => {
    const admin = await masterAdminAgent('backup-race-http-admin@test.local');
    const rival = await masterAdminAgent('backup-race-http-rival@test.local');
    const { cycle } = await makeReadyCycle(admin, 5);

    const [first, second] = await Promise.all([generateBackup(admin, cycle.id), generateBackup(rival, cycle.id)]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses[1]).toBe(201);
    expect([201, 409]).toContain(statuses[0]);

    const rows = await prisma.backupPackage.findMany({ where: { cycleId: cycle.id }, select: { version: true } });
    const versions = rows.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  // --- Generation: deterministic ordering, manifest, checksums --------------------------------------

  it('builds files in the deterministic order manifest.json, payroll-entry.csv, payroll-entry.xlsx, bank-sheets.csv, cash-receiving.csv', async () => {
    const admin = await masterAdminAgent('backup-order-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 6);

    const res = await generateBackup(admin, cycle.id);
    expect(res.status).toBe(201);

    const files = res.body.backupPackage.files as { fileType: string; filename: string; sortOrder: number }[];
    expect(files.map((f) => f.filename)).toEqual([
      'manifest.json',
      'payroll-entry.csv',
      'payroll-entry.xlsx',
      'bank-sheets.csv',
      'cash-receiving.csv',
    ]);
    expect(files.map((f) => f.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(files.map((f) => f.fileType)).toEqual([
      'MANIFEST',
      'PAYROLL_ENTRY_CSV',
      'PAYROLL_ENTRY_XLSX',
      'BANK_SHEETS_CSV',
      'CASH_RECEIVING_CSV',
    ]);
  });

  it('produces a manifest whose contents, checksums, and sizes match every stored file exactly', async () => {
    const admin = await masterAdminAgent('backup-manifest-admin@test.local');
    const { cycle, bankedEmployee, cashEmployee } = await makeReadyCycle(admin, 7);

    const res = await generateBackup(admin, cycle.id);
    expect(res.status).toBe(201);
    const backupPackageId = res.body.backupPackage.id as string;

    const files = await prisma.backupPackageFile.findMany({
      where: { backupPackageId },
      orderBy: { sortOrder: 'asc' },
    });
    const manifestRow = files.find((f) => f.fileType === 'MANIFEST')!;
    const manifestBuffer = await storageProvider.read(manifestRow.storageKey);
    const manifest = JSON.parse(manifestBuffer.toString('utf-8'));

    expect(manifest.packageVersion).toBe(1);
    expect(manifest.cycle.id).toBe(cycle.id);
    expect(manifest.releaseStatusSummary).toEqual({ entryCount: 2, releasedCount: 1, heldCount: 1 });
    expect(manifest.files).toHaveLength(4); // manifest never lists itself

    for (const dataFile of files.filter((f) => f.fileType !== 'MANIFEST')) {
      const manifestEntry = manifest.files.find((f: { filename: string }) => f.filename === dataFile.filename);
      expect(manifestEntry).toBeDefined();
      expect(manifestEntry.checksum).toBe(dataFile.checksum);
      expect(manifestEntry.sizeBytes).toBe(Number(dataFile.sizeBytes));

      // SHA-256 validation: the DB row's own checksum matches the actual stored bytes.
      const storedBuffer = await storageProvider.read(dataFile.storageKey);
      expect(sha256Hex(storedBuffer)).toBe(dataFile.checksum);
      expect(storedBuffer.length).toBe(Number(dataFile.sizeBytes));
    }

    // Manifest checksum itself is verifiable against its own stored bytes.
    const pkg = await prisma.backupPackage.findUniqueOrThrow({ where: { id: backupPackageId } });
    expect(pkg.manifestChecksum).toBe(sha256Hex(manifestBuffer));

    // Total size calculation: package-level total equals the sum of every file (including the
    // manifest itself).
    const expectedTotal = files.reduce((sum, f) => sum + f.sizeBytes, 0n);
    expect(pkg.totalSizeBytes).toBe(expectedTotal);

    // Sanity: both employees' identity appears somewhere in the generated payroll CSV content.
    const payrollCsvRow = files.find((f) => f.fileType === 'PAYROLL_ENTRY_CSV')!;
    const payrollCsvContent = (await storageProvider.read(payrollCsvRow.storageKey)).toString('utf-8');
    expect(payrollCsvContent).toContain(bankedEmployee.name);
    expect(payrollCsvContent).toContain(cashEmployee.name);
  });

  it('manifestChecksum is computed non-circularly: the manifest file never references its own checksum, and the stored checksum is exactly SHA-256 of the manifest\'s own stored bytes', async () => {
    const admin = await masterAdminAgent('backup-manifest-circularity-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 5);

    const res = await generateBackup(admin, cycle.id);
    expect(res.status).toBe(201);

    const manifestRow = await prisma.backupPackageFile.findFirstOrThrow({
      where: { backupPackageId: res.body.backupPackage.id, fileType: 'MANIFEST' },
    });
    const manifestBuffer = await storageProvider.read(manifestRow.storageKey);
    const manifestText = manifestBuffer.toString('utf-8');
    const manifest = JSON.parse(manifestText);

    // The canonical representation that gets hashed is the manifest payload's own serialized
    // bytes — nothing inside that payload references the hash of itself. Asserted two ways: the
    // key is structurally absent from the parsed object, and the raw text never contains the
    // stored checksum's own hex value (which would only be possible if the checksum had been
    // embedded before hashing, the exact circularity this design avoids).
    expect(manifest).not.toHaveProperty('manifestChecksum');
    expect(manifest).not.toHaveProperty('checksum');
    expect(Object.keys(manifest).some((key) => key.toLowerCase().includes('checksum'))).toBe(false);

    const pkg = await prisma.backupPackage.findUniqueOrThrow({ where: { id: res.body.backupPackage.id } });
    expect(pkg.manifestChecksum).not.toBeNull();
    expect(manifestText).not.toContain(pkg.manifestChecksum!);

    // The stored checksum is exactly SHA-256 of exactly what's on disk — recomputing it
    // independently here (not reusing any of the service's own helper functions) must match.
    expect(sha256Hex(manifestBuffer)).toBe(pkg.manifestChecksum);

    // Re-serializing the parsed manifest with sorted keys reproduces byte-identical content,
    // confirming the stored bytes already are the canonical (key-sorted) form the checksum is
    // computed over — not some other representation that would make the checksum ambiguous.
    function canonical(value: unknown): string {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value as Record<string, unknown>).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
      }
      return JSON.stringify(value);
    }
    expect(JSON.parse(canonical(manifest))).toEqual(manifest);
  });

  // --- Generation: reuse parity with live exporters, no duplicate calculation path ------------------

  it('the backup Payroll Entry CSV is byte-identical to the live Payroll Entry export', async () => {
    const admin = await masterAdminAgent('backup-parity-payroll-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 8);

    const backupRes = await generateBackup(admin, cycle.id);
    const files = await prisma.backupPackageFile.findMany({ where: { backupPackageId: backupRes.body.backupPackage.id } });
    const payrollCsvRow = files.find((f) => f.fileType === 'PAYROLL_ENTRY_CSV')!;
    const backupBuffer = await storageProvider.read(payrollCsvRow.storageKey);

    const liveRes = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`)
      .buffer(true)
      .parse(binaryParser);
    expect(liveRes.status).toBe(200);

    expect(backupBuffer.equals(liveRes.body as Buffer)).toBe(true);
  });

  it('the backup Cash Receiving CSV rows are byte-identical to the live Cash Receiving export (generated-at excluded)', async () => {
    const admin = await masterAdminAgent('backup-parity-cash-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 9);

    const backupRes = await generateBackup(admin, cycle.id);
    const files = await prisma.backupPackageFile.findMany({ where: { backupPackageId: backupRes.body.backupPackage.id } });
    const cashCsvRow = files.find((f) => f.fileType === 'CASH_RECEIVING_CSV')!;
    const backupContent = (await storageProvider.read(cashCsvRow.storageKey)).toString('utf-8');

    const liveRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/cash-receiving/export?format=csv`);
    expect(liveRes.status).toBe(200);

    // The header/footer lines embed a live "Generated On" timestamp that legitimately differs
    // between the two calls — every other line (company name, sheet title, column headers, data
    // rows, total, employee count) must match exactly, proving the same builder produced both.
    const stripGeneratedOn = (text: string) => text.replace(/Generated On: [^\n,]+/g, 'Generated On: <redacted>');
    expect(stripGeneratedOn(backupContent)).toBe(stripGeneratedOn(liveRes.text));
  });

  it('the combined Bank Sheets CSV contains exactly the same row for a given bank as that bank\'s own live single-bank export, reusing getBankSheet rather than a second query path', async () => {
    const admin = await masterAdminAgent('backup-parity-bank-admin@test.local');
    const { cycle, bank } = await makeReadyCycle(admin, 10);

    const backupRes = await generateBackup(admin, cycle.id);
    const files = await prisma.backupPackageFile.findMany({ where: { backupPackageId: backupRes.body.backupPackage.id } });
    const bankSheetsRow = files.find((f) => f.fileType === 'BANK_SHEETS_CSV')!;
    const combinedContent = (await storageProvider.read(bankSheetsRow.storageKey)).toString('utf-8');

    const liveRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/bank-sheet/export?bankId=${bank.id}&format=csv`);
    expect(liveRes.status).toBe(200);
    const liveDataLine = liveRes.text.split('\n')[1]!.trim(); // header, then this bank's one data row

    expect(combinedContent).toContain(liveDataLine);
  });

  it('bank-sheets.csv is one of the five package files, listed in the manifest, at sortOrder 3, with a checksum and size matching its actual stored bytes', async () => {
    const admin = await masterAdminAgent('backup-banksheets-explicit-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 11);

    const res = await generateBackup(admin, cycle.id);
    expect(res.status).toBe(201);

    const bankSheetsFile = res.body.backupPackage.files.find(
      (f: { fileType: string }) => f.fileType === 'BANK_SHEETS_CSV',
    );
    expect(bankSheetsFile).toBeDefined();
    expect(bankSheetsFile.filename).toBe('bank-sheets.csv');
    expect(bankSheetsFile.sortOrder).toBe(3);

    const dbRow = await prisma.backupPackageFile.findUniqueOrThrow({ where: { id: bankSheetsFile.id } });
    const storedBytes = await storageProvider.read(dbRow.storageKey);
    expect(sha256Hex(storedBytes)).toBe(dbRow.checksum);
    expect(storedBytes.length).toBe(Number(dbRow.sizeBytes));

    const manifestRow = await prisma.backupPackageFile.findFirstOrThrow({
      where: { backupPackageId: res.body.backupPackage.id, fileType: 'MANIFEST' },
    });
    const manifest = JSON.parse((await storageProvider.read(manifestRow.storageKey)).toString('utf-8'));
    const manifestEntry = manifest.files.find((f: { filename: string }) => f.filename === 'bank-sheets.csv');
    expect(manifestEntry).toBeDefined();
    expect(manifestEntry.checksum).toBe(dbRow.checksum);
    expect(manifestEntry.sizeBytes).toBe(Number(dbRow.sizeBytes));
  });

  // --- Storage ---------------------------------------------------------------------------------------

  it('writes every file under the expected backups/{cycleId}/v{version}/ storage key prefix', async () => {
    const admin = await masterAdminAgent('backup-keys-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 11);

    const res = await generateBackup(admin, cycle.id);
    const files = await prisma.backupPackageFile.findMany({ where: { backupPackageId: res.body.backupPackage.id } });

    const expectedPrefix = `backups/${cycle.id}/v1/`;
    for (const file of files) {
      expect(file.storageKey.startsWith(expectedPrefix)).toBe(true);
      expect(await storageProvider.exists(file.storageKey)).toBe(true);
    }
  });

  it('never exposes storageKey or an absolute filesystem path in list or detail responses', async () => {
    const admin = await masterAdminAgent('backup-storagekey-leak-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 12);

    const genRes = await generateBackup(admin, cycle.id);
    expect(genRes.status).toBe(201);

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    const detailRes = await admin.agent.get(`/api/v1/backup-packages/${genRes.body.backupPackage.id}`);

    for (const responseBody of [genRes.body, listRes.body.backupPackages[0], detailRes.body]) {
      const pkg = responseBody.backupPackage ?? responseBody;
      const serialized = JSON.stringify(pkg);
      expect(serialized).not.toContain('storageKey');
      // No absolute filesystem path (the resolved storage root, e.g. "/private/tmp/..." or
      // "/Users/...") ever appears in any response body — only relative, application-level keys
      // exist internally, and even those are stripped above.
      expect(serialized).not.toMatch(/"\/[^"]*storage[^"]*"/i);
      for (const file of pkg.files) {
        expect(file.storageKey).toBeUndefined();
      }
    }
  });

  it('never leaves a partial READY package or an unreferenced storage object when an exporter fails during assembly', async () => {
    const admin = await masterAdminAgent('backup-fail-assembly-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 12);

    const spy = jest
      .spyOn(payrollEntryExportService, 'exportPayrollEntriesToXlsx')
      .mockRejectedValueOnce(new Error('simulated exporter failure'));

    try {
      const res = await generateBackup(admin, cycle.id);
      expect(res.status).toBe(500);

      const pkg = await prisma.backupPackage.findFirstOrThrow({ where: { cycleId: cycle.id } });
      expect(pkg.status).toBe('FAILED');
      // A safe, non-raw diagnostic — never the original message, never a stack trace.
      expect(pkg.failureReason).toMatch(/^Error occurred during Backup Package generation$/);
      expect(pkg.failureReason).not.toContain('simulated exporter failure');

      // Assembly failed before any storage write began — zero files, zero storage objects.
      const fileCount = await prisma.backupPackageFile.count({ where: { backupPackageId: pkg.id } });
      expect(fileCount).toBe(0);
      const stillExists = await storageProvider.exists(`backups/${cycle.id}/v1/manifest.json`);
      expect(stillExists).toBe(false);

      // Exactly one generation_failed audit row — never zero, never more than one — with a safe
      // metadata payload: no stack trace, SQL text, absolute filesystem path, or the original raw
      // error message anywhere in it.
      const failedAudits = await prisma.auditLog.findMany({
        where: { action: 'backup_package.generation_failed', entityId: pkg.id },
      });
      expect(failedAudits).toHaveLength(1);
      const auditMetadata = failedAudits[0]!.metadata as { failureReason?: string; version?: number; cycleId?: string };
      expect(auditMetadata.failureReason).toBe(pkg.failureReason);
      expect(auditMetadata.failureReason).not.toContain('simulated exporter failure');
      expect(auditMetadata.failureReason).not.toMatch(/at .*\.(ts|js):\d+/); // no stack-trace frame
      expect(auditMetadata.failureReason).not.toMatch(/^\/|^[A-Za-z]:\\/); // no absolute path
      expect(auditMetadata.failureReason).not.toMatch(/select|insert|update|delete/i); // no SQL text
      expect(auditMetadata.version).toBe(1);
      expect(auditMetadata.cycleId).toBe(cycle.id);

      // Exactly one generated-or-failed row overall for this attempt — no stray
      // `backup_package.generated` row was ever written for the same package.
      const generatedAudits = await prisma.auditLog.count({
        where: { action: 'backup_package.generated', entityId: pkg.id },
      });
      expect(generatedAudits).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('cleans up already-written storage objects when a later storage write fails, and marks the package FAILED — without ever touching a previously successful version', async () => {
    const admin = await masterAdminAgent('backup-fail-storage-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 1);

    // A genuinely successful v1 exists first — the real target of point 10's own concern: cleanup
    // for a later failed attempt must never reach back and delete a previous, already-committed
    // version's rows or storage objects.
    const v1Res = await generateBackup(admin, cycle.id);
    expect(v1Res.status).toBe(201);
    const v1Files = await prisma.backupPackageFile.findMany({ where: { backupPackageId: v1Res.body.backupPackage.id } });

    const realWrite = storageProvider.write.bind(storageProvider);
    let writeCount = 0;
    const spy = jest.spyOn(storageProvider, 'write').mockImplementation(async (key, data, options) => {
      writeCount += 1;
      if (writeCount === 3) {
        throw new Error('simulated storage failure');
      }
      return realWrite(key, data, options);
    });

    try {
      const res = await generateBackup(admin, cycle.id);
      expect(res.status).toBe(500);

      const pkg = await prisma.backupPackage.findFirstOrThrow({ where: { cycleId: cycle.id, version: 2 } });
      expect(pkg.status).toBe('FAILED');

      // The first two files of THIS (v2) attempt (manifest.json, payroll-entry.csv) were written
      // then must be cleaned up (best-effort delete) once the third write failed.
      expect(await storageProvider.exists(`backups/${cycle.id}/v2/manifest.json`)).toBe(false);
      expect(await storageProvider.exists(`backups/${cycle.id}/v2/payroll-entry.csv`)).toBe(false);

      const fileCount = await prisma.backupPackageFile.count({ where: { backupPackageId: pkg.id } });
      expect(fileCount).toBe(0);

      // v1's own rows and storage objects — a completely different attempt, a different version —
      // are untouched by v2's own failure cleanup.
      const v1AfterFailure = await prisma.backupPackage.findUniqueOrThrow({ where: { id: v1Res.body.backupPackage.id } });
      expect(v1AfterFailure.status).toBe('READY');
      for (const file of v1Files) {
        expect(await storageProvider.exists(file.storageKey)).toBe(true);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('a FAILED package is never returned by list/detail as usable, and its files are never downloadable', async () => {
    const admin = await masterAdminAgent('backup-failed-visibility-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 2);

    const spy = jest
      .spyOn(payrollEntryExportService, 'exportPayrollEntriesToCsv')
      .mockRejectedValueOnce(new Error('simulated failure'));
    let failedId: string;
    try {
      const res = await generateBackup(admin, cycle.id);
      expect(res.status).toBe(500);
      failedId = (await prisma.backupPackage.findFirstOrThrow({ where: { cycleId: cycle.id } })).id;
    } finally {
      spy.mockRestore();
    }

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    expect(listRes.status).toBe(200);
    const listed = listRes.body.backupPackages.find((p: { id: string }) => p.id === failedId);
    expect(listed.status).toBe('FAILED');
    expect(listed.files).toHaveLength(0);

    const detailRes = await admin.agent.get(`/api/v1/backup-packages/${failedId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.backupPackage.status).toBe('FAILED');
  });

  it('a GENERATING package remains visible in list/detail (as a record) but exposes no downloadable files', async () => {
    const admin = await masterAdminAgent('backup-generating-visibility-admin@test.local');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'backup-generating-visibility-admin@test.local' } });
    const { cycle } = await makeReadyCycle(admin, 3);

    // Simulates the brief in-flight window synchronous generation itself occupies (reservation
    // committed, final transaction not yet run) — directly, since that window is normally too
    // short to observe via a real concurrent request.
    const generating = await prisma.backupPackage.create({
      data: {
        cycleId: cycle.id,
        version: 1,
        status: 'GENERATING',
        generatedBy: user.id,
        applicationVersion: '0.1.0',
        databaseSchemaVersion: 'test',
        releaseStatusSummary: { entryCount: 0, releasedCount: 0, heldCount: 0 },
      },
    });

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    const listed = listRes.body.backupPackages.find((p: { id: string }) => p.id === generating.id);
    expect(listed.status).toBe('GENERATING');
    expect(listed.files).toHaveLength(0);

    const detailRes = await admin.agent.get(`/api/v1/backup-packages/${generating.id}`);
    expect(detailRes.body.backupPackage.status).toBe('GENERATING');
    expect(detailRes.body.backupPackage.files).toHaveLength(0);
  });

  it('blocks individual file download whenever the parent package is not READY — the runtime check itself, not merely the absence of file rows', async () => {
    const admin = await masterAdminAgent('backup-download-notready-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 4);

    const genRes = await generateBackup(admin, cycle.id);
    expect(genRes.status).toBe(201);
    const fileId = genRes.body.backupPackage.files[0].id as string;

    // The file's own storage object still genuinely exists — proving the rejection below comes
    // from the package-status check, not a missing-object 404.
    const fileRow = await prisma.backupPackageFile.findUniqueOrThrow({ where: { id: fileId } });
    expect(await storageProvider.exists(fileRow.storageKey)).toBe(true);

    for (const status of ['GENERATING', 'FAILED'] as const) {
      await prisma.backupPackage.update({ where: { id: genRes.body.backupPackage.id }, data: { status } });
      const downloadRes = await admin.agent.get(`/api/v1/backup-packages/files/${fileId}`);
      expect(downloadRes.status).toBe(404);
    }

    await prisma.backupPackage.update({ where: { id: genRes.body.backupPackage.id }, data: { status: 'READY' } });
    const readyDownload = await admin.agent.get(`/api/v1/backup-packages/files/${fileId}`);
    expect(readyDownload.status).toBe(200);
  });

  // --- Authorization -----------------------------------------------------------------------------

  it('allows Master Admin to generate, list, and view a Backup Package', async () => {
    const admin = await masterAdminAgent('backup-rbac-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 3);

    const genRes = await generateBackup(admin, cycle.id);
    expect(genRes.status).toBe(201);

    const listRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    expect(listRes.status).toBe(200);

    const detailRes = await admin.agent.get(`/api/v1/backup-packages/${genRes.body.backupPackage.id}`);
    expect(detailRes.status).toBe(200);
  });

  it('rejects Payroll Staff with 403 on generate, list, and detail', async () => {
    const admin = await masterAdminAgent('backup-rbac-staff-admin@test.local');
    const { site, cycle } = await makeReadyCycle(admin, 4);
    const staff = await payrollStaffAgent('backup-rbac-staff@test.local', [site.id]);

    const genRes = await generateBackup(staff, cycle.id);
    expect(genRes.status).toBe(403);

    const listRes = await staff.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    expect(listRes.status).toBe(403);

    const adminGen = await generateBackup(admin, cycle.id);
    const detailRes = await staff.agent.get(`/api/v1/backup-packages/${adminGen.body.backupPackage.id}`);
    expect(detailRes.status).toBe(403);
  });

  it('rejects Finance with 403 on generate, list, and detail', async () => {
    const admin = await masterAdminAgent('backup-rbac-finance-admin@test.local');
    const { site, cycle } = await makeReadyCycle(admin, 5);
    const finance = await financeAgent('backup-rbac-finance@test.local', [site.id]);

    const genRes = await generateBackup(finance, cycle.id);
    expect(genRes.status).toBe(403);

    const listRes = await finance.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    expect(listRes.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const admin = await masterAdminAgent('backup-rbac-unauth-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 6);

    const anon = request.agent(app);
    const primeRes = await anon.get('/health');
    const csrfToken = extractCookie(primeRes, 'csrf_token');
    if (!csrfToken) throw new Error('Expected /health to issue a csrf_token cookie');

    const res = await anon
      .post(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`)
      .set('x-csrf-token', csrfToken)
      .send({});
    expect(res.status).toBe(401);
  });

  it('rejects a request with a missing or invalid CSRF token', async () => {
    const admin = await masterAdminAgent('backup-rbac-csrf-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 7);

    const missing = await admin.agent.post(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`).send({});
    expect(missing.status).toBe(403);

    const invalid = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`)
      .set('x-csrf-token', 'not-the-real-token')
      .send({});
    expect(invalid.status).toBe(403);

    const count = await prisma.backupPackage.count({ where: { cycleId: cycle.id } });
    expect(count).toBe(0);
  });

  // --- Download ------------------------------------------------------------------------------------

  it('downloads a file with correct Content-Type, filename, Cache-Control, binary integrity, and an audit entry', async () => {
    const admin = await masterAdminAgent('backup-download-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 8);

    const genRes = await generateBackup(admin, cycle.id);
    const files = await prisma.backupPackageFile.findMany({ where: { backupPackageId: genRes.body.backupPackage.id } });
    const csvFile = files.find((f) => f.fileType === 'PAYROLL_ENTRY_CSV')!;

    const downloadRes = await admin.agent
      .get(`/api/v1/backup-packages/files/${csvFile.id}`)
      .buffer(true)
      .parse(binaryParser);

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-type']).toContain('text/csv');
    expect(downloadRes.headers['content-disposition']).toContain('attachment');
    expect(downloadRes.headers['content-disposition']).toContain('payroll-entry.csv');
    expect(downloadRes.headers['cache-control']).toBe('no-store');

    const storedBuffer = await storageProvider.read(csvFile.storageKey);
    expect((downloadRes.body as Buffer).equals(storedBuffer)).toBe(true);
    expect(sha256Hex(downloadRes.body as Buffer)).toBe(csvFile.checksum);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'backup_package.file_downloaded', entityId: csvFile.id },
    });
    expect(auditEntry).not.toBeNull();
    expect((auditEntry?.metadata as { fileType?: string })?.fileType).toBe('PAYROLL_ENTRY_CSV');
  });

  it('returns a generic 404 for a nonexistent file id', async () => {
    const admin = await masterAdminAgent('backup-download-404-admin@test.local');
    const res = await admin.agent.get('/api/v1/backup-packages/files/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('never audits list operations, only generation, generation-failure, and downloads', async () => {
    const admin = await masterAdminAgent('backup-audit-noise-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 9);

    const genRes = await generateBackup(admin, cycle.id);
    await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/backup-packages`);
    await admin.agent.get(`/api/v1/backup-packages/${genRes.body.backupPackage.id}`);

    const generatedAudits = await prisma.auditLog.count({
      where: { action: 'backup_package.generated', entityId: genRes.body.backupPackage.id },
    });
    expect(generatedAudits).toBe(1);

    // No action name exists for "listed"/"viewed" — the list/detail GETs above wrote nothing.
    const allAuditsForPackage = await prisma.auditLog.count({
      where: { entityId: genRes.body.backupPackage.id },
    });
    expect(allAuditsForPackage).toBe(1); // exactly the one `backup_package.generated` row
  });

  // --- Schema ---------------------------------------------------------------------------------------

  it('enforces unique (cycleId, version) at the database level', async () => {
    const admin = await masterAdminAgent('backup-schema-version-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 10);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'backup-schema-version-admin@test.local' } });

    await prisma.backupPackage.create({
      data: {
        cycleId: cycle.id,
        version: 1,
        status: 'READY',
        generatedBy: user.id,
        applicationVersion: '0.1.0',
        databaseSchemaVersion: 'test',
        releaseStatusSummary: { entryCount: 0, releasedCount: 0, heldCount: 0 },
      },
    });

    await expect(
      prisma.backupPackage.create({
        data: {
          cycleId: cycle.id,
          version: 1,
          status: 'READY',
          generatedBy: user.id,
          applicationVersion: '0.1.0',
          databaseSchemaVersion: 'test',
          releaseStatusSummary: { entryCount: 0, releasedCount: 0, heldCount: 0 },
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces unique (backupPackageId, fileType) at the database level', async () => {
    const admin = await masterAdminAgent('backup-schema-file-admin@test.local');
    const { cycle } = await makeReadyCycle(admin, 11);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'backup-schema-file-admin@test.local' } });

    const pkg = await prisma.backupPackage.create({
      data: {
        cycleId: cycle.id,
        version: 1,
        status: 'READY',
        generatedBy: user.id,
        applicationVersion: '0.1.0',
        databaseSchemaVersion: 'test',
        releaseStatusSummary: { entryCount: 0, releasedCount: 0, heldCount: 0 },
      },
    });
    await prisma.backupPackageFile.create({
      data: {
        backupPackageId: pkg.id,
        fileType: 'MANIFEST',
        filename: 'manifest.json',
        storageKey: 'backups/x/v1/manifest.json',
        contentType: 'application/json',
        sizeBytes: 10,
        checksum: 'a'.repeat(64),
        sortOrder: 0,
      },
    });

    await expect(
      prisma.backupPackageFile.create({
        data: {
          backupPackageId: pkg.id,
          fileType: 'MANIFEST',
          filename: 'manifest.json',
          storageKey: 'backups/x/v1/manifest-2.json',
          contentType: 'application/json',
          sizeBytes: 10,
          checksum: 'b'.repeat(64),
          sortOrder: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an invalid BackupFileType/BackupPackageStatus enum value at the database level', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "BackupPackage" (id, "cycleId", version, status, "generatedBy", "applicationVersion", "databaseSchemaVersion", "releaseStatusSummary")
         VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'NOT_A_REAL_STATUS', gen_random_uuid(), '0.1.0', 'test', '{}')`,
      ),
    ).rejects.toThrow();
  });

  // --- AUD-011 (Post-Phase-5 Stabilization Checkpoint 3): stale GENERATING recovery ---------------

  describe('AUD-011: stale GENERATING recovery', () => {
    /** Directly backdates a row's `updatedAt` past `recoverStaleGeneratingBackupPackages`'s own
     * staleness threshold — raw SQL (not `prisma.backupPackage.update`) so the write is a genuine
     * `UPDATE ... SET "updatedAt" = ...` and isn't itself subject to Prisma's own `@updatedAt`
     * auto-management touching the value back to "now". */
    async function backdateUpdatedAt(backupPackageId: string, ageMs: number): Promise<void> {
      await prisma.$executeRaw`UPDATE "BackupPackage" SET "updatedAt" = ${new Date(Date.now() - ageMs)} WHERE id = ${backupPackageId}::uuid`;
    }

    async function createGeneratingPackage(cycleId: string, generatedBy: string, version = 1) {
      return prisma.backupPackage.create({
        data: {
          cycleId,
          version,
          status: 'GENERATING',
          generatedBy,
          applicationVersion: '0.1.0',
          databaseSchemaVersion: 'test',
          releaseStatusSummary: { entryCount: 0, releasedCount: 0, heldCount: 0 },
        },
      });
    }

    const STALE_AGE_MS = 20 * 60 * 1000; // 20 minutes — past the service's own 15-minute threshold

    it('transitions a GENERATING package older than the staleness threshold to FAILED, writes a system-attributed audit entry, and is idempotent on repeat calls', async () => {
      const admin = await masterAdminAgent('backup-recovery-stale-admin@test.local');
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'backup-recovery-stale-admin@test.local' },
      });
      const { cycle } = await makeReadyCycle(admin, 1, 2901);

      const stale = await createGeneratingPackage(cycle.id, user.id);
      await backdateUpdatedAt(stale.id, STALE_AGE_MS);

      const firstSweep = await recoverStaleGeneratingBackupPackages();
      expect(firstSweep.recoveredIds).toContain(stale.id);

      const recovered = await prisma.backupPackage.findUniqueOrThrow({ where: { id: stale.id } });
      expect(recovered.status).toBe('FAILED');
      expect(recovered.failureReason).toBeTruthy();

      const auditEntries = await prisma.auditLog.findMany({
        where: { action: 'backup_package.generation_recovered', entityId: stale.id },
      });
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]!.actorUserId).toBeNull();
      const metadata = auditEntries[0]!.metadata as { cycleId?: string; version?: number };
      expect(metadata.cycleId).toBe(cycle.id);
      expect(metadata.version).toBe(1);

      // Repeated execution is safe: the row no longer matches status=GENERATING, so a second
      // sweep finds nothing and writes no duplicate audit entry — never revisits an already-FAILED
      // row.
      const secondSweep = await recoverStaleGeneratingBackupPackages();
      expect(secondSweep.recoveredIds).not.toContain(stale.id);
      const auditEntriesAfterSecondSweep = await prisma.auditLog.findMany({
        where: { action: 'backup_package.generation_recovered', entityId: stale.id },
      });
      expect(auditEntriesAfterSecondSweep).toHaveLength(1);
    });

    it('never touches a GENERATING package within the staleness threshold — a genuinely in-flight generation is not mistaken for an abandoned one', async () => {
      const admin = await masterAdminAgent('backup-recovery-fresh-admin@test.local');
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'backup-recovery-fresh-admin@test.local' },
      });
      const { cycle } = await makeReadyCycle(admin, 2, 2901);

      const fresh = await createGeneratingPackage(cycle.id, user.id);

      const sweep = await recoverStaleGeneratingBackupPackages();
      expect(sweep.recoveredIds).not.toContain(fresh.id);

      const stillGenerating = await prisma.backupPackage.findUniqueOrThrow({ where: { id: fresh.id } });
      expect(stillGenerating.status).toBe('GENERATING');

      const auditEntries = await prisma.auditLog.count({
        where: { action: 'backup_package.generation_recovered', entityId: fresh.id },
      });
      expect(auditEntries).toBe(0);
    });

    it('never touches a READY or an already-FAILED package, even when old — version history is never corrupted or revisited', async () => {
      const admin = await masterAdminAgent('backup-recovery-ready-failed-admin@test.local');
      const { cycle } = await makeReadyCycle(admin, 3, 2901);

      const readyRes = await generateBackup(admin, cycle.id);
      expect(readyRes.status).toBe(201);
      const readyId = readyRes.body.backupPackage.id as string;
      await backdateUpdatedAt(readyId, 60 * 60 * 1000);

      const spy = jest
        .spyOn(payrollEntryExportService, 'exportPayrollEntriesToCsv')
        .mockRejectedValueOnce(new Error('simulated failure'));
      let failedId: string;
      try {
        const failedRes = await generateBackup(admin, cycle.id);
        expect(failedRes.status).toBe(500);
        failedId = (
          await prisma.backupPackage.findFirstOrThrow({ where: { cycleId: cycle.id, status: 'FAILED' } })
        ).id;
      } finally {
        spy.mockRestore();
      }
      await backdateUpdatedAt(failedId, 60 * 60 * 1000);

      const readyBefore = await prisma.backupPackage.findUniqueOrThrow({ where: { id: readyId } });
      const failedBefore = await prisma.backupPackage.findUniqueOrThrow({ where: { id: failedId } });

      await recoverStaleGeneratingBackupPackages();

      const readyAfter = await prisma.backupPackage.findUniqueOrThrow({ where: { id: readyId } });
      const failedAfter = await prisma.backupPackage.findUniqueOrThrow({ where: { id: failedId } });
      expect(readyAfter.status).toBe('READY');
      expect(readyAfter.updatedAt).toEqual(readyBefore.updatedAt);
      expect(failedAfter.status).toBe('FAILED');
      expect(failedAfter.failureReason).toBe(failedBefore.failureReason);
      expect(failedAfter.updatedAt).toEqual(failedBefore.updatedAt);

      const recoveredAudits = await prisma.auditLog.count({
        where: { action: 'backup_package.generation_recovered', entityId: { in: [readyId, failedId] } },
      });
      expect(recoveredAudits).toBe(0);
    });

    it('recovers a stale GENERATING row for a cycle before reserving a new version — version numbering stays correct and the new generation succeeds normally', async () => {
      const admin = await masterAdminAgent('backup-recovery-before-generate-admin@test.local');
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'backup-recovery-before-generate-admin@test.local' },
      });
      const { cycle } = await makeReadyCycle(admin, 4, 2901);

      const stale = await createGeneratingPackage(cycle.id, user.id);
      await backdateUpdatedAt(stale.id, STALE_AGE_MS);

      // Generates through the ordinary HTTP route (no direct call to the recovery function) —
      // proves the sweep is wired into `reserveBackupPackageVersion` itself, the one shared
      // reservation primitive both manual generation and rollover call, not only callable
      // standalone.
      const genRes = await generateBackup(admin, cycle.id);
      expect(genRes.status).toBe(201);

      const staleAfter = await prisma.backupPackage.findUniqueOrThrow({ where: { id: stale.id } });
      expect(staleAfter.status).toBe('FAILED');

      // The new generation reserved version 2, not version 1 again — the stale row's own version
      // number is preserved, never reused or overwritten by recovery.
      expect(genRes.body.backupPackage.version).toBe(2);
      const allVersions = await prisma.backupPackage.findMany({
        where: { cycleId: cycle.id },
        orderBy: { version: 'asc' },
        select: { version: true, status: true },
      });
      expect(allVersions).toEqual([
        { version: 1, status: 'FAILED' },
        { version: 2, status: 'READY' },
      ]);
    });

    it('generation before any recovery is needed proceeds normally, and repeated generation keeps incrementing versions correctly', async () => {
      const admin = await masterAdminAgent('backup-recovery-noop-admin@test.local');
      const { cycle } = await makeReadyCycle(admin, 5, 2901);

      const firstRes = await generateBackup(admin, cycle.id);
      expect(firstRes.status).toBe(201);
      expect(firstRes.body.backupPackage.version).toBe(1);

      const secondRes = await generateBackup(admin, cycle.id);
      expect(secondRes.status).toBe(201);
      expect(secondRes.body.backupPackage.version).toBe(2);
    });

    it('failure-injection: a defensive failure while marking a stale row FAILED is logged, never thrown, and the sweep still reports the row as processed', async () => {
      const admin = await masterAdminAgent('backup-recovery-injection-admin@test.local');
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'backup-recovery-injection-admin@test.local' },
      });
      const { cycle } = await makeReadyCycle(admin, 6, 2901);

      const stale = await createGeneratingPackage(cycle.id, user.id);
      await backdateUpdatedAt(stale.id, STALE_AGE_MS);

      const updateSpy = jest
        .spyOn(prisma.backupPackage, 'update')
        .mockRejectedValueOnce(new Error('simulated DB failure'));
      try {
        await expect(recoverStaleGeneratingBackupPackages()).resolves.toEqual({ recoveredIds: [stale.id] });
      } finally {
        updateSpy.mockRestore();
      }

      // The status update itself failed and was caught/logged (matching
      // `failBackupPackageGeneration`'s own defensive-catch behavior for the identical "mark
      // FAILED" step) rather than throwing and aborting the sweep — the audit entry, a separate
      // step, was still written.
      const stillGenerating = await prisma.backupPackage.findUniqueOrThrow({ where: { id: stale.id } });
      expect(stillGenerating.status).toBe('GENERATING');
      const auditEntries = await prisma.auditLog.findMany({
        where: { action: 'backup_package.generation_recovered', entityId: stale.id },
      });
      expect(auditEntries).toHaveLength(1);
    });
  });
});
