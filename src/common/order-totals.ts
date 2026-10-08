import { calculateShippingFee } from './shipping-config';
import { UserRole } from '../users/entities/user.entity';
import {
  calculateEuropeOrderVatAmount,
  getOrderVatTaxableBase,
} from './europe-vat';
import { roundMoney } from './order-monetary';

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
  // UserRole.SUB_PROMOTER, // removed
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
  partnerDiscountPercent?: number | null;
  items?: { product?: string }[];
  orderNumber?: string;
}): string {
  if (isRegistrationOrder(order)) {
    if (order.couponCode === 'CERTIFICATIONONUS') {
      return 'Promotional Credit';
    }
    return 'Discount';
  }
  const percent = Number(order.partnerDiscountPercent);
  const partnerLabel =
    Number.isFinite(percent) && percent > 0 ? `${percent}%` : '';
  if (order.couponCode && partnerLabel) {
    return `Discount (${order.couponCode} + ${partnerLabel})`;
  }
  if (order.couponCode) {
    return `Discount (${order.couponCode})`;
  }
  if (partnerLabel) {
    return `Discount (${partnerLabel})`;
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
    vatAmount?: number;
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
  const vatAmount = Number(order.vatAmount) || 0;
  const derived = Math.max(
    0,
    (order.totalAmount || 0) + (order.discount || 0) - subtotal - vatAmount,
  );
  if (derived > 0) {
    return derived;
  }

  const country =
    order.shippingAddress?.country || countryFallback || '';
  return calculateShippingFee(country, subtotal);
}

export function resolveOrderVat(
  order: {
    items: { price: number; quantity: number; product?: string }[];
    discount?: number;
    vatAmount?: number;
    vatRate?: number;
    shippingAddress?: {
      country?: string;
      taxId?: string;
      noVatId?: boolean;
    };
    orderNumber?: string;
  },
  countryFallback?: string,
): { vatAmount: number; vatRate: number } {
  if (order.vatAmount != null && order.vatAmount >= 0) {
    return {
      vatAmount: roundMoney(order.vatAmount),
      vatRate: Number(order.vatRate) || 0,
    };
  }
  if (isRegistrationOrder(order)) {
    return { vatAmount: 0, vatRate: 0 };
  }
  const country = order.shippingAddress?.country || countryFallback || '';
  const taxable = getOrderVatTaxableBase(
    getItemsSubtotal(order.items),
    order.discount || 0,
  );
  const { rate, amount } = calculateEuropeOrderVatAmount(taxable, {
    country,
    taxId: order.shippingAddress?.taxId,
    noVatId: order.shippingAddress?.noVatId,
  });
  return { vatAmount: amount, vatRate: rate };
}

export function getOrderTotalsBreakdown(
  order: {
    items: { price: number; quantity: number; product?: string }[];
    totalAmount: number;
    discount?: number;
    shippingFee?: number;
    vatAmount?: number;
    vatRate?: number;
    shippingAddress?: { country?: string };
    orderNumber?: string;
    couponCode?: string;
  },
  countryFallback?: string,
) {
  const subtotal = getItemsSubtotal(order.items);
  const discount = order.discount || 0;
  const shippingFee = resolveOrderShippingFee(order, countryFallback);
  const { vatAmount, vatRate } = resolveOrderVat(order, countryFallback);
  const total =
    order.totalAmount != null && order.totalAmount > 0
      ? order.totalAmount
      : roundMoney(subtotal - discount + vatAmount + shippingFee);

  return { subtotal, shippingFee, discount, vatAmount, vatRate, total };
}
