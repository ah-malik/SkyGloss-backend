import { OrderStatus } from '../orders/entities/order.entity';
import { isRegistrationOrder } from './order-totals';

const NON_MODIFIABLE_STATUSES = new Set<string>([
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
]);

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
