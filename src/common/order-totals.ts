import { calculateShippingFee } from './shipping-config';

export function isRegistrationOrder(order: {
  items?: { product?: string }[];
  orderNumber?: string;
}): boolean {
  return (
    order.items?.some((item) => item.product === 'registration_fee') ||
    !!order.orderNumber?.startsWith('REG')
  );
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
