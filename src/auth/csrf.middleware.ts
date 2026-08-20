import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  readAccessTokenFromCookies,
  readCsrfTokenFromCookies,
  readRefreshTokenFromCookies,
  resolveAuthCookieScope,
} from './auth-cookies';

/**
 * Double-submit CSRF for cookie-based sessions.
 * Skipped when:
 * - Safe HTTP methods
 * - Authorization: Bearer is present (Swagger / impersonation bootstrap)
 * - No auth cookies (public endpoints like login/register)
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return next();
    }

    const scope = resolveAuthCookieScope(req);
    const cookies = (req as any).cookies || {};
    const hasAuthCookie = !!(
      readAccessTokenFromCookies(cookies, scope) ||
      readRefreshTokenFromCookies(cookies, scope)
    );
    if (!hasAuthCookie) {
      return next();
    }

    // Auth bootstrap / session teardown must not require a prior CSRF match.
    // Stale access/refresh cookies are common when re-logging in from admin/portal;
    // requiring the old CSRF token would block login forever.
    const path = ((req.originalUrl || req.url || '') as string).split('?')[0];
    const csrfExemptExact = new Set([
      '/auth/login',
      '/auth/login/access-code',
      '/auth/register',
      '/auth/register-partner',
      '/auth/register-shop',
      '/auth/validate-shop-registration-coupon',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/logout',
      '/auth/refresh',
      '/auth/establish-session',
      '/webhooks/wise',
    ]);
    const normalizedPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
    if (
      csrfExemptExact.has(normalizedPath) ||
      [...csrfExemptExact].some((p) => normalizedPath.endsWith(p))
    ) {
      return next();
    }

    const csrfCookie = readCsrfTokenFromCookies(cookies, scope);
    const csrfHeader = req.headers['x-csrf-token'];
    if (
      !csrfCookie ||
      !csrfHeader ||
      typeof csrfHeader !== 'string' ||
      csrfCookie !== csrfHeader
    ) {
      return res.status(403).json({
        statusCode: 403,
        message: 'Invalid or missing CSRF token',
        error: 'Forbidden',
      });
    }

    return next();
  }
}
