import { calculateShippingFee } from './shipping-config';
import { UserRole } from '../users/entities/user.entity';

export function isRegistrationOrder(order: {
  items?: { product?: string }[];
  orderNumber?: string;
}): boolean {
  const orderNumber = order.orderNumber?.trim().toUpperCase() || '';
  return (
    order.items?.some((item) => item.product === 'registration_fee') ||
    orderNumber.startsWith('SGREG') ||
    /^REG\d+$/.test(orderNumber)
  );
}

const PARTNER_NETWORK_ROLES = new Set<UserRole>([
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
  UserRole.SUB_PROMOTER,
]);

/** Mongo filter to exclude shop registration orders from partner revenue stats. */
export function registrationOrderExclusionFilter() {
  return {
    $nor: [
      { items: { $elemMatch: { product: 'registration_fee' } } },
      { orderNumber: { $regex: '^SGREG\\d+$', $options: 'i' } },
      { orderNumber: { $regex: '^REG\\d+$', $options: 'i' } },
    ],
  };
}

export function shouldHideShopRegistrationFromViewer(
  order: {
    items?: { product?: string }[];
    orderNumber?: string;
    user?: { _id?: unknown; role?: string } | string;
  },
  viewer: { _id?: unknown; role?: string },
): boolean {
  if (!isRegistrationOrder(order)) return false;
  if (viewer.role === UserRole.ADMIN) return false;

  const orderUserId =
    typeof order.user === 'object' && order.user !== null && '_id' in order.user
      ? String((order.user as { _id?: unknown })._id)
      : String(order.user || '');

  if (orderUserId && orderUserId === String(viewer._id)) {
    return false;
  }

  if (!viewer.role || !PARTNER_NETWORK_ROLES.has(viewer.role as UserRole)) {
    return false;
  }

  const orderUserRole =
    typeof order.user === 'object' && order.user !== null
      ? (order.user as { role?: string }).role
      : undefined;

  if (orderUserRole && orderUserRole !== UserRole.CERTIFIED_SHOP) {
    return false;
  }

  return true;
}
export function getDiscountDisplayLabel(order: {
  couponCode?: string;
  items?: { product?: string }[];
  orderNumber?: string;
}): string {
  if (isRegistrationOrder(order)) {
    if (order.couponCode === 'CERTIFICATIONONUS') {
      return 'Promotional Credit';
    }
    return 'Discount';
  }
  if (order.couponCode) {
    return `Discount (${order.couponCode})`;
  }
  return 'Discount';
}

export function getItemsSubtotal(
  items: { price: number; quantity: number }[],
): number {
  return (items || []).reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0,
  );
}

export function resolveOrderShippingFee(
  order: {
    items: { price: number; quantity: number; product?: string }[];
    totalAmount: number;
    discount?: number;
    shippingFee?: number;
    shippingAddress?: { country?: string };
    orderNumber?: string;
  },
  countryFallback?: string,
): number {
  if (isRegistrationOrder(order)) {
    return 0;
  }

  if (order.shippingFee != null && order.shippingFee > 0) {
    return order.shippingFee;
  }

  const subtotal = getItemsSubtotal(order.items);
  const derived = Math.max(
    0,
    (order.totalAmount || 0) + (order.discount || 0) - subtotal,
  );
  if (derived > 0) {
    return derived;
  }

  const country =
    order.shippingAddress?.country || countryFallback || '';
  return calculateShippingFee(country, subtotal);
}

export function getOrderTotalsBreakdown(
  order: {
    items: { price: number; quantity: number; product?: string }[];
    totalAmount: number;
    discount?: number;
    shippingFee?: number;
    shippingAddress?: { country?: string };
    orderNumber?: string;
    couponCode?: string;
  },
  countryFallback?: string,
) {
  const subtotal = getItemsSubtotal(order.items);
  const discount = order.discount || 0;
  const shippingFee = resolveOrderShippingFee(order, countryFallback);
  const total =
    order.totalAmount != null && order.totalAmount > 0
      ? order.totalAmount
      : subtotal + shippingFee - discount;

  return { subtotal, shippingFee, discount, total };
}
