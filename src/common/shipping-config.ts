// Shipping configuration for North America & Europe regions
// Excluded countries: Russia, Ukraine, Turkey, North Macedonia, Belarus
// Bulgaria: always charged fixed €25 (no free-shipping threshold)
//
// NA + USD / EU + EUR → literal 25 fee, free at 500 (unchanged).
// Any other price-group currency → $25 / $500 USD converted via exchange rate.

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

export const SHIPPING_FEE_THRESHOLD = 500; // $500 or €500 (native NA/EU currency)
export const SHIPPING_FEE_AMOUNT = 25; // $25 or €25 (native NA/EU currency)
/** USD baseline for free-shipping when price-group currency is not USD/EUR. */
export const FREE_SHIPPING_USD_THRESHOLD = 500;

export type ShippingFeeOptions = {
  /** 1 unit of order currency → USD (existing exchange-rate rateToBase). */
  rateToUsd?: number;
  /** Order / price-group currency code (e.g. PKR, EUR, USD). */
  currency?: string;
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

export function getShippingCurrencySymbol(region: 'NA' | 'EU'): string {
  return region === 'EU' ? '€' : '$';
}

export function getShippingCurrencyCode(region: 'NA' | 'EU'): string {
  return region === 'EU' ? 'EUR' : 'USD';
}

/** NA expects USD pricing; EU expects EUR pricing. */
export function isNativeShippingCurrency(
  region: 'NA' | 'EU' | null,
  currency?: string,
): boolean {
  if (!region) return false;
  const code = (currency || '').trim().toUpperCase();
  if (!code) return true;
  if (region === 'NA') return code === 'USD';
  return code === 'EUR';
}

/**
 * Free-shipping threshold in the order's price-group currency.
 * NA+USD / EU+EUR → literal 500.
 * Any other currency → $500 USD equivalent when rate is available.
 */
export function getFreeShippingThreshold(
  country: string,
  options?: ShippingFeeOptions,
): number | null {
  if (hasFixedShippingFee(country)) return null;
  if (isExcludedShippingCountry(country)) return null;

  const region = getShippingRegion(country);
  const rate = options?.rateToUsd;

  if (region === 'NA' || region === 'EU') {
    if (isNativeShippingCurrency(region, options?.currency)) {
      return SHIPPING_FEE_THRESHOLD;
    }
    if (!rate || rate <= 0) return null;
    return usdToLocalAmount(FREE_SHIPPING_USD_THRESHOLD, rate);
  }

  if (!rate || rate <= 0) return null;
  return usdToLocalAmount(FREE_SHIPPING_USD_THRESHOLD, rate);
}

/**
 * NA+USD / EU+EUR: existing $25/€25 + free at 500.
 * Any other price-group currency (incl. Europe shop on PKR): $25/$500 USD → local.
 */
export function calculateShippingFee(
  country: string,
  subtotal: number,
  options?: ShippingFeeOptions,
): number {
  if (!country || isExcludedShippingCountry(country)) return 0;

  const region = getShippingRegion(country);
  const rate = options?.rateToUsd;

  if (region === 'NA' || region === 'EU') {
    if (hasFixedShippingFee(country)) {
      if (isNativeShippingCurrency(region, options?.currency)) {
        return SHIPPING_FEE_AMOUNT;
      }
      if (!rate || rate <= 0) return SHIPPING_FEE_AMOUNT;
      return usdToLocalAmount(SHIPPING_FEE_AMOUNT, rate);
    }

    if (isNativeShippingCurrency(region, options?.currency)) {
      if (subtotal >= SHIPPING_FEE_THRESHOLD) return 0;
      return SHIPPING_FEE_AMOUNT;
    }

    if (!rate || rate <= 0) {
      if (subtotal >= SHIPPING_FEE_THRESHOLD) return 0;
      return SHIPPING_FEE_AMOUNT;
    }
    const thresholdLocal = usdToLocalAmount(FREE_SHIPPING_USD_THRESHOLD, rate);
    if (subtotal >= thresholdLocal) return 0;
    return usdToLocalAmount(SHIPPING_FEE_AMOUNT, rate);
  }

  if (!rate || rate <= 0) return 0;

  const thresholdLocal = usdToLocalAmount(FREE_SHIPPING_USD_THRESHOLD, rate);
  if (subtotal >= thresholdLocal) return 0;
  return usdToLocalAmount(SHIPPING_FEE_AMOUNT, rate);
}
