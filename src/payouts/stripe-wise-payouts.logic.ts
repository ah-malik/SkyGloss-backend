export const STRIPE_ACCOUNT_KEYS = ['global', 'usa'] as const;
export type StripeAccountKey = (typeof STRIPE_ACCOUNT_KEYS)[number];

const USA_COUNTRY_NAMES = new Set([
  'united states',
  'usa',
  'us',
  'united states of america',
]);

/** True when a country label refers to the United States. */
export function isUsaCountryName(country?: string | null): boolean {
  return USA_COUNTRY_NAMES.has(String(country || '').toLowerCase().trim());
}

/**
 * Shop orders: shipping destination decides Stripe account when present.
 * Falls back to the shop user's profile country when shipping is missing.
 */
export function resolveShopOrderStripeAccountKey(
  shippingCountry?: string | null,
  userCountry?: string | null,
): StripeAccountKey {
  const shipping = String(shippingCountry || '').trim();
  if (shipping) {
    return isUsaCountryName(shipping) ? 'usa' : 'global';
  }
  return isUsaCountryName(userCountry) ? 'usa' : 'global';
}

export function isUsaShopOrder(
  shippingCountry?: string | null,
  userCountry?: string | null,
): boolean {
  return resolveShopOrderStripeAccountKey(shippingCountry, userCountry) === 'usa';
}

export const STRIPE_WISE_PAYOUT_STATUSES = [
  'creating',
  'pending',
  'in_transit',
  'paid',
  'failed',
  'canceled',
] as const;
export type StripeWisePayoutStatus =
  (typeof STRIPE_WISE_PAYOUT_STATUSES)[number];

export const WISE_RECEIPT_STATUSES = [
  'not_started',
  'awaiting_receipt',
  'received',
  'unmatched',
  'unavailable',
] as const;
export type WiseReceiptStatus = (typeof WISE_RECEIPT_STATUSES)[number];

export const OPEN_PAYOUT_STATUSES: StripeWisePayoutStatus[] = [
  'creating',
  'pending',
  'in_transit',
];

export const DUPLICATE_WINDOW_MS = 30_000;
export const WISE_AMOUNT_TOLERANCE_PCT = 5;

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function normalizeCurrency(input?: unknown): string {
  if (input == null || input === '') return '';
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    return normalizeCurrency(obj.code ?? obj.currency ?? obj.value);
  }
  const raw = String(input).trim().toUpperCase();
  if (!raw || raw === '[OBJECT OBJECT]') return '';
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  const match = raw.match(/\b([A-Z]{3})\b/);
  return match ? match[1] : '';
}

export function isValidCurrency(input?: unknown): boolean {
  return /^[A-Z]{3}$/.test(normalizeCurrency(input));
}

export function parsePositiveAmount(raw: unknown): number {
  const amount = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(amount)) {
    throw new Error('Amount must be a valid number.');
  }
  if (amount <= 0) {
    throw new Error('Amount must be greater than zero.');
  }
  return Math.round(amount * 100) / 100;
}

export function assertAmountWithinBalance(
  amount: number,
  available: number,
  currency: string,
): void {
  if (amount > available + 0.0001) {
    throw new Error(
      `Requested amount (${formatMoney(amount, currency)}) exceeds Stripe available balance (${formatMoney(available, currency)}).`,
    );
  }
}

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(normalizeCurrency(currency));
}

