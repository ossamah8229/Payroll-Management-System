import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();

const PASSWORD = 'CorrectHorseBattery1!';

const EMPLOYEE_PERMISSIONS = [
  PERMISSIONS.EMPLOYEES_VIEW,
  PERMISSIONS.EMPLOYEES_EDIT,
  PERMISSIONS.EMPLOYEES_CREATE,
];

describe('Employee Registry', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  /** Every test site gets exactly one Project Unit — Employee.unitId is required as of Phase 2.5
   * Checkpoint 2, so every test employee needs one too. */
  async function makeSite(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit` } });
    return site;
  }

  async function unitIdForSite(siteId: string): Promise<string> {
    const unit = await prisma.projectUnit.findFirstOrThrow({ where: { siteId } });
    return unit.id;
  }

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [...EMPLOYEE_PERMISSIONS, PERMISSIONS.SITES_MANAGE],
    });
  }

  function baseEmployeePayload(siteId: string, unitId: string, overrides: Record<string, unknown> = {}) {
    return {
      name: 'Test Employee One',
      designation: 'Security Guard',
      siteId,
      unitId,
      grossPay: '35000.00',
      ...overrides,
    };
  }

  it('lets Master Admin create an employee at any site', async () => {
    const site = await makeSite('Test Site Employees Admin');
    const { agent, csrfToken } = await masterAdminAgent('emp-admin-create@test.local');

    const res = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, await unitIdForSite(site.id)));

    expect(res.status).toBe(201);
    expect(res.body.employee.name).toBe('Test Employee One');

    const entries = await prisma.auditLog.findMany({ where: { action: 'employee.created' } });
    expect(entries.some((entry) => entry.entityId === res.body.employee.id)).toBe(true);
  });

  it('lets Payroll Staff create an employee at their assigned site', async () => {
    const site = await makeSite('Test Site Employees Staff Own');
    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'emp-staff-create@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: EMPLOYEE_PERMISSIONS,
      siteIds: [site.id],
    });

    const res = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, await unitIdForSite(site.id)));

    expect(res.status).toBe(201);
  });

  it(
    'rejects a Payroll Staff attempt to create an employee at a site outside their assignment, ' +
      'even via a direct API call with a manipulated siteId (the C11 boundary test)',
    async () => {
      const outsideSite = await makeSite('Test Site Employees Outside');
      const { agent, csrfToken } = await createAuthenticatedAgent(app, {
        email: 'emp-staff-outside-create@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: EMPLOYEE_PERMISSIONS,
        siteIds: [],
      });

      const res = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(outsideSite.id, await unitIdForSite(outsideSite.id)));

      expect(res.status).toBe(403);

      const created = await prisma.employee.findFirst({ where: { siteId: outsideSite.id } });
      expect(created).toBeNull();
    },
  );

  it('rejects a Payroll Staff GET for an employee at a site outside their assignment', async () => {
    const outsideSite = await makeSite('Test Site Employees Outside View');
    const employee = await prisma.employee.create({
      data: {
        name: 'Outside Employee',
        designation: 'Clerk',
        siteId: outsideSite.id,
        unitId: await unitIdForSite(outsideSite.id),
        grossPay: '20000',
      },
    });

    const { agent } = await createAuthenticatedAgent(app, {
      email: 'emp-staff-outside-view@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: EMPLOYEE_PERMISSIONS,
      siteIds: [],
    });

    const res = await agent.get(`/api/v1/employees/${employee.id}`);
    expect(res.status).toBe(403);
  });

  it('rejects a Payroll Staff PATCH that moves an employee to a site outside their assignment', async () => {
    const assignedSite = await makeSite('Test Site Employees Move From');
    const outsideSite = await makeSite('Test Site Employees Move To');
    const employee = await prisma.employee.create({
      data: {
        name: 'Movable Employee',
        designation: 'Clerk',
        siteId: assignedSite.id,
        unitId: await unitIdForSite(assignedSite.id),
        grossPay: '20000',
      },
    });

    const { agent, csrfToken } = await createAuthenticatedAgent(app, {
      email: 'emp-staff-move@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: EMPLOYEE_PERMISSIONS,
      siteIds: [assignedSite.id],
    });

    const res = await agent
      .patch(`/api/v1/employees/${employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ siteId: outsideSite.id, unitId: await unitIdForSite(outsideSite.id) });

    expect(res.status).toBe(403);

    const unchanged = await prisma.employee.findUnique({ where: { id: employee.id } });
    expect(unchanged?.siteId).toBe(assignedSite.id);
  });

  it("scopes the employee list to a Payroll Staff user's assigned sites, ignoring a client-requested siteIds filter for a site outside the assignment", async () => {
    const assignedSite = await makeSite('Test Site Employees List Assigned');
    const outsideSite = await makeSite('Test Site Employees List Outside');

    const insideEmployee = await prisma.employee.create({
      data: {
        name: 'Inside Employee',
        designation: 'Clerk',
        siteId: assignedSite.id,
        unitId: await unitIdForSite(assignedSite.id),
        grossPay: '20000',
      },
    });
    const outsideEmployee = await prisma.employee.create({
      data: {
        name: 'Outside Employee',
        designation: 'Clerk',
        siteId: outsideSite.id,
        unitId: await unitIdForSite(outsideSite.id),
        grossPay: '20000',
      },
    });

    const { agent } = await createAuthenticatedAgent(app, {
      email: 'emp-staff-list@test.local',
      password: PASSWORD,
      roleCode: ROLE_CODES.PAYROLL_STAFF,
      permissionKeys: EMPLOYEE_PERMISSIONS,
      siteIds: [assignedSite.id],
    });

    const res = await agent.get(`/api/v1/employees?siteIds=${outsideSite.id}`);
    const ids = res.body.employees.map((employee: { id: string }) => employee.id);

    expect(ids).not.toContain(outsideEmployee.id);
    expect(ids).not.toContain(insideEmployee.id); // requested filter (outside site) yields nothing
  });

  it('rejects a duplicate CNIC with 409 but allows multiple employees with no CNIC', async () => {
    const site = await makeSite('Test Site Employees CNIC');
    const unitId = await unitIdForSite(site.id);
    const { agent, csrfToken } = await masterAdminAgent('emp-cnic@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'CNIC Holder One', cnic: '1234567890123' }));
    expect(first.status).toBe(201);

    const dup = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'CNIC Holder Two', cnic: '1234567890123' }));
    expect(dup.status).toBe(409);

    const noCnicOne = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'No CNIC One' }));
    const noCnicTwo = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'No CNIC Two' }));

    expect(noCnicOne.status).toBe(201);
    expect(noCnicTwo.status).toBe(201);
  });

  it('updates an employee and records a field-level diff on the audit log', async () => {
    const site = await makeSite('Test Site Employees Update');
    const { agent, csrfToken } = await masterAdminAgent('emp-update@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, await unitIdForSite(site.id)));

    const updateRes = await agent
      .patch(`/api/v1/employees/${createRes.body.employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ designation: 'Senior Security Guard' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.employee.designation).toBe('Senior Security Guard');

    const entries = await prisma.auditLog.findMany({ where: { action: 'employee.updated' } });
    const entry = entries.find((e) => e.entityId === createRes.body.employee.id);
    expect((entry?.metadata as { changes?: Record<string, unknown> })?.changes).toHaveProperty(
      'designation',
    );
  });

  it('transfers an employee to a new unit within the same site, writing an EmployeeTransferHistory row and a dedicated employee.transferred audit entry instead of employee.updated', async () => {
    const site = await makeSite('Test Site Employees Transfer');
    const fromUnitId = await unitIdForSite(site.id);
    const toUnit = await prisma.projectUnit.create({ data: { siteId: site.id, name: 'Second Unit' } });
    const { agent, csrfToken } = await masterAdminAgent('emp-transfer@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, fromUnitId));
    const employeeId = createRes.body.employee.id;

    const transferRes = await agent
      .patch(`/api/v1/employees/${employeeId}`)
      .set('x-csrf-token', csrfToken)
      .send({ unitId: toUnit.id, transferReason: 'Operational need', transferRemarks: 'Temporary cover' });

    expect(transferRes.status).toBe(200);
    expect(transferRes.body.employee.unitId).toBe(toUnit.id);

    const history = await prisma.employeeTransferHistory.findMany({ where: { employeeId } });
    expect(history).toHaveLength(1);
    expect(history[0]?.fromUnitId).toBe(fromUnitId);
    expect(history[0]?.toUnitId).toBe(toUnit.id);
    expect(history[0]?.fromSiteId).toBe(site.id);
    expect(history[0]?.toSiteId).toBe(site.id);
    expect(history[0]?.reason).toBe('Operational need');
    expect(history[0]?.remarks).toBe('Temporary cover');
    expect(history[0]?.effectiveDate).toBeInstanceOf(Date);

    const transferEntries = await prisma.auditLog.findMany({ where: { action: 'employee.transferred' } });
    expect(transferEntries.some((e) => e.entityId === employeeId)).toBe(true);

    const updatedEntries = await prisma.auditLog.findMany({ where: { action: 'employee.updated' } });
    expect(updatedEntries.some((e) => e.entityId === employeeId)).toBe(false);
  });

  it('rejects assigning an employee to a unit belonging to a different site (composite-FK boundary)', async () => {
    const site = await makeSite('Test Site Employees Wrong Unit Site');
    const otherSite = await makeSite('Test Site Employees Wrong Unit Other');
    const otherUnitId = await unitIdForSite(otherSite.id);
    const { agent, csrfToken } = await masterAdminAgent('emp-wrong-unit@test.local');

    const res = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, otherUnitId));

    expect(res.status).toBe(400);
  });

  it('marks an employee as left exactly once, writing a distinct employee.left audit entry', async () => {
    const site = await makeSite('Test Site Employees Leave');
    const { agent, csrfToken } = await masterAdminAgent('emp-leave@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, await unitIdForSite(site.id)));
    const employeeId = createRes.body.employee.id;

    const leaveRes = await agent
      .post(`/api/v1/employees/${employeeId}/leave`)
      .set('x-csrf-token', csrfToken)
      .send({ dateOfLeaving: '2026-06-30' });

    expect(leaveRes.status).toBe(200);
    expect(leaveRes.body.employee.dateOfLeaving).toContain('2026-06-30');

    const secondAttempt = await agent
      .post(`/api/v1/employees/${employeeId}/leave`)
      .set('x-csrf-token', csrfToken)
      .send({ dateOfLeaving: '2026-07-01' });
    expect(secondAttempt.status).toBe(400);

    const entries = await prisma.auditLog.findMany({ where: { action: 'employee.left' } });
    expect(entries.some((entry) => entry.entityId === employeeId)).toBe(true);
  });

  it('normalizes a dashed/spaced CNIC identically on create and update, before validation, not just storage', async () => {
    const site = await makeSite('Test Site Employees CNIC Normalize');
    const unitId = await unitIdForSite(site.id);
    const { agent, csrfToken } = await masterAdminAgent('emp-cnic-normalize@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Dashed CNIC', cnic: '12345-1234567-1' }));

    expect(createRes.status).toBe(201);
    expect(createRes.body.employee.cnic).toBe('1234512345671');

    const updateRes = await agent
      .patch(`/api/v1/employees/${createRes.body.employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ cnic: '54321 7654321 9' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.employee.cnic).toBe('5432176543219');
  });

  describe('GET /employees/check-cnic', () => {
    it('reports exists:false for a CNIC no employee holds', async () => {
      const { agent } = await masterAdminAgent('emp-check-cnic-none@test.local');
      const res = await agent.get('/api/v1/employees/check-cnic?cnic=1112223334445');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ exists: false, employee: null });
    });

    it('gives Master Admin full detail about the existing employee, normalizing the query CNIC the same way', async () => {
      const site = await makeSite('Test Site Employees Check CNIC Admin');
      const unitId = await unitIdForSite(site.id);
      const { agent, csrfToken } = await masterAdminAgent('emp-check-cnic-admin@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Holder', cnic: '2223334445556' }));

      // A dashed query CNIC must normalize to the same digits-only value already stored.
      const res = await agent.get('/api/v1/employees/check-cnic?cnic=22233-3444555-6');

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(true);
      expect(res.body.employee.id).toBe(createRes.body.employee.id);
      expect(res.body.employee.name).toBe('Holder');
      expect(res.body.employee.siteName).toBe(site.name);
      expect(res.body.employee.active).toBe(true);
    });

    it('masks employee detail from a Payroll Staff caller outside the holder\'s site, but still reports exists:true', async () => {
      const site = await makeSite('Test Site Employees Check CNIC Masked');
      const unitId = await unitIdForSite(site.id);
      const { agent: adminAgent, csrfToken: adminCsrf } = await masterAdminAgent('emp-check-cnic-masked-admin@test.local');

      await adminAgent
        .post('/api/v1/employees')
        .set('x-csrf-token', adminCsrf)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Masked Holder', cnic: '3334445556667' }));

      const { agent } = await createAuthenticatedAgent(app, {
        email: 'emp-check-cnic-masked-staff@test.local',
        password: PASSWORD,
        roleCode: ROLE_CODES.PAYROLL_STAFF,
        permissionKeys: EMPLOYEE_PERMISSIONS,
        siteIds: [],
      });

      const res = await agent.get('/api/v1/employees/check-cnic?cnic=3334445556667');
      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(true);
      expect(res.body.employee).toBeNull();
    });

    it('excludes the employee named by excludeId, so an edit form does not flag its own record as a duplicate', async () => {
      const site = await makeSite('Test Site Employees Check CNIC Exclude');
      const unitId = await unitIdForSite(site.id);
      const { agent, csrfToken } = await masterAdminAgent('emp-check-cnic-exclude@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Self', cnic: '4445556667778' }));

      const res = await agent.get(
        `/api/v1/employees/check-cnic?cnic=4445556667778&excludeId=${createRes.body.employee.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ exists: false, employee: null });
    });
  });

  describe('POST /employees/:id/reactivate', () => {
    it('clears dateOfLeaving, updates supplied employment fields, and writes a distinct employee.reactivated audit entry', async () => {
      const site = await makeSite('Test Site Employees Reactivate');
      const unitId = await unitIdForSite(site.id);
      const { agent, csrfToken } = await masterAdminAgent('emp-reactivate@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Rehire Candidate', cnic: '5556667778889' }));
      const employeeId = createRes.body.employee.id;

      await agent
        .post(`/api/v1/employees/${employeeId}/leave`)
        .set('x-csrf-token', csrfToken)
        .send({ dateOfLeaving: '2026-01-15' });

      const reactivateRes = await agent
        .post(`/api/v1/employees/${employeeId}/reactivate`)
        .set('x-csrf-token', csrfToken)
        .send({ designation: 'Rehired Guard', grossPay: '40000.00' });

      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.employee.dateOfLeaving).toBeNull();
      expect(reactivateRes.body.employee.designation).toBe('Rehired Guard');
      expect(reactivateRes.body.employee.grossPay).toBe('40000');

      // Never a second row for the same CNIC (Principle 2 — historical PayrollEntry links survive).
      const allWithCnic = await prisma.employee.findMany({ where: { cnic: '5556667778889' } });
      expect(allWithCnic).toHaveLength(1);
      expect(allWithCnic[0]?.id).toBe(employeeId);

      const reactivatedEntries = await prisma.auditLog.findMany({ where: { action: 'employee.reactivated' } });
      expect(reactivatedEntries.some((e) => e.entityId === employeeId)).toBe(true);

      const updatedEntries = await prisma.auditLog.findMany({ where: { action: 'employee.updated' } });
      expect(updatedEntries.some((e) => e.entityId === employeeId)).toBe(false);
    });

    it('rejects reactivating an employee who is already active with 400', async () => {
      const site = await makeSite('Test Site Employees Reactivate Active');
      const unitId = await unitIdForSite(site.id);
      const { agent, csrfToken } = await masterAdminAgent('emp-reactivate-active@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Still Active' }));

      const res = await agent
        .post(`/api/v1/employees/${createRes.body.employee.id}/reactivate`)
        .set('x-csrf-token', csrfToken)
        .send({});

      expect(res.status).toBe(400);
    });

    it('reactivating with a different site/unit also writes an EmployeeTransferHistory row and employee.transferred entry alongside employee.reactivated', async () => {
      const fromSite = await makeSite('Test Site Employees Reactivate Transfer From');
      const toSite = await makeSite('Test Site Employees Reactivate Transfer To');
      const fromUnitId = await unitIdForSite(fromSite.id);
      const toUnitId = await unitIdForSite(toSite.id);
      const { agent, csrfToken } = await masterAdminAgent('emp-reactivate-transfer@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(fromSite.id, fromUnitId, { name: 'Rehire And Transfer' }));
      const employeeId = createRes.body.employee.id;

      await agent
        .post(`/api/v1/employees/${employeeId}/leave`)
        .set('x-csrf-token', csrfToken)
        .send({ dateOfLeaving: '2026-02-01' });

      const reactivateRes = await agent
        .post(`/api/v1/employees/${employeeId}/reactivate`)
        .set('x-csrf-token', csrfToken)
        .send({ siteId: toSite.id, unitId: toUnitId });

      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.employee.siteId).toBe(toSite.id);

      const history = await prisma.employeeTransferHistory.findMany({ where: { employeeId } });
      expect(history).toHaveLength(1);
      expect(history[0]?.fromSiteId).toBe(fromSite.id);
      expect(history[0]?.toSiteId).toBe(toSite.id);

      const transferEntries = await prisma.auditLog.findMany({ where: { action: 'employee.transferred' } });
      expect(transferEntries.some((e) => e.entityId === employeeId)).toBe(true);

      const reactivatedEntries = await prisma.auditLog.findMany({ where: { action: 'employee.reactivated' } });
      expect(reactivatedEntries.some((e) => e.entityId === employeeId)).toBe(true);
    });
  });

  describe('Banking refinement (2026-07-11) — Account Title removed, IBAN added', () => {
    // "TB" prefix matches cleanTestData()'s own cleanup filter (tests/helpers.ts) — without it,
    // this test bank would persist across runs and collide on Bank.code's unique constraint.
    async function makeBank(code: string, name: string) {
      return prisma.bank.create({ data: { code: `TB${code}`, name } });
    }

    it('creates a bank employee with an IBAN, stored trimmed and uppercase', async () => {
      const site = await makeSite('Test Site Banking IBAN Create');
      const bank = await makeBank('IBC1', 'IBAN Create Bank');
      const { agent, csrfToken } = await masterAdminAgent('emp-iban-create@test.local');

      const res = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(
          baseEmployeePayload(site.id, await unitIdForSite(site.id), {
            bankId: bank.id,
            accountNumber: '001234567890',
            iban: '  pk36scbl0000001123456702  ',
          }),
        );

      expect(res.status).toBe(201);
      expect(res.body.employee.iban).toBe('PK36SCBL0000001123456702');
      expect(res.body.employee).not.toHaveProperty('accountTitle');
    });

    it('rejects creating a bank employee with no Account Number (400)', async () => {
      const site = await makeSite('Test Site Banking No Account Number');
      const bank = await makeBank('IBC2', 'No Account Number Bank');
      const { agent, csrfToken } = await masterAdminAgent('emp-no-acct-num@test.local');

      const res = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, await unitIdForSite(site.id), { bankId: bank.id }));

      expect(res.status).toBe(400);
    });

    it('creates a cash employee with no bank, Account Number, or IBAN', async () => {
      const site = await makeSite('Test Site Banking Cash Create');
      const { agent, csrfToken } = await masterAdminAgent('emp-cash-create@test.local');

      const res = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, await unitIdForSite(site.id)));

      expect(res.status).toBe(201);
      expect(res.body.employee.bankId).toBeNull();
      expect(res.body.employee.accountNumber).toBeNull();
      expect(res.body.employee.iban).toBeNull();
    });

    it('rejects adding a bank via update with no Account Number, checked against the merged post-update state', async () => {
      const site = await makeSite('Test Site Banking Update Reject');
      const bank = await makeBank('IBC3', 'Update Reject Bank');
      const { agent, csrfToken } = await masterAdminAgent('emp-update-reject@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, await unitIdForSite(site.id)));

      // This request only sends bankId — Account Number is not in the request body at all, but
      // the merged effective state (existing accountNumber: null + this bankId) must still fail.
      const res = await agent
        .patch(`/api/v1/employees/${createRes.body.employee.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ bankId: bank.id });

      expect(res.status).toBe(400);
    });

    it('clears Account Number and IBAN when a bank is cleared via update, even though this request does not mention them', async () => {
      const site = await makeSite('Test Site Banking Update Clear');
      const bank = await makeBank('IBC4', 'Update Clear Bank');
      const { agent, csrfToken } = await masterAdminAgent('emp-update-clear@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(
          baseEmployeePayload(site.id, await unitIdForSite(site.id), {
            bankId: bank.id,
            accountNumber: '001234567890',
            iban: 'PK36SCBL0000001123456702',
          }),
        );

      const res = await agent
        .patch(`/api/v1/employees/${createRes.body.employee.id}`)
        .set('x-csrf-token', csrfToken)
        .send({ bankId: null });

      expect(res.status).toBe(200);
      expect(res.body.employee.bankId).toBeNull();
      expect(res.body.employee.accountNumber).toBeNull();
      expect(res.body.employee.iban).toBeNull();
    });

    it('reactivate rejects assigning a bank with no Account Number, the same way create/update do', async () => {
      const site = await makeSite('Test Site Banking Reactivate Reject');
      const bank = await makeBank('IBC5', 'Reactivate Reject Bank');
      const unitId = await unitIdForSite(site.id);
      const { agent, csrfToken } = await masterAdminAgent('emp-reactivate-reject@test.local');

      const createRes = await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Reactivate Banking Rule' }));
      const employeeId = createRes.body.employee.id;

      await agent
        .post(`/api/v1/employees/${employeeId}/leave`)
        .set('x-csrf-token', csrfToken)
        .send({ dateOfLeaving: '2026-01-15' });

      const res = await agent
        .post(`/api/v1/employees/${employeeId}/reactivate`)
        .set('x-csrf-token', csrfToken)
        .send({ bankId: bank.id });

      expect(res.status).toBe(400);
    });
  });
});
