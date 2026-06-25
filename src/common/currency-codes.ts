import { SYSTEM_BASE_CURRENCY } from './order-monetary';

/** ISO 4217 codes that display with $ but are NOT USD. */
export const DOLLAR_ISO_CURRENCIES = new Set([
  'USD',
  'CAD',
  'AUD',
  'NZD',
  'SGD',
  'HKD',
  'MXN',
  'ARS',
  'CLP',
  'COP',
  'BRL',
  'TWD',
  'XCD',
]);

/**
 * Default rates: 1 unit of currency → USD (base).
 * Admin can override in DB; past orders keep locked rates.
 */
export const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  PKR: 0.003571,
  CAD: 0.72,
  AUD: 0.65,
  NZD: 0.58,
  INR: 0.012,
  NOK: 0.093,
  CHF: 1.12,
  AED: 0.27,
  SAR: 0.27,
  SGD: 0.74,
  HKD: 0.13,
  JPY: 0.0067,
  BRL: 0.17,
  MXN: 0.049,
  ZAR: 0.055,
  TRY: 0.028,
  CNY: 0.14,
  SEK: 0.095,
  DKK: 0.14,
  PLN: 0.25,
  CZK: 0.043,
};

const SYMBOL_ALIASES: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
};

/**
 * Normalize to uppercase ISO 4217 code.
 * Never map bare "$" to USD — CAD/AUD/etc. must stay distinct by code.
 */
export function normalizeCurrencyCode(input?: string | null): string {
  const raw = (input || '').trim();
  if (!raw) return SYSTEM_BASE_CURRENCY;

  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) {
    return upper;
  }

  if (SYMBOL_ALIASES[raw]) {
    return SYMBOL_ALIASES[raw];
  }

  if (raw === '$' || upper === '$') {
    return SYSTEM_BASE_CURRENCY;
  }

  return upper.slice(0, 3);
}

export function isUsdCurrency(code?: string | null): boolean {
  return normalizeCurrencyCode(code) === SYSTEM_BASE_CURRENCY;
}

export function getCurrencyDisplaySymbol(code?: string | null): string {
  const normalized = normalizeCurrencyCode(code);
  const symbols: Record<string, string> = {
    USD: '$',
    CAD: 'CA$',
    AUD: 'A$',
    NZD: 'NZ$',
    SGD: 'S$',
    HKD: 'HK$',
    MXN: 'MX$',
    BRL: 'R$',
    EUR: '€',
    GBP: '£',
    PKR: 'Rs ',
    INR: '₹',
    JPY: '¥',
    CHF: 'CHF ',
    AED: 'AED ',
    SAR: 'SR ',
  };
  return symbols[normalized] || `${normalized} `;
}
