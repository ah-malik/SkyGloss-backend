import { UserRole } from '../users/entities/user.entity';
import { isRegistrationOrder } from '../common/order-totals';
import { roundMoney } from '../common/order-monetary';

/**
 * Hub 10% product commission (Earnings → Commission tab panel). Only the Hubs
 * listed here earn it and may withdraw it (Admin approval → Wise payout).
 */
export const HUB_PRODUCT_COMMISSION_EMAILS = ['nahub@skygloss.com'];
export const HUB_PRODUCT_COMMISSION_RATE = 0.1;
/** Orders placed on/after this date count (same start as the panel). */
export const HUB_PRODUCT_COMMISSION_FROM = new Date('2026-07-10T00:00:00.000Z');
/** WithdrawalRequest.source for withdrawals of this commission. */
export const HUB_PRODUCT_COMMISSION_SOURCE = 'hub_product_commission';

export function isHubProductCommissionUser(
  user?: { role?: string; email?: string } | null,
): boolean {
  if (!user || user.role !== UserRole.PARTNER) return false;
  const email = String(user.email || '').trim().toLowerCase();
  return !!email && HUB_PRODUCT_COMMISSION_EMAILS.includes(email);
}

export type HubCommissionOrder = {
  status?: string;
  items?: { product?: string }[];
  orderNumber?: string;
  totalAmount?: number;
  originalAmount?: number;
  baseCurrencyAmount?: number;
  shippingFee?: number;
  vatAmount?: number;
  shippedAt?: Date | string;
  updatedAt?: Date | string;
};

const PAID_LIKE = new Set(['PAID', 'SHIPPED', 'DELIVERED']);

/**
 * 10% of the product base (order total minus shipping and VAT), converted to
 * USD with the rate locked on the order. Registration fees are not products.
 */
export function orderHubProductCommissionUsd(order: HubCommissionOrder): number {
  if (isRegistrationOrder(order)) return 0;
  const gross = Number(order.originalAmount ?? order.totalAmount ?? 0) || 0;
  const shipping = Math.max(0, Number(order.shippingFee) || 0);
  const vat = Math.max(0, Number(order.vatAmount) || 0);
  const productBase = Math.max(0, gross - shipping - vat);
  const base = Number(order.baseCurrencyAmount);
  const toUsd = gross > 0 && Number.isFinite(base) && base > 0 ? base / gross : 1;
  return roundMoney(productBase * HUB_PRODUCT_COMMISSION_RATE * toUsd);
}

export type HubProductCommissionTotals = {
  /** All paid / shipped / delivered orders. */
  earned: number;
  /** Shipped and past the hold period: can be withdrawn (before deductions). */
  released: number;
  /** Shipped, still inside the hold period. */
  onHold: number;
  /** Paid, not shipped yet. */
  awaitingShipment: number;
};

/** Same hold rule as other commissions: available `holdMs` after shipping. */
export function summarizeHubProductCommission(
  orders: HubCommissionOrder[],
  now: Date,
  holdMs: number,
): HubProductCommissionTotals {
  const totals: HubProductCommissionTotals = {
    earned: 0,
    released: 0,
    onHold: 0,
    awaitingShipment: 0,
  };
  for (const order of orders) {
    const status = String(order.status || '').toUpperCase();
    if (!PAID_LIKE.has(status)) continue;
    const commission = orderHubProductCommissionUsd(order);
    if (commission <= 0) continue;
    totals.earned = roundMoney(totals.earned + commission);
    if (status === 'PAID') {
      totals.awaitingShipment = roundMoney(totals.awaitingShipment + commission);
      continue;
    }
    // Same fallback as commission backfill: shippedAt, else last update.
    const shipped = new Date((order.shippedAt || order.updatedAt) as any);
    const releasedAt = shipped.getTime() + holdMs;
    if (!Number.isNaN(releasedAt) && releasedAt <= now.getTime()) {
      totals.released = roundMoney(totals.released + commission);
    } else {
      totals.onHold = roundMoney(totals.onHold + commission);
    }
  }
  return totals;
}
