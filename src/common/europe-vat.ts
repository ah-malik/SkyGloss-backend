import { roundMoney } from './order-monetary';

/**
 * Standard VAT rates (%) for European destinations.
 * 0 = explicitly no VAT (San Marino / Vatican).
 * null from lookup = country not in this table → do not auto-apply VAT.
 */
export const EUROPE_VAT_RATES_PERCENT: Record<string, number> = {
  denmark: 25,
  estonia: 24,
  finland: 25.5,
  iceland: 24,
  ireland: 23,
  latvia: 21,
  lithuania: 21,
  norway: 25,
  sweden: 25,
  'united kingdom': 20,
  uk: 20,
  england: 20,
  scotland: 20,
  wales: 20,
  'northern ireland': 20,
  gb: 20,
  austria: 20,
  belgium: 21,
  france: 20,
  germany: 19,
  liechtenstein: 8.1,
  luxembourg: 17,
  // Monaco uses the French VAT system
  monaco: 20,
  netherlands: 21,
  holland: 21,
  'the netherlands': 21,
  switzerland: 8.1,
  albania: 20,
  andorra: 4.5,
  'bosnia and herzegovina': 17,
  croatia: 25,
  cyprus: 19,
  greece: 24,
  italy: 22,
  kosovo: 18,
  malta: 18,
  montenegro: 21,
  portugal: 23,
  // No VAT / mono-phase — treat as 0%
  'san marino': 0,
  spain: 21,
  'vatican city': 0,
  'holy see': 0,
  'holy see (vatican city state)': 0,
  va: 0,
  'czech republic': 21,
  czechia: 21,
  hungary: 27,
  moldova: 20,
  poland: 23,
  romania: 21,
  serbia: 20,
  slovakia: 23,
  slovenia: 22,
};

/** Returns VAT % when country is in the Europe VAT table; otherwise null. */
export function getEuropeVatRatePercent(country?: string | null): number | null {
  const key = String(country || '')
    .toLowerCase()
    .trim();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(EUROPE_VAT_RATES_PERCENT, key)) {
    return EUROPE_VAT_RATES_PERCENT[key];
  }
  return null;
}

export function calculateEuropeVatAmount(
  taxableBase: number,
  country?: string | null,
): { rate: number; amount: number } {
  const rate = getEuropeVatRatePercent(country);
  const base = Math.max(0, Number(taxableBase) || 0);
  if (rate == null || rate <= 0 || base <= 0) {
    return { rate: rate ?? 0, amount: 0 };
  }
  return { rate, amount: roundMoney((base * rate) / 100) };
}

/**
 * Taxable base for order VAT = items subtotal after discount, excluding shipping.
 */
export function getOrderVatTaxableBase(
  itemsSubtotal: number,
  discount = 0,
): number {
  return roundMoney(Math.max(0, (Number(itemsSubtotal) || 0) - (Number(discount) || 0)));
}
