import { roundMoney } from './order-monetary';
import { isPartnerNetworkRole } from './role-labels';

/**
 * Discount % stored on this user only.
 * Shop accounts and any other role return 0 so the rate cannot be inherited.
 */
export function resolvePartnerDiscountPercent(user?: {
  role?: string;
  partnerDiscountPercent?: number | null;
} | null): number {
  if (!user || !isPartnerNetworkRole(user.role)) return 0;
  const percent = Number(user.partnerDiscountPercent);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(100, percent);
}

/**
 * Adds this account's own % of the items subtotal on top of any existing
 * coupon / kit discount, capped at the items subtotal.
 */
export function applyPartnerAccountDiscount(
  user: { role?: string; partnerDiscountPercent?: number | null } | null | undefined,
  itemsSubtotal: number,
  existingDiscount: number,
): { discount: number; partnerDiscountPercent?: number } {
  const subtotal = Math.max(0, Number(itemsSubtotal) || 0);
  const baseDiscount = roundMoney(Math.max(0, Number(existingDiscount) || 0));
  const percent = resolvePartnerDiscountPercent(user);
  if (!percent || subtotal <= 0) {
    return { discount: roundMoney(Math.min(subtotal, baseDiscount)) };
  }
  const accountDiscount = roundMoney((subtotal * percent) / 100);
  return {
    discount: roundMoney(Math.min(subtotal, baseDiscount + accountDiscount)),
    partnerDiscountPercent: percent,
  };
}
