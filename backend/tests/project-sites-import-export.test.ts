import ExcelJS from 'exceljs';
import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import { PERMISSIONS, PROJECT_SITE_FIELD_LIMITS, ROLE_CODES, type SessionUser } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  EXAMPLE_SHEET_NAME,
  IMPORT_DATA_SHEET_NAME,
  INSTRUCTIONS_SHEET_NAME,
  PROJECT_SITE_TEMPLATE_HEADERS,
  PROJECT_SITE_TEMPLATE_VERSION,
} from '../src/modules/project-sites/project-sites-import-export.service';
import { createProjectSiteInTransaction } from '../src/modules/project-sites/project-sites.service';
import { createProjectUnit } from '../src/modules/project-units/project-units.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

/** supertest/superagent only auto-buffers `res.body` for content-types it recognizes as binary —
 * same helper as `employees-import-export.test.ts`'s own `binaryParser`. */
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

describe('Project Site import/export', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [PERMISSIONS.SITES_MANAGE],
    });
  }

  async function scopedAgent(email: string, extraPermissions: string[] = []) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: 'TEST_SITES_MANAGE',
      permissionKeys: [PERMISSIONS.SITES_MANAGE, ...extraPermissions],
    });
  }

  /** Base row for every column in `PROJECT_SITE_TEMPLATE_HEADERS`. Every test's own imported site
   * names must start with "Test Site " so `cleanTestData()` (tests/helpers.ts) actually cleans
   * them up between tests — the exact convention this suite's own fixtures follow. */
  function templateRow(overrides: Partial<Record<(typeof PROJECT_SITE_TEMPLATE_HEADERS)[number], string>>) {
    const base: Record<(typeof PROJECT_SITE_TEMPLATE_HEADERS)[number], string> = {
      'Sr. No': '1',
      'Site Name': '',
      'Unit Label': '',
      Address: '',
    };
    return { ...base, ...overrides };
  }

  function toCsv(rows: Record<string, string>[]): Buffer {
    const csv = stringifyCsvSync([
      PROJECT_SITE_TEMPLATE_HEADERS as unknown as string[],
      ...rows.map((row) => PROJECT_SITE_TEMPLATE_HEADERS.map((header) => row[header] ?? '')),
    ]);
    return Buffer.from(csv, 'utf-8');
  }

  async function downloadTemplateWorkbook(agent: Awaited<ReturnType<typeof masterAdminAgent>>['agent']) {
    const res = await agent.get('/api/v1/sites/import-template').buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as Buffer);
    return { res, workbook };
  }

  // ---------------------------------------------------------------------------------------------
  // PERMISSION / RBAC (Part 16 items 1-4)
  // ---------------------------------------------------------------------------------------------

  it('a user with sites:manage can download the template and import', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-permitted@test.local');

    const templateRes = await agent.get('/api/v1/sites/import-template');
    expect(templateRes.status).toBe(200);

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Permitted' })]);
    const importRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(importRes.status).toBe(200);
    expect(importRes.body.created).toBe(1);
  });

  it('rejects a template download from a user without sites:manage', async () => {
    const { agent } = await createAuthenticatedAgent(app, {
      email: 'site-import-no-permission-template@test.local',
      password: PASSWORD,
      roleCode: 'TEST_SITES_VIEW_ONLY',
      permissionKeys: [PERMISSIONS.EMPLOYEES_VIEW],
    });

    const res = await agent.get('/api/v1/sites/import-template');
    expect(res.status).toBe(403);
  });

  it('rejects an import call from a user without sites:manage, even with a well-formed file', async () => {
    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'site-import-no-permission@test.local',
      password: PASSWORD,
      roleCode: 'TEST_SITES_VIEW_ONLY_2',
      permissionKeys: [PERMISSIONS.EMPLOYEES_VIEW],
    });

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Should Not Be Created' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(403);
    expect(await prisma.projectSite.findFirst({ where: { name: 'Test Site Should Not Be Created' } })).toBeNull();
  });

  it('does not bypass server-side permission enforcement for a user holding an unrelated create permission', async () => {
    // employees:create is a real, legitimate "create" permission elsewhere in the app — proves the
    // import endpoint checks its own sites:manage permission specifically, not "any create right."
    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'site-import-wrong-permission@test.local',
      password: PASSWORD,
      roleCode: 'TEST_SITES_WRONG_PERM',
      permissionKeys: [PERMISSIONS.EMPLOYEES_CREATE],
    });

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Wrong Permission' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------------------------
  // CREATOR OWNERSHIP (Part 16 items 5-10)
  // ---------------------------------------------------------------------------------------------

  it('automatically assigns the importing (scoped) user to a single newly-imported site', async () => {
    const { agent, csrfToken, userId } = await scopedAgent('site-import-single-assign@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Single Assign' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Single Assign' } });
    const assignment = await prisma.userSiteAssignment.findUnique({ where: { userId_siteId: { userId, siteId: site.id } } });
    expect(assignment).not.toBeNull();
  });

  it('automatically assigns the importing user to every successfully created site in a multi-row import', async () => {
    const { agent, csrfToken, userId } = await scopedAgent('site-import-multi-assign@test.local');

    const csv = toCsv([
      templateRow({ 'Site Name': 'Test Site Multi Assign A' }),
      templateRow({ 'Site Name': 'Test Site Multi Assign B' }),
      templateRow({ 'Site Name': 'Test Site Multi Assign C' }),
    ]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(3);

    const sites = await prisma.projectSite.findMany({ where: { name: { startsWith: 'Test Site Multi Assign' } } });
    expect(sites).toHaveLength(3);
    const assignments = await prisma.userSiteAssignment.findMany({ where: { userId, siteId: { in: sites.map((s) => s.id) } } });
    expect(assignments).toHaveLength(3);
  });

  it('grants the importer access only to the sites they imported, not unrelated pre-existing sites', async () => {
    const unrelatedSite = await prisma.projectSite.create({ data: { name: 'Test Site Unrelated Preexisting' } });
    const { agent, csrfToken, userId } = await scopedAgent('site-import-no-unrelated-access@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Own Import' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);

    const ownSite = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Own Import' } });
    expect(await prisma.userSiteAssignment.findUnique({ where: { userId_siteId: { userId, siteId: ownSite.id } } })).not.toBeNull();
    expect(
      await prisma.userSiteAssignment.findUnique({ where: { userId_siteId: { userId, siteId: unrelatedSite.id } } }),
    ).toBeNull();
  });

  it('does not assign a different, non-importing user to sites another user imported', async () => {
    const { agent, csrfToken } = await scopedAgent('site-import-importer@test.local');
    const { userId: bystanderId } = await scopedAgent('site-import-bystander@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Bystander Check' })]);
    await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Bystander Check' } });
    expect(
      await prisma.userSiteAssignment.findUnique({ where: { userId_siteId: { userId: bystanderId, siteId: site.id } } }),
    ).toBeNull();
  });

  it('Master Admin importing sites receives no explicit UserSiteAssignment rows (unconditional access already), but each site still gets its initial Unit', async () => {
    const { agent, csrfToken, userId } = await masterAdminAgent('site-import-master-admin@test.local');

    const csv = toCsv([
      templateRow({ 'Site Name': 'Test Site Master Admin A' }),
      templateRow({ 'Site Name': 'Test Site Master Admin B' }),
    ]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);

    const assignments = await prisma.userSiteAssignment.findMany({ where: { userId } });
    expect(assignments).toHaveLength(0);

    // Item H (Part 9) — initial Unit provisioning is unconditional, independent of who's importing.
    const siteA = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Master Admin A' } });
    const unitsA = await prisma.projectUnit.findMany({ where: { siteId: siteA.id } });
    expect(unitsA).toHaveLength(1);
    expect(unitsA[0]?.name).toBe('Main Branch');
  });

  it('creates exactly one assignment row per imported site — no duplicates across a multi-row import', async () => {
    const { agent, csrfToken, userId } = await scopedAgent('site-import-no-dup-assignments@test.local');

    const csv = toCsv(
      Array.from({ length: 5 }, (_, i) => templateRow({ 'Site Name': `Test Site No Dup Assign ${i + 1}` })),
    );
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.body.created).toBe(5);

    const assignments = await prisma.userSiteAssignment.findMany({ where: { userId } });
    expect(assignments).toHaveLength(5);
    const uniqueSiteIds = new Set(assignments.map((a) => a.siteId));
    expect(uniqueSiteIds.size).toBe(5);
  });

  // ---------------------------------------------------------------------------------------------
  // TRANSACTION SAFETY (Part 16 items 11-13)
  // ---------------------------------------------------------------------------------------------

  it('a row failing schema validation before site creation persists neither a Site, an initial Unit, nor an assignment', async () => {
    const { agent, csrfToken, userId } = await scopedAgent('site-import-validation-gate@test.local');

    const overlongName = 'X'.repeat(PROJECT_SITE_FIELD_LIMITS.name + 1);
    const csv = toCsv([templateRow({ 'Site Name': overlongName })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(await prisma.projectUnit.count({ where: { site: { name: overlongName } } })).toBe(0);
    expect(res.body.skipped).toHaveLength(1);
    expect(await prisma.projectSite.findFirst({ where: { name: overlongName } })).toBeNull();
    expect(await prisma.userSiteAssignment.findMany({ where: { userId } })).toHaveLength(0);
  });

  it('records project-site.created, project-unit.created, and project-site.creator_assigned audit entries, tagged as coming from import', async () => {
    const { agent, csrfToken, userId } = await scopedAgent('site-import-audit@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Audit Provenance' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Audit Provenance' } });
    const unit = await prisma.projectUnit.findFirstOrThrow({ where: { siteId: site.id } });

    const createdEntry = await prisma.auditLog.findFirst({ where: { action: 'project-site.created', entityId: site.id } });
    expect(createdEntry).not.toBeNull();
    expect((createdEntry!.metadata as { source?: string }).source).toBe('import');
    expect(createdEntry!.actorUserId).toBe(userId);

    const unitCreatedEntry = await prisma.auditLog.findFirst({ where: { action: 'project-unit.created', entityId: unit.id } });
    expect(unitCreatedEntry).not.toBeNull();
    expect((unitCreatedEntry!.metadata as { source?: string; siteId?: string }).source).toBe('import');
    expect((unitCreatedEntry!.metadata as { siteId?: string }).siteId).toBe(site.id);

    const assignedEntry = await prisma.auditLog.findFirst({ where: { action: 'project-site.creator_assigned', entityId: site.id } });
    expect(assignedEntry).not.toBeNull();
    expect((assignedEntry!.metadata as { source?: string; userId?: string }).userId).toBe(userId);

    const summaryEntry = await prisma.auditLog.findFirst({ where: { action: 'project-site.import', actorUserId: userId } });
    expect(summaryEntry).not.toBeNull();
    expect((summaryEntry!.metadata as { created?: number }).created).toBeGreaterThanOrEqual(1);
  });

  it('a structurally invalid workbook creates zero sites', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-structural-fail@test.local');
    const csv = stringifyCsvSync([['Completely', 'Wrong', 'Headers']]);

    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', Buffer.from(csv, 'utf-8'), 'bad.csv');
    expect(res.status).toBe(400);
    expect(await prisma.projectSite.count({ where: { name: { startsWith: 'Test Site' } } })).toBe(0);
  });

  // ---------------------------------------------------------------------------------------------
  // INITIAL PROJECT UNIT PROVISIONING (final delta — operational-Site-onboarding requirement)
  // ---------------------------------------------------------------------------------------------

  it('[A/B] importing a Site creates exactly one initial Project Unit, belonging to the correct Site, named "Main <Unit Label>"', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-unit-provisioned@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Unit Provisioned', 'Unit Label': 'Department' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Unit Provisioned' } });
    const units = await prisma.projectUnit.findMany({ where: { siteId: site.id } });
    expect(units).toHaveLength(1);
    expect(units[0]?.siteId).toBe(site.id);
    expect(units[0]?.name).toBe('Main Department'); // derived from the Site's own actual unitLabel
    expect(units[0]?.code).toBeNull(); // never invented — no Initial Unit Code column exists
  });

  it('[A/B] a blank Unit Label still provisions a correctly-named initial Unit from the database default ("Branch")', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-unit-default-label@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Unit Default Label' })]); // Unit Label left blank
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Unit Default Label' } });
    expect(site.unitLabel).toBe('Branch');
    const units = await prisma.projectUnit.findMany({ where: { siteId: site.id } });
    expect(units).toHaveLength(1);
    expect(units[0]?.name).toBe('Main Branch');
  });

  it('[C] an imported Site is immediately operational — an Employee can be created against its initial Unit with no manual setup step', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-operational@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Operational' })]);
    const importRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(importRes.status).toBe(200);

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Operational' } });
    const unit = await prisma.projectUnit.findFirstOrThrow({ where: { siteId: site.id } });

    // Drives the real Employee create endpoint against the just-imported Site/Unit — no manual
    // "create a Branch first" step in between, proving the Site is genuinely operational, not just
    // present in the list.
    const employeeRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Operational Proof Employee', designation: 'Guard', siteId: site.id, unitId: unit.id, grossPay: '20000' });
    expect(employeeRes.status).toBe(201);
  });

  it('[E] re-importing an already-existing Site name creates no duplicate Unit (rejected before any write, same as the Site itself)', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-no-dup-unit@test.local');

    const firstCsv = toCsv([templateRow({ 'Site Name': 'Test Site No Dup Unit' })]);
    const firstRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', firstCsv, 'a.csv');
    expect(firstRes.body.created).toBe(1);

    const secondCsv = toCsv([templateRow({ 'Site Name': 'Test Site No Dup Unit' })]);
    const secondRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', secondCsv, 'b.csv');
    expect(secondRes.body.created).toBe(0);
    expect(secondRes.body.skipped).toHaveLength(1);
    expect(secondRes.body.skipped[0].reason).toMatch(/already exists/i);

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site No Dup Unit' } });
    const units = await prisma.projectUnit.findMany({ where: { siteId: site.id } });
    expect(units).toHaveLength(1); // never "Main Branch" + a second "Main Branch"
  });

  it('[F/G] any failure inside the shared Site+Unit(+assignment) transaction rolls back everything for that row — no orphaned Site or Unit', async () => {
    const { userId } = await scopedAgent('site-import-rollback-proof@test.local');
    // Only `.id` and `.roleCode` are actually read by createProjectSiteInTransaction/
    // ensureCreatorSiteAssignment/isMasterAdmin — a minimal stand-in for the full SessionUser this
    // low-level transaction-plumbing test doesn't otherwise need (no HTTP layer involved here).
    const currentUser = { id: userId, roleCode: 'TEST_SITES_MANAGE' } as unknown as SessionUser;

    // [F] Fails immediately after Unit creation, before creator assignment — proves a failure at
    // the "assignment" step leaves neither the Site nor the Unit behind.
    await expect(
      prisma.$transaction(async (tx) => {
        const site = await createProjectSiteInTransaction(tx, currentUser, { name: 'Test Site Rollback F' });
        await createProjectUnit(site.id, { name: 'Main Branch', code: null }, tx);
        throw new Error('simulated failure after Unit creation, before assignment');
      }),
    ).rejects.toThrow('simulated failure after Unit creation, before assignment');
    expect(await prisma.projectSite.findFirst({ where: { name: 'Test Site Rollback F' } })).toBeNull();
    expect(await prisma.projectUnit.findFirst({ where: { name: 'Main Branch', site: { name: 'Test Site Rollback F' } } })).toBeNull();

    // [G] Fails immediately after Site creation, before Unit creation — proves a failure at the
    // "initial Unit" step leaves no orphaned Site behind either.
    await expect(
      prisma.$transaction(async (tx) => {
        await createProjectSiteInTransaction(tx, currentUser, { name: 'Test Site Rollback G' });
        throw new Error('simulated failure after Site creation, before Unit creation');
      }),
    ).rejects.toThrow('simulated failure after Site creation, before Unit creation');
    expect(await prisma.projectSite.findFirst({ where: { name: 'Test Site Rollback G' } })).toBeNull();
  });

  it('[I] a non-importing user gains no access from another user\'s Site import, including no implicit Unit-level access', async () => {
    const { agent, csrfToken } = await scopedAgent('site-import-i-importer@test.local');
    const { userId: bystanderId } = await scopedAgent('site-import-i-bystander@test.local');

    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Bystander Unit Check' })]);
    await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');

    const site = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Bystander Unit Check' } });
    expect(
      await prisma.userSiteAssignment.findUnique({ where: { userId_siteId: { userId: bystanderId, siteId: site.id } } }),
    ).toBeNull();
  });

  it('[J] existing Project Sites created before this checkpoint receive no retroactive initial Unit from an unrelated import', async () => {
    const preexisting = await prisma.projectSite.create({ data: { name: 'Test Site Preexisting No Backfill' } });
    expect(await prisma.projectUnit.count({ where: { siteId: preexisting.id } })).toBe(0);

    const { agent, csrfToken } = await masterAdminAgent('site-import-no-backfill@test.local');
    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Unrelated To Backfill Check' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.body.created).toBe(1);

    // The pre-existing, un-imported Site is completely untouched — no backfill, no unit, ever.
    expect(await prisma.projectUnit.count({ where: { siteId: preexisting.id } })).toBe(0);
  });

  // ---------------------------------------------------------------------------------------------
  // TEMPLATE (Part 16 items 14-22)
  // ---------------------------------------------------------------------------------------------

  it('serves a workbook with Instructions, Import Data, and Example sheets with the correct header row', async () => {
    const { agent } = await masterAdminAgent('site-import-template-structure@test.local');
    const { res, workbook } = await downloadTemplateWorkbook(agent);

    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('project-site-import-template.xlsx');
    expect(workbook.worksheets.map((s) => s.name)).toEqual(
      expect.arrayContaining([INSTRUCTIONS_SHEET_NAME, IMPORT_DATA_SHEET_NAME, EXAMPLE_SHEET_NAME]),
    );

    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;
    expect((importDataSheet.getRow(1).values as unknown[]).slice(1)).toEqual(PROJECT_SITE_TEMPLATE_HEADERS);
    expect(importDataSheet.getRow(2).values).toEqual([]); // no sample data on the real data-entry sheet

    const exampleSheet = workbook.getWorksheet(EXAMPLE_SHEET_NAME)!;
    expect((exampleSheet.getRow(1).values as unknown[]).slice(1)).toEqual(PROJECT_SITE_TEMPLATE_HEADERS);
    expect(exampleSheet.rowCount).toBe(2); // header + exactly one sample row

    const instructionsSheet = workbook.getWorksheet(INSTRUCTIONS_SHEET_NAME)!;
    const allText = instructionsSheet
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join('\n');
    expect(allText).toContain(`Template Version: ${PROJECT_SITE_TEMPLATE_VERSION}`);
    for (const header of PROJECT_SITE_TEMPLATE_HEADERS) expect(allText).toContain(header);
  });

  it("Example sheet's sample row imports successfully and is never read from Import Data", async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-example-valid@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);
    const exampleSheet = workbook.getWorksheet(EXAMPLE_SHEET_NAME)!;
    const exampleRow = (exampleSheet.getRow(2).values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v)));

    // Neutral example uses the template's own placeholder site name — must be prefixed "Test Site "
    // in this test's own upload to satisfy cleanTestData's convention, so override the Site Name
    // cell while keeping every other example column's real value.
    const csv = stringifyCsvSync([
      PROJECT_SITE_TEMPLATE_HEADERS as unknown as string[],
      exampleRow.map((value, index) => (PROJECT_SITE_TEMPLATE_HEADERS[index] === 'Site Name' ? 'Test Site Example Row' : value)),
    ]);

    const importRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', Buffer.from(csv, 'utf-8'), 'example.csv');
    expect(importRes.status).toBe(200);
    expect(importRes.body.skipped).toHaveLength(0);
    expect(importRes.body.created).toBe(1);

    // And ignoring the real Example sheet content when uploading the actual generated template
    // workbook wholesale — only Import Data (empty) is read, so nothing is created from it.
    const fullTemplateRes = await agent.get('/api/v1/sites/import-template').buffer(true).parse(binaryParser);
    const rawImportRes = await agent
      .post('/api/v1/sites/import')
      .set('x-csrf-token', csrfToken)
      .attach('file', fullTemplateRes.body as Buffer, 'template.xlsx');
    expect(rawImportRes.status).toBe(200);
    expect(rawImportRes.body.created).toBe(0);
    expect(rawImportRes.body.skipped).toHaveLength(0);
  });

  it("a column marked Required is enforced and Optional columns aren't", async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-required-contract@test.local');

    const missingName = toCsv([templateRow({ 'Site Name': '' })]);
    const missingNameRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', missingName, 'a.csv');
    expect(missingNameRes.body.created).toBe(0);
    expect(missingNameRes.body.skipped).toHaveLength(1);
    expect(missingNameRes.body.skipped[0].reason).toMatch(/Site Name/);

    const blankOptionals = toCsv([templateRow({ 'Site Name': 'Test Site Optional Fields Blank', 'Unit Label': '', Address: '' })]);
    const blankOptionalsRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', blankOptionals, 'b.csv');
    expect(blankOptionalsRes.body.skipped).toHaveLength(0);
    expect(blankOptionalsRes.body.created).toBe(1);
    const created = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Optional Fields Blank' } });
    expect(created.unitLabel).toBe('Branch'); // schema/database default
    expect(created.address).toBeNull();
  });

  it('Import Data sheet max-length Excel validation matches PROJECT_SITE_FIELD_LIMITS', async () => {
    const { agent } = await masterAdminAgent('site-import-template-lengths@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);
    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;

    const nameCell = importDataSheet.getCell(2, 2); // Site Name (required)
    expect(nameCell.dataValidation?.type).toBe('textLength');
    expect(nameCell.dataValidation?.formulae).toEqual([1, PROJECT_SITE_FIELD_LIMITS.name]);

    const unitLabelCell = importDataSheet.getCell(2, 3); // Unit Label (optional)
    expect(unitLabelCell.dataValidation?.type).toBe('textLength');
    expect(unitLabelCell.dataValidation?.operator).toBe('lessThanOrEqual');
    expect(unitLabelCell.dataValidation?.formulae).toEqual([PROJECT_SITE_FIELD_LIMITS.unitLabel]);

    const addressCell = importDataSheet.getCell(2, 4); // Address (optional)
    expect(addressCell.dataValidation?.formulae).toEqual([PROJECT_SITE_FIELD_LIMITS.address]);
  });

  it('has no leading-zero-formatted or enum/dropdown columns — ProjectSite has no code-like or reference fields', async () => {
    const { agent } = await masterAdminAgent('site-import-no-codes-or-enums@test.local');
    const { workbook } = await downloadTemplateWorkbook(agent);
    const importDataSheet = workbook.getWorksheet(IMPORT_DATA_SHEET_NAME)!;

    for (let columnIndex = 1; columnIndex <= PROJECT_SITE_TEMPLATE_HEADERS.length; columnIndex += 1) {
      expect(importDataSheet.getColumn(columnIndex).numFmt).not.toBe('@');
      expect(importDataSheet.getCell(2, columnIndex).dataValidation?.type).not.toBe('list');
    }
    // No hidden "Lists" sheet either — nothing in this template needs one (Part 4/9).
    expect(workbook.worksheets.some((sheet) => sheet.state === 'veryHidden')).toBe(false);
  });

  // ---------------------------------------------------------------------------------------------
  // VALIDATION (Part 16 items 23-30)
  // ---------------------------------------------------------------------------------------------

  it('imports a valid site successfully', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-valid@test.local');
    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Valid Import', 'Unit Label': 'Department', Address: '12 Example Road' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    const created = await prisma.projectSite.findUniqueOrThrow({ where: { name: 'Test Site Valid Import' } });
    expect(created.unitLabel).toBe('Department');
    expect(created.address).toBe('12 Example Road');
  });

  it('rejects an over-length Site Name with a clean, readable message', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-overlength@test.local');
    const overlong = 'Test Site ' + 'Y'.repeat(PROJECT_SITE_FIELD_LIMITS.name);
    const csv = toCsv([templateRow({ 'Site Name': overlong })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toContain('Site Name');
    expect(res.body.skipped[0].reason).not.toContain('{"code"');
  });

  it('rejects two rows in the same workbook sharing a Site Name — both rows, naming each other', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-workbook-duplicate@test.local');
    const csv = toCsv([
      templateRow({ 'Site Name': 'Test Site Workbook Duplicate' }),
      templateRow({ 'Site Name': 'Test Site Workbook Duplicate' }),
    ]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toHaveLength(2);
    expect(res.body.skipped[0].reason).toMatch(/Site Name.*appears more than once/i);
    expect(res.body.skipped[0].reason).toContain('row(s) 3'); // row 2 cites row 3
    expect(res.body.skipped[1].reason).toContain('row(s) 2'); // row 3 cites row 2
    expect(await prisma.projectSite.findFirst({ where: { name: 'Test Site Workbook Duplicate' } })).toBeNull();
  });

  it('rejects a row naming a Site that already exists in the database', async () => {
    await prisma.projectSite.create({ data: { name: 'Test Site Already Exists' } });
    const { agent, csrfToken } = await masterAdminAgent('site-import-db-duplicate@test.local');
    const csv = toCsv([templateRow({ 'Site Name': 'Test Site Already Exists' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/Site Name.*already exists/i);

    const all = await prisma.projectSite.findMany({ where: { name: 'Test Site Already Exists' } });
    expect(all).toHaveLength(1); // never duplicated
  });

  it('never silently updates an existing site\'s fields via import (create-only, no upsert)', async () => {
    const existing = await prisma.projectSite.create({ data: { name: 'Test Site No Upsert', address: 'Original Address' } });
    const { agent, csrfToken } = await masterAdminAgent('site-import-no-upsert@test.local');
    const csv = toCsv([templateRow({ 'Site Name': 'Test Site No Upsert', Address: 'Attempted New Address' })]);
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toHaveLength(1);

    const unchanged = await prisma.projectSite.findUniqueOrThrow({ where: { id: existing.id } });
    expect(unchanged.address).toBe('Original Address');
  });

  it('.xlsx and .csv uploads produce the same server-side validation outcome for an equivalent invalid row', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-csv-xlsx-equivalent@test.local');

    const csv = toCsv([templateRow({ 'Site Name': '' })]);
    const csvRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites.csv');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(IMPORT_DATA_SHEET_NAME);
    sheet.addRow(PROJECT_SITE_TEMPLATE_HEADERS as unknown as string[]);
    sheet.addRow(Object.values(templateRow({ 'Site Name': '' })));
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const xlsxRes = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', xlsxBuffer, 'sites.xlsx');

    expect(csvRes.body.created).toBe(xlsxRes.body.created);
    expect(csvRes.body.skipped).toHaveLength(xlsxRes.body.skipped.length);
    expect(csvRes.body.skipped[0].reason).toBe(xlsxRes.body.skipped[0].reason);
  });

  it('imports from an .xlsx workbook (real ExcelJS round-trip, not just CSV)', async () => {
    const { agent, csrfToken } = await masterAdminAgent('site-import-xlsx@test.local');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(PROJECT_SITE_TEMPLATE_HEADERS as unknown as string[]);
    sheet.addRow(Object.values(templateRow({ 'Site Name': 'Test Site Xlsx Upload' })));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', buffer, 'sites.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(await prisma.projectSite.findFirst({ where: { name: 'Test Site Xlsx Upload' } })).not.toBeNull();
  });

  // ---------------------------------------------------------------------------------------------
  // SCALE (Part 16 item 31)
  // ---------------------------------------------------------------------------------------------

  it('[D] imports ~600 valid Project Sites with 600 initial Units, 600 creator assignments, zero duplicates, zero orphans, and no pathological slowdown', async () => {
    const SITE_COUNT = 600;
    const { agent, csrfToken, userId } = await scopedAgent('site-import-scale@test.local');

    const rows = Array.from({ length: SITE_COUNT }, (_, i) =>
      templateRow({ 'Site Name': `Test Site Scale ${String(i + 1).padStart(4, '0')}`, 'Unit Label': 'Branch' }),
    );
    const csv = toCsv(rows);

    const startedAt = Date.now();
    const res = await agent.post('/api/v1/sites/import').set('x-csrf-token', csrfToken).attach('file', csv, 'sites-scale.csv');
    const durationMs = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(SITE_COUNT);
    expect(res.body.skipped).toHaveLength(0);

    const createdSites = await prisma.projectSite.findMany({ where: { name: { startsWith: 'Test Site Scale ' } } });
    expect(createdSites).toHaveLength(SITE_COUNT); // 0 orphaned/missing Sites

    const assignments = await prisma.userSiteAssignment.findMany({ where: { userId, siteId: { in: createdSites.map((s) => s.id) } } });
    expect(assignments).toHaveLength(SITE_COUNT); // 600 creator assignments
    expect(new Set(assignments.map((a) => a.siteId)).size).toBe(SITE_COUNT); // no duplicate assignment rows

    const units = await prisma.projectUnit.findMany({ where: { siteId: { in: createdSites.map((s) => s.id) } } });
    expect(units).toHaveLength(SITE_COUNT); // exactly 600 initial Units — 0 orphaned Sites without one, 0 duplicates
    expect(new Set(units.map((u) => u.siteId)).size).toBe(SITE_COUNT); // one Unit per Site, never two
    expect(units.every((u) => u.name === 'Main Branch')).toBe(true);

    // Not a strict performance assertion (this sandbox's shared local Postgres has no SLA) — a
    // generous ceiling that only fails on genuine pathological (e.g. accidental O(n^2) per-row
    // full-table-scan) behavior, not on ordinary machine variance.
    expect(durationMs).toBeLessThan(120_000);
  }, 150_000);
});
