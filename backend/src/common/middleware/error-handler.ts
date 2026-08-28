import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { Prisma } from '@prisma/client';
import { HttpError } from '../http-error';
import { logger } from '../../lib/logger';
import { isProduction } from '../../config/env';
import { CorrectionValidationError, type CorrectionValidationErrorCode } from '../../modules/corrections/corrections.types';
import { SettlementValidationError, type SettlementValidationErrorCode } from '../../modules/corrections/corrections.settlement.types';
import { MaterializationValidationError, type MaterializationOrchestrationErrorCode } from '../../modules/corrections/corrections.materialization.types';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Phase 6 Checkpoint 3 — `CorrectionValidationError` (`modules/corrections/corrections.types.ts`)
 * is a deliberately HTTP-agnostic domain error (Checkpoint 2's own design: pure calculation code
 * has no business knowing status codes exist). This is the one place that knowledge is added back
 * — every code maps to the status a REST client would expect, kept as a single exhaustive lookup
 * so a new code added later can't silently fall through to 500. `*_NOT_FOUND` codes mirror this
 * codebase's existing `notFound()` (404) convention; `REQUEST_NOT_PENDING` mirrors `conflict()`
 * (409, a resource-state conflict, same class as a stale optimistic-locking `version`); everything
 * else is a 400 — the caller's own input was invalid, not a resource-state or existence problem. */
const CORRECTION_ERROR_STATUS: Record<CorrectionValidationErrorCode, number> = {
  ENTRY_NOT_FOUND: 404,
  REQUEST_NOT_FOUND: 404,
  REVERSAL_TARGET_NOT_FOUND: 404,
  REQUEST_NOT_PENDING: 409,
  // Post-Phase-5 Stabilization Checkpoint 4B remediation — an authorization failure (mirrors
  // this codebase's existing forbidden() 403 convention), not a validation/resource-state one.
  SELF_REVIEW_NOT_ALLOWED: 403,
  UNSUPPORTED_FIELD: 400,
  IMMUTABLE_FIELD: 400,
  INVALID_ADJUSTMENT_TYPE: 400,
  SPLIT_WORK_LINE_RESTRICTED: 400,
  ZERO_DELTA: 400,
  INVALID_NUMERIC_VALUE: 400,
  ENTRY_NOT_RELEASED: 400,
  MALFORMED_ENUM_COMBINATION: 400,
  REVERSAL_TARGET_MISMATCH: 400,
  REVERSAL_SELF_REFERENCE: 400,
  PAYMENT_TIMING_REQUIRED: 400,
  RECOVERY_INSTALLMENT_AMOUNT_NOT_APPLICABLE: 400,
};

/** Phase 6 Checkpoint 4 — same discipline as `CORRECTION_ERROR_STATUS`, for
 * `SettlementValidationError` (`modules/corrections/corrections.settlement.types.ts`).
 * `BALANCE_ADJUSTMENT_NOT_FOUND` -> 404; `ALREADY_SETTLED`/`STALE_CONCURRENT_WRITE` -> 409
 * (resource-state conflicts, same class as `REQUEST_NOT_PENDING` above); everything else -> 400. */
const SETTLEMENT_ERROR_STATUS: Record<SettlementValidationErrorCode, number> = {
  BALANCE_ADJUSTMENT_NOT_FOUND: 404,
  ALREADY_SETTLED: 409,
  STALE_CONCURRENT_WRITE: 409,
  ZERO_SETTLEMENT_AMOUNT: 400,
  NEGATIVE_SETTLEMENT_AMOUNT: 400,
  INVALID_SETTLEMENT_AMOUNT: 400,
  OVER_SETTLEMENT: 400,
  RESERVED_AMOUNT_UNAVAILABLE: 400,
  WRONG_ADJUSTMENT_TYPE_FOR_PAYMENT: 400,
  DEPARTED_EMPLOYEE_RECOVERY_PENDING: 400,
  INVALID_BANK: 400,
  INVALID_CYCLE: 400,
};

/** Phase 6 Checkpoint 5 — same discipline, for `MaterializationValidationError`
 * (`modules/corrections/corrections.materialization.types.ts`). Per-adjustment ineligibility
 * (`ALREADY_MATERIALIZED`, `NO_AVAILABLE_AMOUNT`, etc.) is never thrown as an HTTP error — those
 * are typed `{ eligible: false, reason }` results, an expected outcome for a preview or batch scan,
 * not an exceptional one. Only orchestration-level failures (no target cycle at all, a missing
 * adjustment) reach here. */
