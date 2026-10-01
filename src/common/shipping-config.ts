// Shipping configuration for North America & Europe regions
// Excluded countries: Russia, Ukraine, Turkey, North Macedonia, Belarus
// Bulgaria: always charged fixed €25 (no free-shipping threshold)
// Other countries: $25 USD fee / free at $500 USD, both converted to price-group currency

export const EXCLUDED_COUNTRIES = [
  'russia', 'ukraine', 'turkey', 'north macedonia', 'belarus',
  'türkiye',
];

/** Countries that always pay the flat shipping fee (never free over threshold). */
export const FIXED_SHIPPING_COUNTRIES = ['bulgaria'];

export const NORTH_AMERICA_COUNTRIES = [
  'united states', 'usa', 'us', 'united states of america',
  'canada',
  'mexico',
  'antigua and barbuda', 'bahamas', 'barbados', 'belize', 'costa rica',
  'cuba', 'dominica', 'dominican republic', 'el salvador', 'grenada',
  'guatemala', 'haiti', 'honduras', 'jamaica', 'nicaragua', 'panama',
  'saint kitts and nevis', 'saint lucia', 'saint vincent and the grenadines',
  'trinidad and tobago', 'puerto rico',
];

export const EUROPE_COUNTRIES = [
  'albania', 'andorra', 'austria',
  'belgium', 'bosnia and herzegovina',
  'croatia', 'cyprus', 'czech republic', 'czechia',
  'denmark',
  'estonia',
  'finland', 'france',
  'germany', 'greece',
  'hungary',
  'iceland', 'ireland', 'italy',
  'kosovo',
  'latvia', 'liechtenstein', 'lithuania', 'luxembourg',
  'malta', 'moldova', 'monaco', 'montenegro',
  'netherlands', 'holland', 'the netherlands', 'norway',
  'poland', 'portugal',
  'romania',
  'san marino', 'serbia', 'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland',
  'united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland',
  'vatican city', 'holy see', 'holy see (vatican city state)',
];

export const SHIPPING_FEE_THRESHOLD = 500; // $500 or €500 (NA / EU)
export const SHIPPING_FEE_AMOUNT = 25; // $25 or €25 (NA / EU)
/** USD baseline used for other-country free-shipping threshold. */
export const FREE_SHIPPING_USD_THRESHOLD = 500;

export type ShippingFeeOptions = {
  /** 1 unit of order currency → USD (existing exchange-rate rateToBase). */
  rateToUsd?: number;
};

function roundShippingMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Convert a USD amount into local price-group currency using rateToBase. */
export function usdToLocalAmount(usdAmount: number, rateToUsd: number): number {
  if (!rateToUsd || rateToUsd <= 0) return usdAmount;
  return roundShippingMoney(usdAmount / rateToUsd);
}

export function isExcludedShippingCountry(country: string): boolean {
  if (!country) return false;
  return EXCLUDED_COUNTRIES.includes(country.toLowerCase().trim());
}

export function hasFixedShippingFee(country: string): boolean {
  if (!country) return false;
  return FIXED_SHIPPING_COUNTRIES.includes(country.toLowerCase().trim());
}

export function getShippingRegion(country: string): 'NA' | 'EU' | null {
  if (!country) return null;
  const c = country.toLowerCase().trim();
  if (EXCLUDED_COUNTRIES.includes(c)) return null;
  if (NORTH_AMERICA_COUNTRIES.includes(c)) return 'NA';
  if (EUROPE_COUNTRIES.includes(c)) return 'EU';
  return null;
}

/**
 * Free-shipping threshold in the order's price-group currency.
 * NA/EU → literal 500. Other countries → $500 USD equivalent when rate is available.
 */
export function getFreeShippingThreshold(
  country: string,
  options?: ShippingFeeOptions,
): number | null {
  const region = getShippingRegion(country);
  if (region === 'NA' || region === 'EU') {
    if (hasFixedShippingFee(country)) return null;
    return SHIPPING_FEE_THRESHOLD;
  }
  if (isExcludedShippingCountry(country)) return null;
  const rate = options?.rateToUsd;
  if (!rate || rate <= 0) return null;
  return usdToLocalAmount(FREE_SHIPPING_USD_THRESHOLD, rate);
}

/**
 * NA/EU: existing $25/€25 + free at 500 (unchanged).
 * Other countries: $25 USD fee in local currency; free when subtotal >= $500 USD equivalent.
 */
export function calculateShippingFee(
  country: string,
  subtotal: number,
  options?: ShippingFeeOptions,
): number {
  const region = getShippingRegion(country);

  // NA / EU — keep existing behavior exactly
  if (region === 'NA' || region === 'EU') {
    if (hasFixedShippingFee(country)) return SHIPPING_FEE_AMOUNT;
    if (subtotal >= SHIPPING_FEE_THRESHOLD) return 0;
    return SHIPPING_FEE_AMOUNT;
  }

  // Excluded / empty → no shipping fee
  if (!country || isExcludedShippingCountry(country)) return 0;

  // Other countries — $500 USD equivalent free shipping in price-group currency
  const rate = options?.rateToUsd;
  if (!rate || rate <= 0) return 0;

  const thresholdLocal = usdToLocalAmount(FREE_SHIPPING_USD_THRESHOLD, rate);
  if (subtotal >= thresholdLocal) return 0;
  return usdToLocalAmount(SHIPPING_FEE_AMOUNT, rate);
}
