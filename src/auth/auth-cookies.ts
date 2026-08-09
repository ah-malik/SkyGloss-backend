import { Response } from 'express';

export const ACCESS_TOKEN_COOKIE = 'sg_access_token';
export const REFRESH_TOKEN_COOKIE = 'sg_refresh_token';
export const CSRF_TOKEN_COOKIE = 'sg_csrf_token';

export interface AuthCookieTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
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

export function setAuthCookies(res: Response, tokens: AuthCookieTokens): void {
  const accessOpts = baseCookieOptions(tokens.accessMaxAgeMs);
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, accessOpts);

  if (tokens.refreshToken && tokens.refreshMaxAgeMs > 0) {
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...baseCookieOptions(tokens.refreshMaxAgeMs),
      // Limit refresh cookie to auth routes
      path: '/auth',
    });
  }

  const csrfMaxAge =
    tokens.refreshMaxAgeMs > 0 ? tokens.refreshMaxAgeMs : tokens.accessMaxAgeMs;
  setCsrfCookie(res, tokens.csrfToken, csrfMaxAge);
}

export function setCsrfCookie(
  res: Response,
  csrfToken: string,
  maxAgeMs: number,
): void {
  res.cookie(CSRF_TOKEN_COOKIE, csrfToken, {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'none',
    path: '/',
    maxAge: maxAgeMs,
  });
  res.setHeader('X-CSRF-Token', csrfToken);
}

export function clearAuthCookies(res: Response): void {
  const clearBase = {
    httpOnly: true as const,
    secure: cookieSecure(),
    sameSite: 'none' as const,
    path: '/',
  };
  res.clearCookie(ACCESS_TOKEN_COOKIE, clearBase);
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...clearBase, path: '/auth' });
  res.clearCookie(CSRF_TOKEN_COOKIE, {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'none',
    path: '/',
  });
}

/** Parse duration strings like 15m, 1h, 7d into milliseconds. */
export function parseDurationToMs(value: string | undefined, fallbackMs: number): number {
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
