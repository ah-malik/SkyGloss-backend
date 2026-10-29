import { UserRole } from '../users/entities/user.entity';
import {
  isHubProductCommissionUser,
  orderHubProductCommissionUsd,
  summarizeHubProductCommission,
} from './hub-product-commission.logic';

const DAY = 24 * 60 * 60 * 1000;

describe('hub-product-commission.logic', () => {
  it('only the allowlisted Hub is eligible', () => {
    expect(
      isHubProductCommissionUser({ role: UserRole.PARTNER, email: 'NAHub@SkyGloss.com ' }),
    ).toBe(true);
    expect(
      isHubProductCommissionUser({ role: UserRole.PARTNER, email: 'other@skygloss.com' }),
    ).toBe(false);
    expect(
      isHubProductCommissionUser({
        role: UserRole.MASTER_PARTNER,
        email: 'nahub@skygloss.com',
      }),
    ).toBe(false);
  });

  it('is 10% of product base (minus shipping and VAT) in USD', () => {
    expect(
      orderHubProductCommissionUsd({
        totalAmount: 130,
        shippingFee: 20,
        vatAmount: 10,
        baseCurrencyAmount: 130,
      }),
    ).toBe(10);
    // CAD order: base locked at 0.73 USD per CAD.
    expect(
      orderHubProductCommissionUsd({
        originalAmount: 200,
        totalAmount: 200,
        baseCurrencyAmount: 146,
      }),
    ).toBe(14.6);
  });

  it('ignores registration fees', () => {
    expect(
      orderHubProductCommissionUsd({
        orderNumber: 'SGREG0700',
        items: [{ product: 'registration_fee' }],
        totalAmount: 250,
      }),
    ).toBe(0);
  });

  it('releases commission only after the hold period from shipping', () => {
    const now = new Date('2026-10-29T00:00:00Z');
    const totals = summarizeHubProductCommission(
      [
        { status: 'PAID', totalAmount: 100 },
        { status: 'SHIPPED', totalAmount: 200, shippedAt: new Date(now.getTime() - 3 * DAY) },
        { status: 'DELIVERED', totalAmount: 300, shippedAt: new Date(now.getTime() - 20 * DAY) },
        { status: 'SHIPPED', totalAmount: 50, updatedAt: new Date(now.getTime() - 16 * DAY) },
        { status: 'CANCELLED', totalAmount: 999 },
        { status: 'PENDING_PAYMENT', totalAmount: 999 },
      ],
      now,
      15 * DAY,
    );
    expect(totals).toEqual({
      earned: 65,
      released: 35,
      onHold: 20,
      awaitingShipment: 10,
    });
  });
});
