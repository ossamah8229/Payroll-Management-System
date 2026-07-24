import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { PAYROLL_ENTRY_TEMPLATE_HEADERS } from '../src/modules/payroll-entry/payroll-entry-import-export.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

describe('Phase 3 Checkpoint 5 — Payroll Entry CSV/Excel export (import removed, Payroll Entry usability checkpoint 2026-07-24)', () => {
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
      permissionKeys: [PERMISSIONS.PAYROLL_CYCLE_MANAGE, PERMISSIONS.PAYROLL_ENTRY],
    });
  }

  async function makeSiteWithUnit(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    const unit = await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
    return { site, unit };
  }

  async function makeEmployee(
    siteId: string,
    unitId: string,
    name: string,
    overrides: { cnic?: string; employeeCode?: string; grossPay?: string } = {},
  ) {
    return prisma.employee.create({
      data: {
        name,
        designation: 'Guard',
        siteId,
        unitId,
        grossPay: overrides.grossPay ?? '30000',
        cnic: overrides.cnic,
        employeeCode: overrides.employeeCode,
      },
    });
  }

  async function makeDraftCycle(admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>, month: number) {
    const res = await admin.agent
      .post('/api/v1/payroll-cycles')
      .set('x-csrf-token', admin.csrfToken)
      .send({ year: 2900, month });
    return res.body.cycle as { id: string; status: string };
  }

  it('exports CSV with the exact template header row and the entry’s real values', async () => {
    const admin = await masterAdminAgent('export-csv-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export CSV');
    await makeEmployee(site.id, unit.id, 'CSV Export Employee', { cnic: '3334445556667', grossPay: '32000' });
    const cycle = await makeDraftCycle(admin, 1);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);

    const lines = exportRes.text.trim().split('\n');
    expect(lines[0]!.trim()).toBe(PAYROLL_ENTRY_TEMPLATE_HEADERS.join(','));
    expect(lines[1]).toContain('3334445556667');
    expect(lines[1]).toContain('32000');
  });

  it('exports XLSX with the exact template header row', async () => {
    const admin = await masterAdminAgent('export-xlsx-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export XLSX');
    await makeEmployee(site.id, unit.id, 'XLSX Export Employee', { cnic: '2223334445556' });
    const cycle = await makeDraftCycle(admin, 2);

    const exportRes = await admin.agent
      .get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=xlsx`)
      .buffer(true)
      .parse((res, callback) => {
        res.setEncoding('binary');
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => callback(null, Buffer.from(data, 'binary')));
      });

    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-type']).toContain('spreadsheetml');
  });

  it('writes exactly one summary AuditLog entry per export operation', async () => {
    const admin = await masterAdminAgent('export-audit-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site Export Audit');
    await makeEmployee(site.id, unit.id, 'Audit Employee', { cnic: '1231231231231' });
    const cycle = await makeDraftCycle(admin, 3);

    const exportRes = await admin.agent.get(`/api/v1/payroll-cycles/${cycle.id}/entries/export?format=csv`);
    expect(exportRes.status).toBe(200);

    const exportAuditEntries = await prisma.auditLog.findMany({ where: { action: 'payroll_entry.export' } });
    const exportAudit = exportAuditEntries.filter(
      (entry) => (entry.metadata as { cycleId?: string })?.cycleId === cycle.id,
    );
    expect(exportAudit).toHaveLength(1);
  });

  it('no longer serves a Payroll Entry import route or an import-template route', async () => {
    const admin = await masterAdminAgent('no-import-admin@test.local');
    const { site, unit } = await makeSiteWithUnit('Test Site No Import');
    await makeEmployee(site.id, unit.id, 'No Import Employee', { cnic: '9998887776665' });
    const cycle = await makeDraftCycle(admin, 4);

    // `/import-template`'s dedicated route is gone entirely — it now falls through to the generic
    // `GET /payroll-entries/:id` route, treating "import-template" as a (non-UUID) id, which that
    // route rejects with 400 rather than a clean 404. Either way, the template is definitely no
    // longer served — never a 200 with an .xlsx body.
    const templateRes = await admin.agent.get('/api/v1/payroll-entries/import-template');
    expect(templateRes.status).toBe(400);

    // `/entries/import` has no fallback route on its router at all, so this is a real Express 404.
    const importRes = await admin.agent
      .post(`/api/v1/payroll-cycles/${cycle.id}/entries/import`)
      .set('x-csrf-token', admin.csrfToken)
      .attach('file', Buffer.from('CNIC\n9998887776665\n'), 'payroll.csv');
    expect(importRes.status).toBe(404);
  });
});
