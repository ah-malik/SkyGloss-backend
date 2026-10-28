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

  it('sums the USD base amount and keeps charged currency per account', () => {
    const result = buildStripePaymentBreakdown([
      {
        orderNumber: 'SGITAP0425',
        items: [{ product: 'fusion' }],
        totalAmount: 155,
        originalAmount: 155,
        originalCurrency: 'EUR',
        currency: 'EUR',
        baseCurrencyAmount: 173.66,
        shippingAddress: { country: 'Italy' },
        user: { country: 'Italy' },
      },
      {
        orderNumber: 'SGITAP0426',
        items: [{ product: 'fusion' }],
        totalAmount: 100,
        originalCurrency: 'EUR',
        baseCurrencyAmount: 112.04,
        shippingAddress: { country: 'Germany' },
        user: { country: 'Germany' },
      },
    ]);

    expect(result.accounts.europe.shopOrder).toEqual({ count: 2, amount: 285.7 });
    expect(result.accounts.europe.chargedByCurrency).toEqual({ EUR: 255 });
  });

  it('routes registration by the user country like checkout does', () => {
    const result = buildStripePaymentBreakdown([
      {
        orderNumber: 'SGREG0600',
        items: [{ product: 'registration_fee' }],
        totalAmount: 250,
        baseCurrencyAmount: 250,
        shippingAddress: { country: 'United States' },
        user: { country: 'Italy' },
      },
    ]);

    expect(result.accounts.europe.registration).toEqual({ count: 1, amount: 250 });
    expect(result.accounts.usa.registration).toEqual({ count: 0, amount: 0 });
  });
});
