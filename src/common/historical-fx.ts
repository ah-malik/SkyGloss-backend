import { DEFAULT_EXCHANGE_RATES, normalizeCurrencyCode } from './currency-codes';
import { SYSTEM_BASE_CURRENCY, roundExchangeRate } from './order-monetary';

function toFrankfurterDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetch 1 unit of `currency` → USD for a specific calendar date (Frankfurter).
 * Used when backfilling legacy orders so FX matches the order receipt date.
 */
export async function fetchHistoricalRateToBase(
  currency: string,
  date: Date,
): Promise<number> {
  const code = normalizeCurrencyCode(currency);
  if (code === SYSTEM_BASE_CURRENCY) return 1;

  const dateStr = toFrankfurterDate(date);
  const url = `https://api.frankfurter.app/${dateStr}?from=USD&to=${code}`;

  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as { rates?: Record<string, number> };
      const unitsPerUsd = data.rates?.[code];
      if (unitsPerUsd && unitsPerUsd > 0) {
        return roundExchangeRate(1 / unitsPerUsd);
      }
    }
  } catch {
    // fall through to defaults
  }

  const fallback = DEFAULT_EXCHANGE_RATES[code];
  if (fallback && fallback > 0) {
    return roundExchangeRate(fallback);
  }

  return 0;
}
