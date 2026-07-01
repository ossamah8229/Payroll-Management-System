import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../http-error';
import { logger } from '../../lib/logger';
import { isProduction } from '../../config/env';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

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

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong' : String(err),
    },
  };
  res.status(500).json(body);
}
