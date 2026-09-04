import {
  amountsMatch,
  assertAmountWithinBalance,
  computeSettlement,
  formatMoney,
  fromStripeAmount,
  isEuropeShopOrder,
  isUsaShopOrder,
  requiresOnlinePaymentShopOrder,
  last4,
  mapStripePayoutStatus,
  maskSecret,
  normalizeCurrency,
  parsePositiveAmount,
  resolveShopOrderStripeAccountKey,
  resolveStripeApiVersion,
  resolveAutomatedCommissionSourceType,
  applyPaymentsToFaExtra,
  PAYMENTS_TO_FA_EXTRA_AMOUNT,
  shouldApplyWiseReceipt,
  stripeStatusLabel,
  toStripeAmount,
  userFacingStripeError,
  wiseStatusLabel,
} from './stripe-wise-payouts.logic';

describe('stripe-wise-payouts.logic', () => {
  describe('applyPaymentsToFaExtra', () => {
    it('adds a fixed $1.50 to payments → FA transfers', () => {
      expect(applyPaymentsToFaExtra(8.2)).toBe(9.7);
      expect(applyPaymentsToFaExtra(10)).toBe(11.5);
      expect(PAYMENTS_TO_FA_EXTRA_AMOUNT).toBe(1.5);
    });
  });

  describe('parsePositiveAmount', () => {
    it('accepts a valid amount', () => {
      expect(parsePositiveAmount(500)).toBe(500);
      expect(parsePositiveAmount('500.10')).toBe(500.1);
    });

    it('rejects zero and negative amounts', () => {
      expect(() => parsePositiveAmount(0)).toThrow(/greater than zero/);
      expect(() => parsePositiveAmount(-10)).toThrow(/greater than zero/);
    });

    it('rejects non-numeric values', () => {
      expect(() => parsePositiveAmount('abc')).toThrow(/valid number/);
    });
  });

  describe('assertAmountWithinBalance', () => {
    it('allows amounts within the Stripe available balance', () => {
      expect(() => assertAmountWithinBalance(500, 2500, 'USD')).not.toThrow();
    });

    it('rejects amounts above the available balance', () => {
      expect(() => assertAmountWithinBalance(3000, 2500, 'USD')).toThrow(
        /exceeds Stripe available balance/,
      );
    });
  });

  describe('stripe amount conversion', () => {
    it('converts USD to cents and back', () => {
      expect(toStripeAmount(500, 'USD')).toBe(50000);
      expect(fromStripeAmount(50000, 'USD')).toBe(500);
    });

    it('keeps JPY as a zero-decimal currency', () => {
      expect(toStripeAmount(500, 'JPY')).toBe(500);
      expect(fromStripeAmount(500, 'JPY')).toBe(500);
    });
  });

  describe('status mapping', () => {
    it('maps Stripe payout statuses', () => {
      expect(mapStripePayoutStatus('pending')).toBe('pending');
      expect(mapStripePayoutStatus('in_transit')).toBe('in_transit');
      expect(mapStripePayoutStatus('paid')).toBe('paid');
      expect(mapStripePayoutStatus('failed')).toBe('failed');
      expect(mapStripePayoutStatus('canceled')).toBe('canceled');
      expect(stripeStatusLabel('in_transit')).toBe('In Transit');
      expect(wiseStatusLabel('received')).toBe('Received');
    });

    it('does not treat a created payout as Wise received', () => {
      expect(shouldApplyWiseReceipt('pending', 'not_started')).toBe(false);
      expect(shouldApplyWiseReceipt('in_transit', 'awaiting_receipt')).toBe(
        false,
      );
      expect(shouldApplyWiseReceipt('paid', 'awaiting_receipt')).toBe(true);
      expect(shouldApplyWiseReceipt('paid', 'received')).toBe(false);
    });
  });

  describe('settlement math', () => {
    it('adds the received Stripe payout to the previous Wise balance', () => {
      expect(computeSettlement(100, 500)).toEqual({
        previousBalance: 100,
        receivedAmount: 500,
        newBalance: 600,
      });
    });

    it('matches amounts with a small receiving-fee tolerance', () => {
      expect(amountsMatch(500, 500)).toBe(true);
      expect(amountsMatch(500, 490)).toBe(true);
      expect(amountsMatch(500, 400)).toBe(false);
    });
  });

  describe('masking', () => {
    it('masks account numbers and keeps last4', () => {
      expect(last4('000123456789')).toBe('6789');
      expect(maskSecret('000123456789')).toBe('********6789');
      expect(normalizeCurrency('usd')).toBe('USD');
      expect(formatMoney(2500, 'USD')).toContain('2,500.00');
    });
  });

  describe('normalizeCurrency', () => {
    it('reads Wise currency objects instead of stringifying them', () => {
      expect(normalizeCurrency({ code: 'EUR', name: 'Euro' })).toBe('EUR');
      expect(normalizeCurrency({ currency: 'usd' })).toBe('USD');
      expect(normalizeCurrency('[object Object]')).toBe('');
    });
  });

  describe('userFacingStripeError', () => {
    it('maps insufficient funds', () => {
      expect(
        userFacingStripeError({ code: 'balance_insufficient' }),
      ).toMatch(/insufficient/i);
    });
  });

  describe('resolveStripeApiVersion', () => {
    it('uses the Europe Dahlia API version by default', () => {
      expect(resolveStripeApiVersion('europe')).toBe('2026-07-29.dahlia');
    });

    it('uses STRIPE_API_VERSION for global and usa accounts', () => {
      const getEnv = (key: string) =>
        key === 'STRIPE_API_VERSION' ? '2025-01-27.acacia' : undefined;
      expect(resolveStripeApiVersion('global', getEnv)).toBe('2025-01-27.acacia');
      expect(resolveStripeApiVersion('usa', getEnv)).toBe('2025-01-27.acacia');
    });

    it('allows EUROPE_STRIPE_API_VERSION override', () => {
      const getEnv = (key: string) =>
        key === 'EUROPE_STRIPE_API_VERSION' ? '2026-08-01.custom' : undefined;
      expect(resolveStripeApiVersion('europe', getEnv)).toBe('2026-08-01.custom');
    });
  });

  describe('resolveShopOrderStripeAccountKey', () => {
    it('uses USA Stripe when shipping country is United States', () => {
      expect(
        resolveShopOrderStripeAccountKey('United States', 'United Arab Emirates'),
      ).toBe('usa');
      expect(isUsaShopOrder('United States', 'United Arab Emirates')).toBe(true);
    });

    it('uses Global Stripe when shipping is outside the USA and Europe', () => {
      expect(
        resolveShopOrderStripeAccountKey('United Arab Emirates', 'United States'),
      ).toBe('global');
    });

    it('uses Europe Stripe for supported European countries', () => {
      expect(resolveShopOrderStripeAccountKey('Germany', 'Pakistan')).toBe(
        'europe',
      );
      expect(resolveShopOrderStripeAccountKey('Netherlands', 'United States')).toBe(
        'europe',
      );
      expect(isEuropeShopOrder('France', 'United States')).toBe(true);
    });

    it('requires online payment for USA and Europe Stripe regions', () => {
      expect(requiresOnlinePaymentShopOrder('Germany', 'Pakistan')).toBe(true);
      expect(requiresOnlinePaymentShopOrder('United States', 'Germany')).toBe(true);
      expect(requiresOnlinePaymentShopOrder('Pakistan', 'Germany')).toBe(false);
    });

    it('falls back to user country when shipping is missing', () => {
      expect(resolveShopOrderStripeAccountKey('', 'United States')).toBe('usa');
      expect(resolveShopOrderStripeAccountKey(undefined, 'USA')).toBe('usa');
      expect(resolveShopOrderStripeAccountKey('', 'Germany')).toBe('europe');
    });
  });

  describe('resolveAutomatedCommissionSourceType', () => {
    it('forces Europe commission transfers onto payments_balance', () => {
      expect(resolveAutomatedCommissionSourceType('europe')).toBe(
        'payments_balance',
      );
      expect(
        resolveAutomatedCommissionSourceType('europe', 'financial_account'),
      ).toBe('payments_balance');
    });

    it('defaults Global/USA to financial_account', () => {
      expect(resolveAutomatedCommissionSourceType('global')).toBe(
        'financial_account',
      );
      expect(resolveAutomatedCommissionSourceType('usa')).toBe(
        'financial_account',
      );
    });

    it('allows env override to payments_balance for Global/USA only', () => {
      expect(
        resolveAutomatedCommissionSourceType('global', 'payments_balance'),
      ).toBe('payments_balance');
      expect(
        resolveAutomatedCommissionSourceType('usa', 'payments_balance'),
      ).toBe('payments_balance');
    });
  });
});
