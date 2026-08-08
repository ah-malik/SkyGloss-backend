import { Request } from 'express';

export interface ParsedClientMeta {
  ipAddress?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  device?: string;
}

function normalizeIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  const trimmed = ip.trim();
  if (trimmed === '::1' || trimmed === '::ffff:127.0.0.1') return '127.0.0.1';
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

/** Lightweight UA parse — enough for admin audit display. */
export function parseUserAgent(ua?: string): {
  browser?: string;
  os?: string;
  device?: string;
} {
  if (!ua) return {};

  let browser = 'Unknown browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/Windows NT 10/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let device = 'Desktop';
  if (/Mobile|Android|iPhone|iPod/i.test(ua)) device = 'Mobile';
  else if (/iPad|Tablet/i.test(ua)) device = 'Tablet';

  return { browser, os, device };
}

/** Extract client IP / UA / device summary from Express request. */
export function getRequestMeta(req?: Request | any): ParsedClientMeta {
  if (!req) return {};

  const forwarded = req.headers?.['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : undefined;

  const rawIp =
    forwardedIp ||
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress;

  const userAgent =
    typeof req.headers?.['user-agent'] === 'string'
      ? req.headers['user-agent']
      : undefined;

  return {
    ipAddress: normalizeIp(typeof rawIp === 'string' ? rawIp : undefined),
    userAgent,
    ...parseUserAgent(userAgent),
  };
}
