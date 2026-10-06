import {
  computeCommissionAvailableAt,
  getCommissionHoldMs,
  isPortalCommissionHold,
  useFrequentCommissionReleaseCron,
} from './commission-hold.config';

describe('commission hold config', () => {
  const originalUrl = process.env.FRONTEND_URL;
  const originalMinutes = process.env.COMMISSION_HOLD_MINUTES;
  const originalDays = process.env.COMMISSION_HOLD_DAYS;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalUrl;
    if (originalMinutes === undefined) delete process.env.COMMISSION_HOLD_MINUTES;
    else process.env.COMMISSION_HOLD_MINUTES = originalMinutes;
    if (originalDays === undefined) delete process.env.COMMISSION_HOLD_DAYS;
    else process.env.COMMISSION_HOLD_DAYS = originalDays;
  });

  it('uses 15 days only for the portal URL', () => {
    process.env.FRONTEND_URL = 'https://portal.skygloss.com/';
    process.env.COMMISSION_HOLD_MINUTES = '1';
    expect(isPortalCommissionHold()).toBe(true);
    expect(getCommissionHoldMs()).toBe(15 * 24 * 60 * 60 * 1000);
    expect(useFrequentCommissionReleaseCron()).toBe(false);
  });

  it('accepts the portal URL without a trailing slash', () => {
    process.env.FRONTEND_URL = 'https://portal.skygloss.com';
    expect(isPortalCommissionHold()).toBe(true);
    expect(getCommissionHoldMs()).toBe(15 * 24 * 60 * 60 * 1000);
  });

  it('uses COMMISSION_HOLD_MINUTES for every non-portal URL', () => {
    process.env.FRONTEND_URL = 'http://localhost:5173';
    process.env.COMMISSION_HOLD_MINUTES = '1';
    const shippedAt = new Date('2026-09-28T13:23:24.000Z');
    expect(isPortalCommissionHold()).toBe(false);
    expect(getCommissionHoldMs()).toBe(60 * 1000);
    expect(useFrequentCommissionReleaseCron()).toBe(true);
    expect(computeCommissionAvailableAt(shippedAt).toISOString()).toBe(
      '2026-09-28T13:24:24.000Z',
    );
  });
});
