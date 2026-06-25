import { normalizeCurrencyCode } from './currency-codes';

export const SYSTEM_BASE_CURRENCY = 'USD';

export const REPORTING_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'PKR',
  'CAD',
  'AUD',
  'NZD',
  'INR',
] as const;

export type ReportingCurrency = (typeof REPORTING_CURRENCIES)[number];

/** Order amounts: 2 decimal places. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** FX rates need higher precision — roundMoney(0.0036) would incorrectly become 0. */
export function roundExchangeRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function buildLockedMonetaryFields(
  totalAmount: number,
  currency: string,
  exchangeRateAtOrderTime: number,
) {
  const originalCurrency = normalizeCurrencyCode(currency);
  const originalAmount = roundMoney(totalAmount);
  const rate = roundExchangeRate(exchangeRateAtOrderTime);
  if (originalCurrency !== SYSTEM_BASE_CURRENCY && rate <= 0) {
    throw new Error(
      `Invalid exchange rate for ${originalCurrency}: ${exchangeRateAtOrderTime}`,
    );
  }

  return {
    currency: originalCurrency,
    totalAmount: originalAmount,
    originalCurrency,
    originalAmount,
    exchangeRateAtOrderTime: rate,
    baseCurrency: SYSTEM_BASE_CURRENCY,
    baseCurrencyAmount: roundMoney(originalAmount * rate),
  };
}

/** Recalculate base amount when total changes but locked rate must stay. */
export function recalculateBaseWithLockedRate(
  newOriginalAmount: number,
  lockedRate: number,
) {
  const originalAmount = roundMoney(newOriginalAmount);
  return {
    totalAmount: originalAmount,
    originalAmount,
    baseCurrencyAmount: roundMoney(originalAmount * lockedRate),
  };
}

export function getEffectiveBaseAmount(order: {
  baseCurrencyAmount?: number;
  totalAmount?: number;
  currency?: string;
}): number {
  if (typeof order.baseCurrencyAmount === 'number') {
    return order.baseCurrencyAmount;
  }
  const currency = (order.currency || SYSTEM_BASE_CURRENCY).toUpperCase();
  if (currency === SYSTEM_BASE_CURRENCY) {
    return roundMoney(order.totalAmount || 0);
  }
  return roundMoney(order.totalAmount || 0);
}

export const SALES_REPORT_STATUSES = ['PAID', 'SHIPPED', 'DELIVERED'] as const;

/** MongoDB expression: effective base amount for legacy orders without locked FX fields. */
export const EFFECTIVE_BASE_AMOUNT_EXPR = {
  $ifNull: ['$baseCurrencyAmount', '$totalAmount'],
} as const;

export const EFFECTIVE_ORIGINAL_CURRENCY_EXPR = {
  $toUpper: { $ifNull: ['$originalCurrency', { $ifNull: ['$currency', 'USD'] }] },
} as const;

export const EFFECTIVE_ORIGINAL_AMOUNT_EXPR = {
  $ifNull: ['$originalAmount', '$totalAmount'],
} as const;
