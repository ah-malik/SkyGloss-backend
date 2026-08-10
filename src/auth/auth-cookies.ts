import { Response } from 'express';

/** Legacy shared names — cleared on every new login so admin/portal no longer collide. */
export const LEGACY_ACCESS_TOKEN_COOKIE = 'sg_access_token';
export const LEGACY_REFRESH_TOKEN_COOKIE = 'sg_refresh_token';
export const LEGACY_CSRF_TOKEN_COOKIE = 'sg_csrf_token';

/** @deprecated use resolveCookieNames() — kept for Swagger / docs */
export const ACCESS_TOKEN_COOKIE = LEGACY_ACCESS_TOKEN_COOKIE;
export const REFRESH_TOKEN_COOKIE = LEGACY_REFRESH_TOKEN_COOKIE;
export const CSRF_TOKEN_COOKIE = LEGACY_CSRF_TOKEN_COOKIE;

export type AuthCookieScope = 'portal' | 'admin';

export interface AuthCookieNames {
  access: string;
  refresh: string;
  csrf: string;
}

export interface AuthCookieTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

export function resolveAuthCookieScope(req?: {
  headers?: Record<string, unknown>;
}): AuthCookieScope {
  const raw = req?.headers?.['x-client-app'];
  const app = (Array.isArray(raw) ? raw[0] : raw);
  return String(app || '').toLowerCase() === 'admin' ? 'admin' : 'portal';
}

export function resolveCookieNames(scope: AuthCookieScope): AuthCookieNames {
  if (scope === 'admin') {
    return {
      access: 'sg_admin_access_token',
      refresh: 'sg_admin_refresh_token',
      csrf: 'sg_admin_csrf_token',
    };
  }
  return {
    access: 'sg_portal_access_token',
    refresh: 'sg_portal_refresh_token',
    csrf: 'sg_portal_csrf_token',
  };
}

function cookieSecure(): boolean {
  // Cross-site SPAs (portal/admin → API) require SameSite=None + Secure.
  // Localhost browsers allow Secure cookies on http://localhost.
  if (process.env.COOKIE_SECURE === 'false') return false;
  return true;
}

function baseCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true as const,
    secure: cookieSecure(),
    sameSite: 'none' as const,
    path: '/',
    maxAge: maxAgeMs,
  };
}

function clearCookiePair(
  res: Response,
  name: string,
  opts: { httpOnly: boolean; path: string },
) {
  res.clearCookie(name, {
    httpOnly: opts.httpOnly,
    secure: cookieSecure(),
    sameSite: 'none',
    path: opts.path,
  });
}

/** Wipe pre-scoped cookies so an old admin session cannot refresh on the portal. */
export function clearLegacyAuthCookies(res: Response): void {
  clearCookiePair(res, LEGACY_ACCESS_TOKEN_COOKIE, {
    httpOnly: true,
    path: '/',
  });
  clearCookiePair(res, LEGACY_REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    path: '/auth',
  });
  clearCookiePair(res, LEGACY_CSRF_TOKEN_COOKIE, {
    httpOnly: false,
    path: '/',
  });
}

export function clearAuthCookies(
  res: Response,
  scope: AuthCookieScope = 'portal',
): void {
  const names = resolveCookieNames(scope);
  clearCookiePair(res, names.access, { httpOnly: true, path: '/' });
  clearCookiePair(res, names.refresh, { httpOnly: true, path: '/auth' });
  clearCookiePair(res, names.csrf, { httpOnly: false, path: '/' });
  clearLegacyAuthCookies(res);
}

export function setCsrfCookie(
  res: Response,
  csrfToken: string,
  maxAgeMs: number,
  scope: AuthCookieScope = 'portal',
): void {
  const names = resolveCookieNames(scope);
  res.cookie(names.csrf, csrfToken, {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'none',
    path: '/',
    maxAge: maxAgeMs,
  });
  res.setHeader('X-CSRF-Token', csrfToken);
}

export function setAuthCookies(
  res: Response,
  tokens: AuthCookieTokens,
  scope: AuthCookieScope = 'portal',
): void {
  const names = resolveCookieNames(scope);
  // Always drop legacy shared cookies when writing a scoped session.
  clearLegacyAuthCookies(res);

  const accessOpts = baseCookieOptions(tokens.accessMaxAgeMs);
  res.cookie(names.access, tokens.accessToken, accessOpts);

  if (tokens.refreshToken && tokens.refreshMaxAgeMs > 0) {
    res.cookie(names.refresh, tokens.refreshToken, {
      ...baseCookieOptions(tokens.refreshMaxAgeMs),
      path: '/auth',
    });
  } else {
    // Impersonation / access-only: do not leave a stale refresh for this portal.
    clearCookiePair(res, names.refresh, { httpOnly: true, path: '/auth' });
  }

  const csrfMaxAge =
    tokens.refreshMaxAgeMs > 0 ? tokens.refreshMaxAgeMs : tokens.accessMaxAgeMs;
  setCsrfCookie(res, tokens.csrfToken, csrfMaxAge, scope);
}

export function readAccessTokenFromCookies(
  cookies: Record<string, string | undefined> | undefined,
  scope: AuthCookieScope,
): string | null {
  if (!cookies) return null;
  const names = resolveCookieNames(scope);
  const scoped = cookies[names.access];
  if (typeof scoped === 'string' && scoped.length > 0) return scoped;
  // Migration: legacy shared cookie (cleared on next login).
  const legacy = cookies[LEGACY_ACCESS_TOKEN_COOKIE];
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return null;
}

export function readRefreshTokenFromCookies(
  cookies: Record<string, string | undefined> | undefined,
  scope: AuthCookieScope,
): string | null {
  if (!cookies) return null;
  const names = resolveCookieNames(scope);
  const scoped = cookies[names.refresh];
  if (typeof scoped === 'string' && scoped.length > 0) return scoped;
  const legacy = cookies[LEGACY_REFRESH_TOKEN_COOKIE];
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return null;
}

export function readCsrfTokenFromCookies(
  cookies: Record<string, string | undefined> | undefined,
  scope: AuthCookieScope,
): string | null {
  if (!cookies) return null;
  const names = resolveCookieNames(scope);
  const scoped = cookies[names.csrf];
  if (typeof scoped === 'string' && scoped.length > 0) return scoped;
  const legacy = cookies[LEGACY_CSRF_TOKEN_COOKIE];
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return null;
}

/** Parse duration strings like 15m, 1h, 7d into milliseconds. */
export function parseDurationToMs(
  value: string | undefined,
  fallbackMs: number,
): number {
  if (!value) return fallbackMs;
  const match = /^(\d+)(ms|s|m|h|d)$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const mult: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (mult[unit] || 1);
}
