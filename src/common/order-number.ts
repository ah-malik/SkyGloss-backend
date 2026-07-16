/**
 * Shop / registration order IDs:
 * - Order request (non-USA / unpaid): SGPAKR0110, SGPAKR0117, …
 * - Paid / checkout:                   SGUSAP0110, SGUSAP0117, …
 * - Registration:                      SGREG0110,  SGREG0117, …
 *
 * Numeric part starts at 0110 and increases by 7 on every new entry.
 */

export const SHOP_ORDER_LEGACY_REQ_BASE = 254700;

export type ShopOrderFlow = 'request' | 'purchase';

/** Fixed prefixes for each ID family. */
export const SHOP_ORDER_REQUEST_PREFIX = 'SGPAKR';
export const SHOP_ORDER_PURCHASE_PREFIX = 'SGUSAP';
export const REGISTRATION_ORDER_PREFIX = 'SGREG';

/** First number issued after reset for all three ID families. */
export const ORDER_SEQUENCE_START = 110;
export const SHOP_ORDER_REQUEST_START = ORDER_SEQUENCE_START;
export const SHOP_ORDER_PURCHASE_START = ORDER_SEQUENCE_START;
export const REGISTRATION_ORDER_START = ORDER_SEQUENCE_START;

/** Every new order / registration advances the sequence by this step. */
export const ORDER_SEQUENCE_STEP = 7;

/** Pad width for the numeric suffix (0110). Grows past 4 digits when needed. */
export const ORDER_SEQUENCE_DIGITS = 4;

/** @deprecated Use ORDER_SEQUENCE_DIGITS — kept for older imports. */
export const SHOP_ORDER_SEQUENCE_DIGITS = ORDER_SEQUENCE_DIGITS;

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

export function getShopOrderPrefix(flow: ShopOrderFlow): string {
  return flow === 'request'
    ? SHOP_ORDER_REQUEST_PREFIX
    : SHOP_ORDER_PURCHASE_PREFIX;
}

function padOrderSequence(sequence: number): string {
  return String(sequence).padStart(ORDER_SEQUENCE_DIGITS, '0');
}

/** Format shop order ID: SGPAKR0110 (request) or SGUSAP0110 (purchase). */
export function formatShopOrderNumber(
  flow: ShopOrderFlow,
  sequence: number,
): string {
  return `${getShopOrderPrefix(flow)}${padOrderSequence(sequence)}`;
}

/** Format registration ID: SGREG0110. */
export function formatRegistrationOrderNumber(sequence: number): string {
  return `${REGISTRATION_ORDER_PREFIX}${padOrderSequence(sequence)}`;
}

/**
 * Extract sequence from the current shop ID formats only
 * (SGPAKR0110 / SGUSAP0110). Legacy formats are ignored so counters can reset.
 */
export function extractCurrentShopOrderSequence(
  orderNumber?: string,
  flow?: ShopOrderFlow,
): number | null {
  if (!orderNumber) return null;
  const value = orderNumber.trim().toUpperCase();

  const prefixes = flow
    ? [getShopOrderPrefix(flow)]
    : [SHOP_ORDER_REQUEST_PREFIX, SHOP_ORDER_PURCHASE_PREFIX];

  for (const prefix of prefixes) {
    if (!value.startsWith(prefix)) continue;
    const numPart = value.slice(prefix.length);
    if (!/^\d+$/.test(numPart)) continue;
    const seq = parseInt(numPart, 10);
    return Number.isNaN(seq) ? null : seq;
  }

  return null;
}

/** Extract sequence from current registration IDs only (SGREG0110). */
export function extractCurrentRegistrationOrderSequence(
  orderNumber?: string,
): number | null {
  if (!orderNumber) return null;
  const value = orderNumber.trim().toUpperCase();
  if (!value.startsWith(REGISTRATION_ORDER_PREFIX)) return null;

  const numPart = value.slice(REGISTRATION_ORDER_PREFIX.length);
  if (!/^\d+$/.test(numPart)) return null;
  const seq = parseInt(numPart, 10);
  return Number.isNaN(seq) ? null : seq;
}

/** Extract the numeric sequence from legacy or previous shop order numbers. */
export function extractShopOrderSequence(orderNumber?: string): number | null {
  if (!orderNumber) return null;
  const value = orderNumber.trim().toUpperCase();

  if (isRegistrationOrderNumber(value)) return null;

  const current = extractCurrentShopOrderSequence(value);
  if (current != null) return current;

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
  if (!orderNumber) return false;
  const value = orderNumber.trim().toUpperCase();
  // Already on the new fixed-prefix format — skip migration.
  if (extractCurrentShopOrderSequence(value) != null) return false;
  return extractShopOrderSequence(orderNumber) != null;
}

export function isRegistrationOrderNumber(orderNumber?: string): boolean {
  if (!orderNumber) return false;
  const value = orderNumber.trim().toUpperCase();
  return (
    value.startsWith(REGISTRATION_ORDER_PREFIX) ||
    /^REG\d+$/.test(value)
  );
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

function nextSequenceFromMax(maxNum: number, start: number): number {
  if (maxNum < start) return start;
  return maxNum + ORDER_SEQUENCE_STEP;
}

/**
 * Next sequence for request (SGPAKR*) or purchase (SGUSAP*).
 * Only current-format IDs count, so the series resets to 0110.
 */
export function getNextShopOrderSequenceForFlow(
  orders: Array<{ orderNumber?: string; orderFlow?: ShopOrderFlow }>,
  flow: ShopOrderFlow,
): number {
  const start =
    flow === 'request'
      ? SHOP_ORDER_REQUEST_START
      : SHOP_ORDER_PURCHASE_START;

  let maxNum = start - ORDER_SEQUENCE_STEP;

  for (const order of orders) {
    if (order.orderFlow !== flow) continue;

    const seq = extractCurrentShopOrderSequence(order.orderNumber, flow);
    if (seq == null) continue;
    if (seq > maxNum) maxNum = seq;
  }

  return nextSequenceFromMax(maxNum, start);
}

/** Next registration sequence (SGREG*). Legacy REG* IDs are ignored for reset. */
export function getNextRegistrationOrderSequence(
  orderNumbers: Array<string | undefined>,
): number {
  let maxNum = REGISTRATION_ORDER_START - ORDER_SEQUENCE_STEP;

  for (const orderNumber of orderNumbers) {
    const seq = extractCurrentRegistrationOrderSequence(orderNumber);
    if (seq == null) continue;
    if (seq > maxNum) maxNum = seq;
  }

  return nextSequenceFromMax(maxNum, REGISTRATION_ORDER_START);
}

/**
 * Migrate a legacy shop order number onto the new fixed-prefix format.
 * Defaults to the request series when flow is unknown.
 */
export function buildMigratedShopOrderNumber(
  orderNumber: string,
  _country?: string,
  flow: ShopOrderFlow = 'request',
): string | null {
  const sequence = extractShopOrderSequence(orderNumber);
  if (sequence == null) return null;
  return formatShopOrderNumber(flow, sequence);
}
