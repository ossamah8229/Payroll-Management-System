import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
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
