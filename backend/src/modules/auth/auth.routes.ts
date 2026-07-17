import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, loginSchema, updateProfileSchema } from '@payroll/shared';
import { isTest } from '../../config/env';
import { requireAuth } from '../../common/middleware/attach-user';
import { recordAuditLog } from '../audit-log/audit-log.service';
import {
  changeOwnPassword,
  loadSessionUser,
  touchLastLogin,
  updateOwnProfile,
  verifyCredentials,
} from './auth.service';

export const authRouter = Router();

/**
 * A basic brute-force throttle on the login endpoint specifically — 10 attempts per IP per
 * 15-minute window. Deliberately simple (in-memory, per-process) for Phase 1; revisit if this
 * system is ever deployed behind multiple backend instances, at which point a shared store
 * (the same Postgres/Redis this system already uses) would replace the in-memory default.
 *
 * Relaxed (not disabled) under NODE_ENV=test only: the integration suite performs one real
 * login per test from a single supertest IP, which legitimately exceeds 10 per window — the
 * production limit is unchanged.
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again later.' } },
});

authRouter.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const userId = await verifyCredentials(email, password);

    if (!userId) {
      await recordAuditLog({
        actorUserId: null,
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: null,
        metadata: { email },
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      return;
    }

    // Regenerate the session on privilege change (login) to prevent session-fixation attacks —
    // a session ID issued before authentication is never reused as the authenticated session ID.
    req.session.regenerate(async (regenerateError) => {
      if (regenerateError) {
        next(regenerateError);
        return;
      }

      req.session.userId = userId;

      await touchLastLogin(userId);
      await recordAuditLog({
        actorUserId: userId,
        action: 'auth.login.success',
        entityType: 'User',
        entityId: userId,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      const sessionUser = await loadSessionUser(userId);
      res.status(200).json({ user: sessionUser });
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', requireAuth, (req, res, next) => {
  const userId = req.currentUser?.id ?? null;

  req.session.destroy(async (error) => {
    if (error) {
      next(error);
      return;
    }

    res.clearCookie('connect.sid');

    if (userId) {
      await recordAuditLog({
        actorUserId: userId,
        action: 'auth.logout',
        entityType: 'User',
        entityId: userId,
      });
    }

    res.status(204).send();
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.status(200).json({ user: req.currentUser });
});

authRouter.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const input = updateProfileSchema.parse(req.body);
    await updateOwnProfile(req.currentUser!.id, input);

    await recordAuditLog({
      actorUserId: req.currentUser!.id,
      action: 'user.profile-updated',
      entityType: 'User',
      entityId: req.currentUser!.id,
      metadata: { changes: input },
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    const sessionUser = await loadSessionUser(req.currentUser!.id);
    res.status(200).json({ user: sessionUser });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const input = changePasswordSchema.parse(req.body);
    const userId = req.currentUser!.id;
    await changeOwnPassword(userId, input);

    await recordAuditLog({
      actorUserId: userId,
      action: 'user.password-changed',
      entityType: 'User',
      entityId: userId,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // AUD-009: `changeOwnPassword` already deleted every session row for this user, including
    // this very request's own — `req.session.destroy()` here (same pattern as `/logout`) clears
    // this request's own cookie too, rather than leaving the client holding a cookie that only
    // fails on its *next* use.
    req.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }
      res.clearCookie('connect.sid');
      res.status(204).send();
    });
  } catch (error) {
    next(error);
  }
});
