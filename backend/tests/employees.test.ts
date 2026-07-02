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

  async function makeSite(name: string) {
    return prisma.projectSite.create({ data: { name } });
  }

  async function masterAdminAgent(email: string) {
    return createAuthenticatedAgent(app, {
      email,
      password: PASSWORD,
      roleCode: ROLE_CODES.MASTER_ADMIN,
      permissionKeys: [...EMPLOYEE_PERMISSIONS, PERMISSIONS.SITES_MANAGE],
    });
  }

  function baseEmployeePayload(siteId: string, overrides: Record<string, unknown> = {}) {
    return {
      name: 'Test Employee One',
      designation: 'Security Guard',
      siteId,
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
      .send(baseEmployeePayload(site.id));

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
      .send(baseEmployeePayload(site.id));

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
        .send(baseEmployeePayload(outsideSite.id));

      expect(res.status).toBe(403);

      const created = await prisma.employee.findFirst({ where: { siteId: outsideSite.id } });
      expect(created).toBeNull();
    },
  );

  it('rejects a Payroll Staff GET for an employee at a site outside their assignment', async () => {
    const outsideSite = await makeSite('Test Site Employees Outside View');
    const employee = await prisma.employee.create({
      data: { name: 'Outside Employee', designation: 'Clerk', siteId: outsideSite.id, grossPay: '20000' },
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
      data: { name: 'Movable Employee', designation: 'Clerk', siteId: assignedSite.id, grossPay: '20000' },
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
      .send({ siteId: outsideSite.id });

    expect(res.status).toBe(403);

    const unchanged = await prisma.employee.findUnique({ where: { id: employee.id } });
    expect(unchanged?.siteId).toBe(assignedSite.id);
  });

  it("scopes the employee list to a Payroll Staff user's assigned sites, ignoring a client-requested siteIds filter for a site outside the assignment", async () => {
    const assignedSite = await makeSite('Test Site Employees List Assigned');
    const outsideSite = await makeSite('Test Site Employees List Outside');

    const insideEmployee = await prisma.employee.create({
      data: { name: 'Inside Employee', designation: 'Clerk', siteId: assignedSite.id, grossPay: '20000' },
    });
    const outsideEmployee = await prisma.employee.create({
      data: { name: 'Outside Employee', designation: 'Clerk', siteId: outsideSite.id, grossPay: '20000' },
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
    const { agent, csrfToken } = await masterAdminAgent('emp-cnic@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, { name: 'CNIC Holder One', cnic: '1234567890123' }));
    expect(first.status).toBe(201);

    const dup = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, { name: 'CNIC Holder Two', cnic: '1234567890123' }));
    expect(dup.status).toBe(409);

    const noCnicOne = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, { name: 'No CNIC One' }));
    const noCnicTwo = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, { name: 'No CNIC Two' }));

    expect(noCnicOne.status).toBe(201);
    expect(noCnicTwo.status).toBe(201);
  });

  it('updates an employee and records a field-level diff on the audit log', async () => {
    const site = await makeSite('Test Site Employees Update');
    const { agent, csrfToken } = await masterAdminAgent('emp-update@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id));

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

  it('marks an employee as left exactly once, writing a distinct employee.left audit entry', async () => {
    const site = await makeSite('Test Site Employees Leave');
    const { agent, csrfToken } = await masterAdminAgent('emp-leave@test.local');

    const createRes = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id));
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
});
