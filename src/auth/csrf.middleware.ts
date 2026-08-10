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

    // Logout must always succeed so stale/broken CSRF cannot trap a session.
    const path = ((req.originalUrl || req.url || '') as string).split('?')[0];
    if (path === '/auth/logout' || path.endsWith('/auth/logout')) {
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
