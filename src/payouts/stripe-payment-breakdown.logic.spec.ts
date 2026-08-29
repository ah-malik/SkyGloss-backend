import { buildStripePaymentBreakdown } from './stripe-payment-breakdown.logic';

describe('stripe-payment-breakdown.logic', () => {
  it('splits registration and shop orders by Stripe account', () => {
    const result = buildStripePaymentBreakdown([
      {
        orderNumber: 'SGREG0502',
        items: [{ product: 'registration_fee' }],
        totalAmount: 250,
        shippingAddress: { country: 'United States' },
        user: { country: 'United States' },
      },
      {
        orderNumber: 'SGUSAP0173',
        items: [{ product: 'fusion' }],
        totalAmount: 28,
        shippingAddress: { country: 'United States' },
        user: { country: 'United States' },
      },
      {
        orderNumber: 'SGUSAP0180',
        items: [{ product: 'fusion' }],
        totalAmount: 28,
        shippingAddress: { country: 'United States' },
        user: { country: 'United Arab Emirates' },
      },
    ]);

    expect(result.accounts.usa.registration).toEqual({ count: 1, amount: 250 });
    expect(result.accounts.usa.shopOrder).toEqual({ count: 2, amount: 56 });
    expect(result.accounts.global.shopOrder).toEqual({ count: 0, amount: 0 });
    expect(result.combined.total).toEqual({ count: 3, amount: 306 });
  });
});
