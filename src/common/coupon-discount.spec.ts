import {
  calculateCouponDiscountAmount,
  canUserRedeemShopRegistrationCoupon,
  isCouponCurrentlyValid,
  normalizeCouponCode,
} from './coupon-discount';
import { CouponDiscountType } from '../coupons/entities/coupon.entity';

describe('coupon-discount', () => {
  it('normalizes coupon codes', () => {
    expect(normalizeCouponCode(' save10 ')).toBe('SAVE10');
  });

  it('allows a user to re-apply the same registration coupon but not a second code', () => {
    expect(canUserRedeemShopRegistrationCoupon(undefined, 'SAVE10')).toBe(true);
    expect(canUserRedeemShopRegistrationCoupon('save10', 'SAVE10')).toBe(true);
    expect(canUserRedeemShopRegistrationCoupon('SAVE10', 'OTHER')).toBe(false);
  });

  it('calculates percentage discount capped at subtotal', () => {
    const amount = calculateCouponDiscountAmount(
      { discountType: CouponDiscountType.PERCENTAGE, discountValue: 10 },
      100,
    );
    expect(amount).toBe(10);
  });

  it('calculates fixed discount capped at subtotal', () => {
    const amount = calculateCouponDiscountAmount(
      { discountType: CouponDiscountType.FIXED, discountValue: 150 },
      100,
    );
    expect(amount).toBe(100);
  });

  it('rejects inactive or expired coupons', () => {
    expect(
      isCouponCurrentlyValid({
        code: 'X',
        discountType: CouponDiscountType.FIXED,
        discountValue: 10,
        isActive: false,
      }),
    ).toBe(false);

    expect(
      isCouponCurrentlyValid({
        code: 'X',
        discountType: CouponDiscountType.FIXED,
        discountValue: 10,
        expiresAt: new Date('2020-01-01'),
      }),
    ).toBe(false);
  });
});
