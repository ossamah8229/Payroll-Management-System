import pino from 'pino';
import { env, isProduction } from '../config/env';

/**
 * Structured JSON logging in production (ready for log aggregation / Sentry breadcrumbs later),
 * human-readable pretty output in development. One configured instance, imported everywhere —
 * no module reaches for `console.log` directly (enforced by the `no-console` ESLint rule).
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug',
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
});
