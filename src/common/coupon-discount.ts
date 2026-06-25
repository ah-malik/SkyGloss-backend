import { CouponDiscountType } from '../coupons/entities/coupon.entity';
import { roundMoney } from './order-monetary';

export interface CouponLike {
  code: string;
  discountType: CouponDiscountType | string;
  discountValue: number;
  isActive?: boolean;
  expiresAt?: Date;
  maxUses?: number;
  timesUsed?: number;
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isCouponCurrentlyValid(coupon: CouponLike, now = new Date()): boolean {
  if (coupon.isActive === false) return false;
  if (coupon.expiresAt && new Date(coupon.expiresAt) < now) return false;
  if (
    coupon.maxUses != null &&
    coupon.maxUses > 0 &&
    (coupon.timesUsed ?? 0) >= coupon.maxUses
  ) {
    return false;
  }
  return true;
}

/** Discount applies to items subtotal only (not shipping). */
export function calculateCouponDiscountAmount(
  coupon: Pick<CouponLike, 'discountType' | 'discountValue'>,
  subtotal: number,
): number {
  if (subtotal <= 0) return 0;

  let discount = 0;
  if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
    discount = roundMoney((subtotal * coupon.discountValue) / 100);
  } else {
    discount = roundMoney(coupon.discountValue);
  }

  return roundMoney(Math.min(discount, subtotal));
}
