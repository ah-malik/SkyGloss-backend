/** Production default — 30 days after shipment */
export const COMMISSION_HOLD_DAYS_PRODUCTION = 30;

/** Development default — 1 minute after shipment */
export const COMMISSION_HOLD_MINUTES_DEV = 1;

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Hold duration in milliseconds (prod: days, dev: minutes) */
export function getCommissionHoldMs(): number {
  if (isProductionEnvironment()) {
    const days = Number(process.env.COMMISSION_HOLD_DAYS ?? COMMISSION_HOLD_DAYS_PRODUCTION);
    return days * 24 * 60 * 60 * 1000;
  }
  const minutes = Number(
    process.env.COMMISSION_HOLD_MINUTES ?? COMMISSION_HOLD_MINUTES_DEV,
  );
  return minutes * 60 * 1000;
}

export function computeCommissionAvailableAt(shippedAt: Date): Date {
  return new Date(shippedAt.getTime() + getCommissionHoldMs());
}

export function getCommissionHoldDescription(): string {
  if (isProductionEnvironment()) {
    const days = process.env.COMMISSION_HOLD_DAYS ?? COMMISSION_HOLD_DAYS_PRODUCTION;
    return `${days} day(s)`;
  }
  const minutes = process.env.COMMISSION_HOLD_MINUTES ?? COMMISSION_HOLD_MINUTES_DEV;
  return `${minutes} minute(s) [dev]`;
}

export function useFrequentCommissionReleaseCron(): boolean {
  return !isProductionEnvironment();
}
