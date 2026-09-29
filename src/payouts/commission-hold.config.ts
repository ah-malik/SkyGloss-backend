/** Portal (https://portal.skygloss.com/) hold — days after shipment. */
export const COMMISSION_HOLD_DAYS_PRODUCTION = 30;

/** Non-portal default when COMMISSION_HOLD_MINUTES is unset. */
export const COMMISSION_HOLD_MINUTES_DEV = 1;

const PORTAL_HOLD_HOST = 'portal.skygloss.com';

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** True only for the production portal host. Any other FRONTEND_URL uses the minute hold. */
export function isPortalCommissionHold(
  frontendUrl: string | undefined = process.env.FRONTEND_URL,
): boolean {
  const raw = (frontendUrl || '').trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.toLowerCase() === PORTAL_HOLD_HOST;
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase() === `https://${PORTAL_HOLD_HOST}`;
  }
}

/** Hold duration in milliseconds. Portal: days. Everywhere else: minutes. */
export function getCommissionHoldMs(): number {
  if (isPortalCommissionHold()) {
    const days = readPositiveNumber(
      process.env.COMMISSION_HOLD_DAYS,
      COMMISSION_HOLD_DAYS_PRODUCTION,
    );
    return days * 24 * 60 * 60 * 1000;
  }
  const minutes = readPositiveNumber(
    process.env.COMMISSION_HOLD_MINUTES,
    COMMISSION_HOLD_MINUTES_DEV,
  );
  return minutes * 60 * 1000;
}

export function computeCommissionAvailableAt(shippedAt: Date): Date {
  return new Date(shippedAt.getTime() + getCommissionHoldMs());
}

export function getCommissionHoldDescription(): string {
  if (isPortalCommissionHold()) {
    const days = readPositiveNumber(
      process.env.COMMISSION_HOLD_DAYS,
      COMMISSION_HOLD_DAYS_PRODUCTION,
    );
    return `${days} day(s) after shipment [portal]`;
  }
  const minutes = readPositiveNumber(
    process.env.COMMISSION_HOLD_MINUTES,
    COMMISSION_HOLD_MINUTES_DEV,
  );
  return `${minutes} minute(s) after shipment`;
}

/** Minute holds need a frequent release. The portal 30-day hold stays hourly. */
export function useFrequentCommissionReleaseCron(): boolean {
  return !isPortalCommissionHold();
}
