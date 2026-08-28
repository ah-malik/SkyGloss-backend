/**
 * Shop / registration order IDs:
 * - Order request:  SG{CCC}R0110  (e.g. SGPAKR0110, SGNEDR0117, SGENGR0124)
 * - Paid / purchase: SG{CCC}P0110 (e.g. SGUSAP0110, SGFRAP0117)
 * - Registration:   SGREG0110, SGREG0117, …
 *
 * {CCC} is a 3-letter country code (Pakistan → PAK, Netherlands → NED, …).
 * Numeric part starts at 0110 and increases by 7 on every new entry.
 * Request and purchase sequences are global across countries (per flow).
 */

export const SHOP_ORDER_LEGACY_REQ_BASE = 254700;

export type ShopOrderFlow = 'request' | 'purchase';

/** Flow letter after the country code: R = request, P = purchase. */
export const SHOP_ORDER_REQUEST_FLOW_LETTER = 'R';
export const SHOP_ORDER_PURCHASE_FLOW_LETTER = 'P';

/** @deprecated Fixed prefixes kept for older imports / docs. Prefer getShopOrderPrefix. */
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
  netherlands: 'NED',
  holland: 'NED',
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

export function getShopOrderFlowLetter(flow: ShopOrderFlow): string {
  return flow === 'request'
    ? SHOP_ORDER_REQUEST_FLOW_LETTER
    : SHOP_ORDER_PURCHASE_FLOW_LETTER;
}

/** Prefix for a shop order: SG + country (3) + R|P (e.g. SGNEDR, SGUSAP). */
export function getShopOrderPrefix(
  flow: ShopOrderFlow,
  country?: string,
): string {
  const countryCode = resolveOrderCountryCode(country);
  return `SG${countryCode}${getShopOrderFlowLetter(flow)}`;
}

/** Regex matching any current-format shop order for a flow (any country). */
export function getShopOrderNumberRegex(flow: ShopOrderFlow): RegExp {
  const letter = getShopOrderFlowLetter(flow);
  return new RegExp(`^SG[A-Z]{3}${letter}\\d+$`, 'i');
}

function padOrderSequence(sequence: number): string {
  return String(sequence).padStart(ORDER_SEQUENCE_DIGITS, '0');
}

/** Format shop order ID: SGNEDR0110 (request) or SGUSAP0110 (purchase). */
export function formatShopOrderNumber(
  flow: ShopOrderFlow,
  sequence: number,
  country?: string,
): string {
  return `${getShopOrderPrefix(flow, country)}${padOrderSequence(sequence)}`;
}

/** Format registration ID: SGREG0110. */
export function formatRegistrationOrderNumber(sequence: number): string {
  return `${REGISTRATION_ORDER_PREFIX}${padOrderSequence(sequence)}`;
}

/**
 * Extract sequence from current shop ID formats only
 * (SG{CCC}R0110 / SG{CCC}P0110). Legacy formats are ignored so counters can reset.
 */
export function extractCurrentShopOrderSequence(
  orderNumber?: string,
  flow?: ShopOrderFlow,
): number | null {
  if (!orderNumber) return null;
  const value = orderNumber.trim().toUpperCase();

  const letters = flow
    ? [getShopOrderFlowLetter(flow)]
    : [SHOP_ORDER_REQUEST_FLOW_LETTER, SHOP_ORDER_PURCHASE_FLOW_LETTER];

  for (const letter of letters) {
    const match = value.match(new RegExp(`^SG[A-Z]{3}${letter}(\\d+)$`));
    if (!match) continue;
    const seq = parseInt(match[1], 10);
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
  // Already on the current country+flow format — skip migration.
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

/** Manual order-request flow (invoice later), including current SG{CCC}R* IDs. */
export function isOrderRequest(order?: {
  orderFlow?: string;
  orderNumber?: string;
}): boolean {
  if (!order) return false;
  if (order.orderFlow === 'request') return true;
  if (order.orderFlow === 'purchase') return false;
  return getShopOrderNumberRegex('request').test(
    (order.orderNumber || '').trim(),
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
 * Next sequence for request (SG*R*) or purchase (SG*P*).
 * Sequences are shared across countries within the same flow.
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
 * Migrate a legacy shop order number onto the country+flow format.
 * Defaults to the request series when flow is unknown.
 */
export function buildMigratedShopOrderNumber(
  orderNumber: string,
  country?: string,
  flow: ShopOrderFlow = 'request',
): string | null {
  const sequence = extractShopOrderSequence(orderNumber);
  if (sequence == null) return null;
  return formatShopOrderNumber(flow, sequence, country);
}

/**
 * Rebuild an existing current-format shop ID with the correct country code,
 * keeping the same sequence and flow letter (R/P).
 * Returns null when the number is not current-format or already matches.
 */
export function rebuildShopOrderNumberCountry(
  orderNumber: string,
  country?: string,
  flow: ShopOrderFlow = 'request',
): string | null {
  const sequence = extractCurrentShopOrderSequence(orderNumber, flow);
  if (sequence == null) return null;

  const next = formatShopOrderNumber(flow, sequence, country);
  if (next.toUpperCase() === orderNumber.trim().toUpperCase()) {
    return null;
  }
  return next;
}
