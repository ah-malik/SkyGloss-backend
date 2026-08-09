import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
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

    const cookies = (req as any).cookies || {};
    const hasAuthCookie = !!(
      cookies[ACCESS_TOKEN_COOKIE] || cookies[REFRESH_TOKEN_COOKIE]
    );
    if (!hasAuthCookie) {
      return next();
    }

    // Logout must always succeed so stale/broken CSRF cannot trap a session.
    const path = ((req.originalUrl || req.url || '') as string).split('?')[0];
    if (path === '/auth/logout' || path.endsWith('/auth/logout')) {
      return next();
    }

    const csrfCookie = cookies[CSRF_TOKEN_COOKIE];
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
