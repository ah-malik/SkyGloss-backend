/** Shop order IDs: SG{COUNTRY}-{sequence} e.g. SGUSA-254752 */

export const SHOP_ORDER_LEGACY_REQ_BASE = 254700;

const ORDER_COUNTRY_CODES: Record<string, string> = {
  'united states': 'USA',
  'united states of america': 'USA',
  usa: 'USA',
  us: 'USA',
  pakistan: 'PAK',
  england: 'ENG',
  'united kingdom': 'ENG',
  uk: 'ENG',
  scotland: 'ENG',
  wales: 'ENG',
  'northern ireland': 'ENG',
  canada: 'CAN',
  mexico: 'MEX',
  germany: 'DEU',
  france: 'FRA',
  italy: 'ITA',
  spain: 'ESP',
  netherlands: 'NLD',
  belgium: 'BEL',
  switzerland: 'CHE',
  austria: 'AUT',
  ireland: 'IRL',
  poland: 'POL',
  sweden: 'SWE',
  norway: 'NOR',
  denmark: 'DNK',
  finland: 'FIN',
  portugal: 'PRT',
  'czech republic': 'CZE',
  czechia: 'CZE',
  greece: 'GRC',
  hungary: 'HUN',
  romania: 'ROU',
  turkey: 'TUR',
  türkiye: 'TUR',
  'united arab emirates': 'UAE',
  uae: 'UAE',
  'saudi arabia': 'SAU',
  india: 'IND',
  australia: 'AUS',
  'new zealand': 'NZL',
  japan: 'JPN',
  china: 'CHN',
  'south africa': 'ZAF',
  brazil: 'BRA',
};

export function resolveOrderCountryCode(country?: string): string {
  const normalized = (country || '').toLowerCase().trim();
  if (!normalized || normalized === 'n/a') {
    return 'GLB';
  }

  if (ORDER_COUNTRY_CODES[normalized]) {
    return ORDER_COUNTRY_CODES[normalized];
  }

  const alpha = normalized.replace(/[^a-z]/g, '');
  if (alpha.length >= 3) {
    return alpha.slice(0, 3).toUpperCase();
  }
  if (alpha.length > 0) {
    return alpha.padEnd(3, 'X').toUpperCase();
  }

  return 'GLB';
}

export function formatShopOrderNumber(
  countryCode: string,
  sequence: number,
): string {
  return `SG${countryCode}-${sequence}`;
}

/** Extract the numeric sequence from legacy or current shop order numbers. */
export function extractShopOrderSequence(orderNumber?: string): number | null {
  if (!orderNumber) return null;
  const value = orderNumber.trim().toUpperCase();

  if (value.startsWith('REG')) return null;

  const withCountry = value.match(/^SG[A-Z]{3}-(\d+)$/);
  if (withCountry) return parseInt(withCountry[1], 10);

  const req = value.match(/^REQ-(\d+)$/);
  if (req) return parseInt(req[1], 10);

  const legacySg = value.match(/^SG(\d+)$/);
  if (legacySg) return parseInt(legacySg[1], 10);

  const ord = value.match(/^ORD-(\d+)-\d+$/);
  if (ord) return parseInt(ord[1], 10);

  return null;
}

export function isMigratableShopOrderNumber(orderNumber?: string): boolean {
  return extractShopOrderSequence(orderNumber) != null;
}

export function isRegistrationOrderNumber(orderNumber?: string): boolean {
  return !!orderNumber?.trim().toUpperCase().startsWith('REG');
}

export function getNextShopOrderSequence(
  orderNumbers: Array<string | undefined>,
): number {
  let maxNum = SHOP_ORDER_LEGACY_REQ_BASE;

  for (const orderNumber of orderNumbers) {
    const seq = extractShopOrderSequence(orderNumber);
    if (seq != null && seq > maxNum) {
      maxNum = seq;
    }
  }

  return maxNum + 1;
}

export function buildMigratedShopOrderNumber(
  orderNumber: string,
  country?: string,
): string | null {
  const sequence = extractShopOrderSequence(orderNumber);
  if (sequence == null) return null;
  return formatShopOrderNumber(resolveOrderCountryCode(country), sequence);
}