export function toStripeAmount(amount: number, currency: string): number {
  if (isZeroDecimalCurrency(currency)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

export function fromStripeAmount(amount: number, currency: string): number {
  if (isZeroDecimalCurrency(currency)) {
    return amount;
  }
  return Math.round(amount) / 100;
}

export function mapStripePayoutStatus(
  status?: string | null,
): StripeWisePayoutStatus {
  const value = String(status || '')
    .trim()
    .toLowerCase();
  if (value === 'in_transit') return 'in_transit';
  if (value === 'paid') return 'paid';
  if (value === 'failed') return 'failed';
  if (value === 'canceled' || value === 'cancelled') return 'canceled';
  if (value === 'pending') return 'pending';
  return 'pending';
}

export function stripeStatusLabel(status: StripeWisePayoutStatus): string {
  const labels: Record<StripeWisePayoutStatus, string> = {
    creating: 'Pending',
    pending: 'Pending',
    in_transit: 'In Transit',
    paid: 'Paid',
    failed: 'Failed',
    canceled: 'Canceled',
  };
  return labels[status] || 'Pending';
}

export function wiseStatusLabel(status: WiseReceiptStatus): string {
  const labels: Record<WiseReceiptStatus, string> = {
    not_started: '—',
    awaiting_receipt: 'Awaiting receipt',
    received: 'Received',
    unmatched: 'Not matched',
    unavailable: 'Unavailable',
  };
  return labels[status] || '—';
}

export function shouldStartWiseReceiptWatch(
  stripeStatus: StripeWisePayoutStatus,
): boolean {
  return stripeStatus === 'in_transit' || stripeStatus === 'paid';
}

export function shouldApplyWiseReceipt(
  stripeStatus: StripeWisePayoutStatus,
  wiseStatus: WiseReceiptStatus,
): boolean {
  if (wiseStatus === 'received') return false;
  return stripeStatus === 'paid';
}

export function amountsMatch(
  expected: number,
  actual: number,
  tolerancePct = WISE_AMOUNT_TOLERANCE_PCT,
): boolean {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  if (expected <= 0 || actual <= 0) return false;
  const delta = Math.abs(actual - expected);
  const allowed = Math.max(0.01, (Math.abs(expected) * tolerancePct) / 100);
  return delta <= allowed;
}

export function computeSettlement(previous: number, received: number) {
  const prev = Number(previous) || 0;
  const rec = Number(received) || 0;
  return {
    previousBalance: Math.round(prev * 100) / 100,
    receivedAmount: Math.round(rec * 100) / 100,
    newBalance: Math.round((prev + rec) * 100) / 100,
  };
}

export function last4(value?: string | null): string | null {
  const digits = String(value || '').replace(/\s+/g, '');
  if (digits.length < 4) return digits || null;
  return digits.slice(-4);
}

export function maskSecret(value?: string | null): string | null {
  const raw = String(value || '').replace(/\s+/g, '');
  if (!raw) return null;
  if (raw.length <= 4) return `****${raw}`;
  return `${'*'.repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}`;
}

export function digitsOnly(value?: string | null): string {
  return String(value || '').replace(/\s+/g, '');
}

export function isOpenPayoutStatus(
  status?: string | null,
): status is StripeWisePayoutStatus {
  return OPEN_PAYOUT_STATUSES.includes(status as StripeWisePayoutStatus);
}

export function formatMoney(amount: number, currency: string): string {
  const code = normalizeCurrency(currency) || 'USD';
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: isZeroDecimalCurrency(code) ? 0 : 2,
      maximumFractionDigits: isZeroDecimalCurrency(code) ? 0 : 2,
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(2)}`;
  }
}

export function userFacingStripeError(err: unknown): string {
  const anyErr = err as {
    type?: string;
    code?: string;
    message?: string;
    raw?: { message?: string; code?: string };
  };
  const code = String(anyErr?.code || anyErr?.raw?.code || '').toLowerCase();
  const message = String(
    anyErr?.raw?.message || anyErr?.message || '',
  ).trim();

  if (
    code === 'balance_insufficient' ||
    message.toLowerCase().includes('insufficient')
  ) {
    return 'Stripe available balance is insufficient for this payout.';
  }
  if (
    code === 'payouts_not_allowed' ||
    message.toLowerCase().includes('payouts are not enabled')
  ) {
    return 'Stripe payouts are not enabled for this account.';
  }
  if (
    code === 'account_invalid' ||
    message.toLowerCase().includes('destination')
  ) {
    return 'Stripe cannot pay out to the configured Wise receiving account. Check the destination in Admin settings and Stripe Dashboard payout bank details.';
  }
  if (message && message.length <= 220 && !looksInternal(message)) {
    return message;
  }
  return 'Stripe payout failed. Check payout eligibility and the configured Wise receiving account.';
}

export function unsupportedDestinationMessage(detail?: string): string {
  const extra = detail && detail.length <= 180 ? ` ${detail}` : '';
  return `This Stripe account cannot pay out to the configured Wise receiving account.${extra} Add the Wise bank details as a payout destination in Stripe Dashboard (Settings → Payouts), or enable "use Stripe default payout bank" only if that bank is already Wise. The transfer was not sent.`;
}

function looksInternal(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('sk_') ||
    lower.includes('whsec_') ||
    lower.includes('bearer') ||
    lower.includes('stack') ||
    lower.includes('econn') ||
    lower.includes('{')
  );
}

export function isStripeAccountKey(value: unknown): value is StripeAccountKey {
  return value === 'global' || value === 'usa';
}
