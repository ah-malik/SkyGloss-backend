import { OrderStatus } from '../orders/entities/order.entity';
import { isRegistrationOrder } from './order-totals';

const NON_MODIFIABLE_STATUSES = new Set<string>([
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
]);

/** Paid / terminal / pending-payment orders must not be overwritten by an expired checkout session. */
const CHECKOUT_EXPIRE_PROTECTED_STATUSES = new Set<string>([
  OrderStatus.PAID,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
  OrderStatus.PENDING_PAYMENT,
]);

/** Statuses that mean payment was already recorded (by Stripe or an admin). */
const PAYMENT_RECORDED_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

/**
 * True when the order is already PAID or has moved past PAID in the workflow.
 * A (duplicate / late) Stripe confirmation must not move such orders back to PAID.
 */
export function isOrderPaymentRecorded(status?: string): boolean {
  if (!status) return false;
  return (PAYMENT_RECORDED_STATUSES as string[]).includes(
    String(status).toUpperCase(),
  );
}

/** Mongo filter matching orders whose payment has not been recorded yet. */
export function paymentNotRecordedStatusFilter() {
  return { $nin: [...PAYMENT_RECORDED_STATUSES] };
}

/** Stripe is the source of truth: only a verified paid checkout session counts as payment. */
export function isStripeCheckoutSessionPaid(session?: {
  payment_status?: string | null;
} | null): boolean {
  const paymentStatus = session?.payment_status;
  return paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
}

/** True only for unpaid PENDING orders (not already paid or waiting on the 3-day payment window). */
export function shouldMarkFailedOnCheckoutExpire(status?: string): boolean {
  if (!status) return false;
  return !CHECKOUT_EXPIRE_PROTECTED_STATUSES.has(String(status).toUpperCase());
}

/** Hub/Admin may add items until the order is marked shipped. */
export function isOrderModifiable(order: {
  status?: string;
  orderNumber?: string;
  items?: { product?: string }[];
}): boolean {
  if (!order?.status) return false;
  if (isRegistrationOrder(order)) return false;
  return !NON_MODIFIABLE_STATUSES.has(String(order.status).toUpperCase());
}

export function getOrderAmountPaid(order: {
  amountPaid?: number;
  totalAmount?: number;
  status?: string;
}): number {
  const paid = Number(order?.amountPaid);
  if (Number.isFinite(paid) && paid > 0) return paid;
  return 0;
}

export function getOrderRemainingAmount(order: {
  amountPaid?: number;
  totalAmount?: number;
}): number {
  const total = Number(order?.totalAmount) || 0;
  const paid = getOrderAmountPaid(order);
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}
