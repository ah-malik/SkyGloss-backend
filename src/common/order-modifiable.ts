import { OrderStatus } from '../orders/entities/order.entity';
import { isRegistrationOrder } from './order-totals';

const NON_MODIFIABLE_STATUSES = new Set<string>([
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
]);

export function isOrderModifiable(order: {
  status?: string;
  orderKind?: string;
  orderNumber?: string;
  items?: { product?: string }[];
}): boolean {
  if (!order?.status) return false;
  if (isRegistrationOrder(order)) return false;
  if (order.orderKind === 'add_on') return false;
  return !NON_MODIFIABLE_STATUSES.has(String(order.status).toUpperCase());
}
