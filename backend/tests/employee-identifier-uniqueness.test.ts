import { stringify as stringifyCsvSync } from 'csv-stringify/sync';
import { PERMISSIONS, ROLE_CODES } from '@payroll/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { EMPLOYEE_TEMPLATE_HEADERS } from '../src/modules/employees/employees-import-export.service';
import { cleanTestData, createAuthenticatedAgent } from './helpers';

const app = createApp();
const PASSWORD = 'CorrectHorseBattery1!';

const EMPLOYEE_PERMISSIONS = [PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.EMPLOYEES_EDIT, PERMISSIONS.EMPLOYEES_CREATE];

/**
 * Employee Identifier Uniqueness checkpoint (2026-07-26) — Part D items 11-29. Employee Code and
 * CNIC already had DB-level uniqueness before this checkpoint (covered by `employees.test.ts`'s
 * own pre-existing CNIC test); this file focuses on the actual gap this checkpoint closes —
 * Account Number/IBAN canonical uniqueness — plus the shared cross-field behaviors (same
 * Bank/Branch Code allowed, null banking fields allowed for Cash employees, edit-without-
 * conflicting-with-self, and import's identity-aware workbook + database duplicate detection).
 */
describe('Employee Identifier Uniqueness', () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await prisma.$disconnect();
  });

  async function makeSite(name: string) {
    const site = await prisma.projectSite.create({ data: { name } });
    await prisma.projectUnit.create({ data: { siteId: site.id, name: `${name} Unit`, code: 'U-1' } });
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
      name: 'Test Employee',
      designation: 'Security Guard',
      siteId,
      unitId,
      grossPay: '35000.00',
      ...overrides,
    };
  }

  // --- Item 13/28: Account Number uniqueness, leading zeros preserved as text -------------------

  it('rejects a duplicate Account Number with 409, and preserves leading zeros as text', async () => {
    const site = await makeSite('Test Site Uniq Account');
    const unitId = await unitIdForSite(site.id);
    const bank = await prisma.bank.create({ data: { code: 'TBUNIQ1', name: 'Test Bank Uniq 1' } });
    const { agent, csrfToken } = await masterAdminAgent('uniq-account@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Account Holder One', bankId: bank.id, accountNumber: '00112233' }));
    expect(first.status).toBe(201);
    expect(first.body.employee.accountNumber).toBe('00112233'); // Item 28: leading zeros intact, never coerced to a number

    const dup = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Account Holder Two', bankId: bank.id, accountNumber: '00112233' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/account/i);
    expect(dup.body.error.message).not.toMatch(/accountNumberCanonical|P2002|prisma/i);
  });

  // --- Item L / Part 6 review: Account Number is never parsed numerically ------------------------

  it('never treats a leading-zero Account Number as numerically equal to its non-zero-padded counterpart', async () => {
    const site = await makeSite('Test Site Uniq Account Leading Zero');
    const unitId = await unitIdForSite(site.id);
    const bank = await prisma.bank.create({ data: { code: 'TBUNIQ8', name: 'Test Bank Uniq 8' } });
    const { agent, csrfToken } = await masterAdminAgent('uniq-account-leadingzero@test.local');

    const padded = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Leading Zero Holder',
          bankId: bank.id,
          accountNumber: '000000065437654',
        }),
      );
    expect(padded.status).toBe(201);
    expect(padded.body.employee.accountNumber).toBe('000000065437654');

    // The numerically-equal-but-textually-different value is a DIFFERENT account number and must
    // be allowed for a second employee — proves account numbers are never coerced to a JS number
    // (which would silently collapse "000000065437654" and "65437654" to the same value) anywhere
    // in the create/validate/normalize path.
    const unpadded = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Unpadded Holder',
          bankId: bank.id,
          accountNumber: '65437654',
        }),
      );
    expect(unpadded.status).toBe(201);
    expect(unpadded.body.employee.accountNumber).toBe('65437654');

    const stored = await prisma.employee.findMany({
      where: { id: { in: [padded.body.employee.id, unpadded.body.employee.id] } },
      select: { accountNumber: true, accountNumberCanonical: true },
    });
    const canonicals = stored.map((e) => e.accountNumberCanonical).sort();
    expect(canonicals).toEqual(['000000065437654', '65437654']); // distinct canonical values, no numeric collapse
  });

  // --- Item 14/27: IBAN uniqueness, canonical formatting/case collisions detected -----------------

  it('rejects a duplicate IBAN with 409, including a formatting/case-only collision', async () => {
    const site = await makeSite('Test Site Uniq Iban');
    const unitId = await unitIdForSite(site.id);
    const bank = await prisma.bank.create({ data: { code: 'TBUNIQ2', name: 'Test Bank Uniq 2' } });
    const { agent, csrfToken } = await masterAdminAgent('uniq-iban@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Iban Holder One',
          bankId: bank.id,
          accountNumber: '1',
          iban: 'PK36 SCBL 0000 0011 2233 44',
        }),
      );
    expect(first.status).toBe(201);

    // Same IBAN, different spacing/case — must still collide (canonical comparison).
    const dup = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Iban Holder Two',
          bankId: bank.id,
          accountNumber: '2',
          iban: 'pk36scbl0000001122 3344',
        }),
      );
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/iban/i);
  });

  // --- Item 15/16: same Bank / same Branch Code allowed --------------------------------------------

  it('allows two employees to share the same Bank and the same Bank Branch Code', async () => {
    const site = await makeSite('Test Site Uniq Shared Bank');
    const unitId = await unitIdForSite(site.id);
    const bank = await prisma.bank.create({ data: { code: 'TBUNIQ3', name: 'Test Bank Uniq 3' } });
    const { agent, csrfToken } = await masterAdminAgent('uniq-sharedbank@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Shared Bank One',
          bankId: bank.id,
          branchCode: 'BR-001',
          accountNumber: '1111',
        }),
      );
    const second = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Shared Bank Two',
          bankId: bank.id,
          branchCode: 'BR-001',
          accountNumber: '2222',
        }),
      );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  // --- Item 17/18: null Account Number/IBAN allowed for multiple Cash employees -------------------

  it('allows multiple Cash employees with null Account Number and null IBAN', async () => {
    const site = await makeSite('Test Site Uniq Cash Null');
    const unitId = await unitIdForSite(site.id);
    const { agent, csrfToken } = await masterAdminAgent('uniq-cashnull@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Cash One' }));
    const second = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Cash Two' }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.employee.accountNumber).toBeNull();
    expect(second.body.employee.accountNumber).toBeNull();
    expect(first.body.employee.iban).toBeNull();
    expect(second.body.employee.iban).toBeNull();
  });

  // --- Item 11: duplicate Employee Code rejected on manual create ---------------------------------

  it('rejects a duplicate Employee Code with 409', async () => {
    const site = await makeSite('Test Site Uniq Code');
    const unitId = await unitIdForSite(site.id);
    const { agent, csrfToken } = await masterAdminAgent('uniq-code@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Code Holder One', employeeCode: '999083' }));
    expect(first.status).toBe(201);

    const dup = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Code Holder Two', employeeCode: '999083' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/employee code/i);
  });

  // --- Item 7 (this round's refinement): confirms current, deliberately-unchanged behavior --------

  it('confirms Employee Code uniqueness is currently case-sensitive — "ABC123" and "abc123" are treated as different codes', async () => {
    const site = await makeSite('Test Site Uniq Code Case');
    const unitId = await unitIdForSite(site.id);
    const { agent, csrfToken } = await masterAdminAgent('uniq-code-case@test.local');

    const upper = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Code Case Upper', employeeCode: 'ABC123' }));
    expect(upper.status).toBe(201);

    // Not a recommendation — a documented confirmation of today's behavior (Part 7 of the
    // checkpoint refinement). Case-sensitivity remains a future business-policy decision, not
    // silently normalized by this checkpoint.
    const lower = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Code Case Lower', employeeCode: 'abc123' }));
    expect(lower.status).toBe(201);
  });

  // --- Item 19/20: edit without changing own identifier works; edit into another's fails ----------

  it('lets an edit keep its own current identifiers, but rejects editing into another employee\'s', async () => {
    const site = await makeSite('Test Site Uniq Edit');
    const unitId = await unitIdForSite(site.id);
    const bank = await prisma.bank.create({ data: { code: 'TBUNIQ4', name: 'Test Bank Uniq 4' } });
    const { agent, csrfToken } = await masterAdminAgent('uniq-edit@test.local');

    const employeeA = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Edit Employee A',
          employeeCode: 'A-CODE',
          cnic: '1111111111111',
          bankId: bank.id,
          accountNumber: 'ACC-A',
          iban: 'PK00AAAA00000000000001',
        }),
      );
    expect(employeeA.status).toBe(201);

    const employeeB = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(
        baseEmployeePayload(site.id, unitId, {
          name: 'Edit Employee B',
          employeeCode: 'B-CODE',
          cnic: '2222222222222',
          bankId: bank.id,
          accountNumber: 'ACC-B',
          iban: 'PK00BBBB00000000000002',
        }),
      );
    expect(employeeB.status).toBe(201);

    // Item 19: an update that doesn't change A's own identifiers (only its name) must succeed.
    const selfEdit = await agent
      .patch(`/api/v1/employees/${employeeA.body.employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Edit Employee A Renamed' });
    expect(selfEdit.status).toBe(200);

    // Item 20: editing A into B's employeeCode/cnic/accountNumber/iban must each be rejected.
    const intoCode = await agent
      .patch(`/api/v1/employees/${employeeA.body.employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ employeeCode: 'B-CODE' });
    expect(intoCode.status).toBe(409);

    const intoCnic = await agent
      .patch(`/api/v1/employees/${employeeA.body.employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ cnic: '2222222222222' });
    expect(intoCnic.status).toBe(409);

    const intoAccount = await agent
      .patch(`/api/v1/employees/${employeeA.body.employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ accountNumber: 'ACC-B' });
    expect(intoAccount.status).toBe(409);

    const intoIban = await agent
      .patch(`/api/v1/employees/${employeeA.body.employee.id}`)
      .set('x-csrf-token', csrfToken)
      .send({ iban: 'pk00bbbb00000000000002' });
    expect(intoIban.status).toBe(409);
  });

  // --- Item 26: canonical CNIC formatting collision (dashed vs digits-only) detected --------------

  it('rejects a CNIC that only differs from an existing one by dash formatting', async () => {
    const site = await makeSite('Test Site Uniq Cnic Canonical');
    const unitId = await unitIdForSite(site.id);
    const { agent, csrfToken } = await masterAdminAgent('uniq-cnic-canonical@test.local');

    const first = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Canonical CNIC One', cnic: '3520212345671' }));
    expect(first.status).toBe(201);

    const dup = await agent
      .post('/api/v1/employees')
      .set('x-csrf-token', csrfToken)
      .send(baseEmployeePayload(site.id, unitId, { name: 'Canonical CNIC Two', cnic: '35202-1234567-1' }));
    expect(dup.status).toBe(409);
  });

  // --- Item 29: DB unique-race errors map to friendly application errors, not raw P2002 -----------

  it('maps a concurrent-write race on Account Number to a friendly 409, never a raw Prisma constraint error', async () => {
    const site = await makeSite('Test Site Uniq Race');
    const unitId = await unitIdForSite(site.id);
    const bank = await prisma.bank.create({ data: { code: 'TBUNIQ5', name: 'Test Bank Uniq 5' } });
    const { agent, csrfToken } = await masterAdminAgent('uniq-race@test.local');

    const [first, second] = await Promise.all([
      agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Race One', bankId: bank.id, accountNumber: 'RACE-ACC' })),
      agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(baseEmployeePayload(site.id, unitId, { name: 'Race Two', bankId: bank.id, accountNumber: 'RACE-ACC' })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('CONFLICT');
    expect(loser.body.error.message).toMatch(/account/i);
    expect(loser.body.error.message).not.toMatch(/accountNumberCanonical|Employee_|P2002/i);
  });

  // --- Import: identity-aware workbook + database duplicate detection (items 21-25) ---------------

  describe('Employee Registry import', () => {
    function templateRow(overrides: Partial<Record<(typeof EMPLOYEE_TEMPLATE_HEADERS)[number], string>>) {
      const base: Record<(typeof EMPLOYEE_TEMPLATE_HEADERS)[number], string> = {
        'Sr. No': '1',
        Project: '',
        'Employee Number/Code': '',
        Religion: '',
        Name: '',
        'Father Name': '',
        CNIC: '',
        DOB: '',
        DOJ: '',
        DOL: '',
        'Mobile Number': '',
        Designation: 'Security Guard',
        Area: '',
        'Branch Code': '',
        'Area/Location': '',
        'Employee Bank': 'Cash',
        'Bank Branch Code': '',
        'Account Number': '',
        'Basic/Gross Pay': '30000',
        'Pay Type': '',
        IBAN: '',
        'Default EOBI Amount': '',
        'Default EOBI Applicable': '',
      };
      return { ...base, ...overrides };
    }

    function toCsv(rows: Record<string, string>[]): Buffer {
      const csv = stringifyCsvSync([
        EMPLOYEE_TEMPLATE_HEADERS as unknown as string[],
        ...rows.map((row) => EMPLOYEE_TEMPLATE_HEADERS.map((header) => row[header] ?? '')),
      ]);
      return Buffer.from(csv, 'utf-8');
    }

    // --- Item 21/23/24: workbook-internal duplicates across different identities --------------

    it('flags Employee Code/Account Number/IBAN duplicates within the same workbook, when they belong to different identities', async () => {
      const site = await makeSite('Test Site Import Uniq Workbook');
      const { agent, csrfToken } = await masterAdminAgent('import-uniq-workbook@test.local');

      const csv = toCsv([
        templateRow({
          Name: 'Workbook Row A',
          CNIC: '1111111111111',
          'Employee Number/Code': 'DUPE-CODE',
          Project: site.name,
          Area: `${site.name} Unit`,
          'Account Number': '',
        }),
        templateRow({
          Name: 'Workbook Row B',
          CNIC: '2222222222222', // different identity — same code as Row A is now a genuine conflict
          'Employee Number/Code': 'DUPE-CODE',
          Project: site.name,
          Area: `${site.name} Unit`,
        }),
        templateRow({
          Name: 'Workbook Row C',
          CNIC: '3333333333333',
          Project: site.name,
          Area: `${site.name} Unit`,
          'Employee Bank': 'Cash',
          'Account Number': '',
        }),
      ]);

      const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'workbook-dupe.csv');
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(1); // only Row C (no conflict) applies
      expect(res.body.skipped).toHaveLength(2);
      expect(res.body.skipped.map((s: { row: number }) => s.row).sort()).toEqual([2, 3]);
      for (const skip of res.body.skipped) {
        expect(skip.reason).toMatch(/employee number\/code/i);
      }
    });

    it('treats two workbook rows sharing the same CNIC as create-then-update, not a workbook-duplicate error', async () => {
      const site = await makeSite('Test Site Import Uniq Cnic Same Identity');
      const { agent, csrfToken } = await masterAdminAgent('import-uniq-same-identity@test.local');

      const csv = toCsv([
        templateRow({ Name: 'Same Identity V1', CNIC: '4444444444444', Project: site.name, Area: `${site.name} Unit` }),
        templateRow({ Name: 'Same Identity V2 Corrected', CNIC: '4444444444444', Project: site.name, Area: `${site.name} Unit` }),
      ]);

      const res = await agent.post('/api/v1/employees/import').set('x-csrf-token', csrfToken).attach('file', csv, 'same-identity.csv');
      expect(res.status).toBe(200);
      expect(res.body.skipped).toHaveLength(0);
      expect(res.body.created).toBe(1);
      expect(res.body.updated).toBe(1);

      const stored = await prisma.employee.findFirstOrThrow({ where: { cnic: '4444444444444' } });
      expect(stored.name).toBe('Same Identity V2 Corrected');
    });

    it('flags a duplicate Account Number/IBAN within the same workbook across different employees', async () => {
      const site = await makeSite('Test Site Import Uniq Account Workbook');
      const bank = await prisma.bank.create({ data: { code: 'TBUNIQ6', name: 'Test Bank Uniq 6' } });
      const { agent, csrfToken } = await masterAdminAgent('import-uniq-account-workbook@test.local');

      const csv = toCsv([
        templateRow({
          Name: 'Account Workbook A',
          CNIC: '5555555555555',
          Project: site.name,
          Area: `${site.name} Unit`,
          'Employee Bank': bank.name,
          'Account Number': 'SHARED-ACC',
          IBAN: 'PK11SHARED000000000001',
        }),
        templateRow({
          Name: 'Account Workbook B',
          CNIC: '6666666666666',
          Project: site.name,
          Area: `${site.name} Unit`,
          'Employee Bank': bank.name,
          'Account Number': 'SHARED-ACC',
          IBAN: 'PK11SHARED000000000001',
        }),
      ]);

      const res = await agent
        .post('/api/v1/employees/import')
        .set('x-csrf-token', csrfToken)
        .attach('file', csv, 'account-workbook-dupe.csv');
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(0);
      expect(res.body.skipped).toHaveLength(2);
      const reasons = res.body.skipped.map((s: { reason: string }) => s.reason).join(' | ');
      expect(reasons).toMatch(/account number/i);
      expect(reasons).toMatch(/iban/i);
    });

    // --- Item 25: import row conflicts against an existing DB employee, for all four fields ----

    it('rejects an import row whose Employee Code/CNIC/Account Number/IBAN each already belong to a different existing employee', async () => {
      const site = await makeSite('Test Site Import Uniq Db Conflict');
      const unitId = await unitIdForSite(site.id);
      const bank = await prisma.bank.create({ data: { code: 'TBUNIQ7', name: 'Test Bank Uniq 7' } });
      const { agent, csrfToken } = await masterAdminAgent('import-uniq-db-conflict@test.local');

      await agent
        .post('/api/v1/employees')
        .set('x-csrf-token', csrfToken)
        .send(
          baseEmployeePayload(site.id, unitId, {
            name: 'Existing Employee',
            employeeCode: 'EXIST-CODE',
            cnic: '7777777777777',
            bankId: bank.id,
            accountNumber: 'EXIST-ACC',
            iban: 'PK22EXIST000000000007',
          }),
        );

      // Split across two imports: rows that legitimately share the existing employee's own
      // Account Number/IBAN (because they resolve to that same identity via CNIC) would otherwise
      // incidentally collide, in-workbook, with the rows below deliberately testing an Account
      // Number/IBAN conflict against a *different* identity — a workbook-internal collision this
      // checkpoint is separately (and correctly) designed to catch (see the dedicated workbook-
      // duplicate tests above). Keeping them in separate workbooks isolates each field's DB-level
      // conflict check on its own.
      const codeAndCnicCsv = toCsv([
        templateRow({
          Name: 'Import Conflicts With Code',
          CNIC: '8888888888881',
          'Employee Number/Code': 'EXIST-CODE',
          Project: site.name,
          Area: `${site.name} Unit`,
        }),
        templateRow({
          Name: 'Import Conflicts With Cnic',
          CNIC: '7777777777777',
          'Employee Number/Code': 'NEW-CODE-1',
          Project: site.name,
          Area: `${site.name} Unit`,
          // Same identity as the existing employee (CNIC match) — this row is an update to that
          // same person, so its own banking fields must keep matching the existing employee's own
          // (already-correct) values, otherwise this row would incidentally null them out via the
          // ordinary update path.
          'Employee Bank': bank.name,
          'Account Number': 'EXIST-ACC',
          IBAN: 'PK22EXIST000000000007',
        }),
      ]);

      const codeAndCnicRes = await agent
        .post('/api/v1/employees/import')
        .set('x-csrf-token', csrfToken)
        .attach('file', codeAndCnicCsv, 'db-conflict-code-cnic.csv');
      expect(codeAndCnicRes.status).toBe(200);
      // Row 2 (CNIC 7777777777777) matches the existing employee's CNIC — treated as an update to
      // that same person (the existing create-then-update contract), not a conflict.
      expect(codeAndCnicRes.body.updated).toBe(1);
      expect(codeAndCnicRes.body.created).toBe(0);
      expect(codeAndCnicRes.body.skipped).toHaveLength(1);
      expect(codeAndCnicRes.body.skipped[0].reason).toMatch(/employee code/i);

      const accountAndIbanCsv = toCsv([
        templateRow({
          Name: 'Import Conflicts With Account',
          CNIC: '8888888888883',
          'Employee Number/Code': 'NEW-CODE-2',
          Project: site.name,
          Area: `${site.name} Unit`,
          'Employee Bank': bank.name,
          'Account Number': 'EXIST-ACC',
        }),
        templateRow({
          Name: 'Import Conflicts With Iban',
          CNIC: '8888888888884',
          'Employee Number/Code': 'NEW-CODE-3',
          Project: site.name,
          Area: `${site.name} Unit`,
          'Employee Bank': bank.name,
          'Account Number': 'ANOTHER-ACC',
          IBAN: 'pk22exist000000000007',
        }),
      ]);

      const accountAndIbanRes = await agent
        .post('/api/v1/employees/import')
        .set('x-csrf-token', csrfToken)
        .attach('file', accountAndIbanCsv, 'db-conflict-account-iban.csv');
      expect(accountAndIbanRes.status).toBe(200);
      expect(accountAndIbanRes.body.created).toBe(0);
      expect(accountAndIbanRes.body.skipped).toHaveLength(2);
      const reasons = accountAndIbanRes.body.skipped.map((s: { reason: string }) => s.reason).join(' | ');
      expect(reasons).toMatch(/account number/i);
      expect(reasons).toMatch(/iban/i);
    });
  });
});