const MATERIALIZATION_ERROR_STATUS: Record<MaterializationOrchestrationErrorCode, number> = {
  NO_CURRENT_DRAFT: 404,
  TARGET_NOT_DRAFT: 409,
  BALANCE_ADJUSTMENT_NOT_FOUND: 404,
};

/**
 * Single place every error in the request lifecycle funnels through. Zod validation errors and
 * typed `HttpError`s get a clean, predictable response; anything else is logged with full detail
 * server-side but never leaks internals (stack traces, raw error messages) to the client in
 * production.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof HttpError) {
    const body: ErrorResponseBody = {
      error: { code: err.code ?? 'ERROR', message: err.message },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // A `multer` upload middleware (CSV import, Company Logo upload) throws this itself, before the
  // route handler ever runs — a client-error (oversized file, wrong field name), not a server
  // fault, so it gets the same clean 4xx shape as every other validation error rather than falling
  // through to the generic 500 below. Every `multer` instance in this codebase already sets its own
  // `limits.fileSize`; this is the one place that limit's rejection is translated to a response.
  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file exceeds the maximum allowed size' : err.message;
    res.status(400).json({ error: { code: 'BAD_REQUEST', message } });
    return;
  }

  if (err instanceof CorrectionValidationError) {
    const body: ErrorResponseBody = {
      error: { code: err.code, message: err.message },
    };
    res.status(CORRECTION_ERROR_STATUS[err.code]).json(body);
    return;
  }

  if (err instanceof SettlementValidationError) {
    const body: ErrorResponseBody = {
      error: { code: err.code, message: err.message },
    };
    res.status(SETTLEMENT_ERROR_STATUS[err.code]).json(body);
    return;
  }

  if (err instanceof MaterializationValidationError) {
    const body: ErrorResponseBody = {
      error: { code: err.code, message: err.message },
    };
    res.status(MATERIALIZATION_ERROR_STATUS[err.code]).json(body);
    return;
  }

  // Known Prisma constraint violations get a clean 4xx response rather than falling through to
  // the generic 500 below — every CRUD module hits these (unique names/codes, RESTRICT deletes).
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      res.status(409).json({
        error: { code: 'DUPLICATE', message: `A record with this ${target} already exists` },
      });
      return;
    }

    if (err.code === 'P2003') {
      res.status(409).json({
        error: {
          code: 'REFERENCED_ELSEWHERE',
          message: 'This record cannot be deleted or changed because other records still reference it',
        },
      });
      return;
    }

    // Every id column in this schema is `@db.Uuid` (docs/architecture/database — every model's own
    // `id`/foreign-key columns), so a route param that isn't a well-formed UUID never reaches a
    // business-logic branch — it fails at the Postgres driver itself ("invalid input syntax for
    // type uuid"), which Prisma surfaces as P2023. That is client error (a malformed request), not
    // a server fault, and is handled once here rather than duplicating UUID-shape validation across
    // every module's own `requireIdParam` helper.
    if (err.code === 'P2023') {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'One or more identifiers in the request are malformed' },
      });
      return;
    }

    // Phase 6 Checkpoint 5 — a raw query (`$queryRaw`/`$executeRaw`, e.g.
    // `lockPayrollCycleForUpdate`'s `SELECT ... FOR UPDATE`) that fails at the database surfaces as
    // P2010, with the underlying Postgres SQLSTATE in `err.meta.code`. `40P01` (deadlock_detected)
    // and `40001` (serialization_failure) are both transient concurrency conflicts, not server
    // faults: this codebase's own documented lock order (cycle, then adjustment — see
    // `corrections.materialization.service.ts`) is a strict *program* order, but Postgres's deadlock
    // detector can still fire across two genuinely independent code paths that each hold one
    // resource and want the other (e.g. materialize holding the cycle's `FOR UPDATE` row lock while
    // waiting on the `BalanceAdjustment` advisory lock, racing a concurrent settlement that holds
    // that same advisory lock and then triggers an implicit FK-check lock on the very same cycle row
    // via `BalanceAdjustmentSettlement.cycleId`). Postgres itself resolves the cycle by aborting one
    // side — this maps that abort to the same 409 "reload and try again" class as
    // `STALE_CONCURRENT_WRITE`, rather than a misleading 500.
    if (err.code === 'P2010' && (err.meta?.code === '40P01' || err.meta?.code === '40001')) {
      res.status(409).json({
        error: { code: 'CONCURRENT_CONFLICT', message: 'This request conflicted with another in-progress change. Please try again.' },
      });
      return;
    }
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong' : String(err),
    },
  };
  res.status(500).json(body);
}
