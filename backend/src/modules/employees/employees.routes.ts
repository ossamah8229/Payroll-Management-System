import { Router } from 'express';
import multer from 'multer';
import {
  createEmployeeSchema,
  markEmployeeLeftSchema,
  PERMISSIONS,
  updateEmployeeSchema,
} from '@payroll/shared';
import { requireAuth } from '../../common/middleware/attach-user';
import { requirePermission } from '../../common/middleware/require-permission';
import { badRequest } from '../../common/http-error';
import { recordAuditLog } from '../audit-log/audit-log.service';
import {
  checkCnicAvailability,
  createEmployee,
  getEmployee,
  listEmployees,
  markEmployeeLeft,
  reactivateEmployee,
  updateEmployee,
} from './employees.service';
import { exportEmployeesToCsv, exportEmployeesToXlsx, importEmployees, parseEmployeeImportFile } from './employees-import-export.service';

export const employeesRouter = Router();

employeesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireIdParam(id: string | undefined): string {
  if (!id) throw badRequest('id parameter is required');
  return id;
}

function parseSiteIdsQuery(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value) => String(value).split(',')).filter(Boolean);
}

employeesRouter.get('/export', requirePermission(PERMISSIONS.EMPLOYEES_VIEW), async (req, res, next) => {
  try {
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const siteIds = parseSiteIdsQuery(req.query.siteIds);

    const buffer =
      format === 'xlsx'
        ? await exportEmployeesToXlsx(req.currentUser!, siteIds)
        : await exportEmployeesToCsv(req.currentUser!, siteIds);

    const filename = `employee-registry.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
    );
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
});

employeesRouter.post(
  '/import',
  requirePermission(PERMISSIONS.EMPLOYEES_CREATE),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw badRequest('No file uploaded — expected a multipart field named "file"');
      }

      const rows = await parseEmployeeImportFile(req.file.buffer, req.file.originalname);
      const result = await importEmployees(req.currentUser!, rows, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      await recordAuditLog({
        actorUserId: req.currentUser!.id,
        action: 'employee.import',
        entityType: 'Employee',
        metadata: {
          created: result.created,
          updated: result.updated,
          skippedCount: result.skipped.length,
        },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

employeesRouter.get('/', requirePermission(PERMISSIONS.EMPLOYEES_VIEW), async (req, res, next) => {
  try {
    const employees = await listEmployees(req.currentUser!, {
      siteIds: parseSiteIdsQuery(req.query.siteIds),
      activeOnly: req.query.activeOnly === 'true',
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    res.status(200).json({ employees });
  } catch (error) {
    next(error);
  }
});

// Registered ahead of GET /:id — otherwise Express would match "check-cnic" as an :id param.
employeesRouter.get('/check-cnic', requirePermission(PERMISSIONS.EMPLOYEES_VIEW), async (req, res, next) => {
  try {
    const cnic = typeof req.query.cnic === 'string' ? req.query.cnic : '';
    const excludeEmployeeId = typeof req.query.excludeId === 'string' ? req.query.excludeId : undefined;
    const result = await checkCnicAvailability(req.currentUser!, cnic, excludeEmployeeId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

employeesRouter.get('/:id', requirePermission(PERMISSIONS.EMPLOYEES_VIEW), async (req, res, next) => {
  try {
    const employee = await getEmployee(req.currentUser!, requireIdParam(req.params.id));
    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
});

employeesRouter.post('/', requirePermission(PERMISSIONS.EMPLOYEES_CREATE), async (req, res, next) => {
  try {
    const input = createEmployeeSchema.parse(req.body);
    const employee = await createEmployee(req.currentUser!, input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      metadata: { name: employee.name, siteId: employee.siteId },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(201).json({ employee });
  } catch (error) {
    next(error);
  }
});

employeesRouter.patch('/:id', requirePermission(PERMISSIONS.EMPLOYEES_EDIT), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updateEmployeeSchema.parse(req.body);
    // Audit logging (both the transfer-specific and generic-update entries) happens inside
    // updateEmployee itself, in the same transaction as the Employee row update and, when a
    // transfer occurs, the EmployeeTransferHistory insert — not here, so the route never needs to
    // (and must not) log a second, redundant employee.updated entry after the fact.
    const { employee } = await updateEmployee(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
});

employeesRouter.post('/:id/reactivate', requirePermission(PERMISSIONS.EMPLOYEES_EDIT), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = updateEmployeeSchema.parse(req.body);
    // Same as PATCH /:id — reactivateEmployee owns all audit logging (employee.reactivated, plus
    // employee.transferred when a transfer co-occurs) inside its own transaction, so the route
    // never logs a second, redundant entry after the fact.
    const { employee } = await reactivateEmployee(req.currentUser!, id, input, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
});

employeesRouter.post('/:id/leave', requirePermission(PERMISSIONS.EMPLOYEES_EDIT), async (req, res, next) => {
  try {
    const id = requireIdParam(req.params.id);
    const input = markEmployeeLeftSchema.parse(req.body);
    const employee = await markEmployeeLeft(req.currentUser!, id, input);

    // Distinct from `employee.updated` per docs/architecture/database/employee.md §9 — a
    // dateOfLeaving change is a business event in its own right, not an incidental field edit.
    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'employee.left',
      entityType: 'Employee',
      entityId: employee.id,
      metadata: { dateOfLeaving: input.dateOfLeaving },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
});
