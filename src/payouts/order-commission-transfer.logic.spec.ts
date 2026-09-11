import {
  buildOrderCommissionIdempotencyKey,
  convertUsdCommissionToEur,
  extractCommissionLines,
  mapStripePayoutToTransferStatus,
  resolveCommissionPayoutCurrency,
  sumCommissionLines,
  summarizeCommissionTypes,
} from './order-commission-transfer.logic';

describe('order-commission-transfer.logic', () => {
  describe('convertUsdCommissionToEur', () => {
    it('converts USD commission to EUR using rateToBase', () => {
      // 1 EUR = 1.13 USD → $1.40 ≈ €1.24
      expect(convertUsdCommissionToEur(1.4, 1.13)).toBe(1.24);
      expect(convertUsdCommissionToEur(11.3, 1.13)).toBe(10);
    });

    it('returns 0 for non-positive USD amounts', () => {
      expect(convertUsdCommissionToEur(0, 1.13)).toBe(0);
      expect(convertUsdCommissionToEur(-5, 1.13)).toBe(0);
    });
  });

  describe('resolveCommissionPayoutCurrency', () => {
    it('uses EUR only for Europe Stripe commissions', () => {
      expect(resolveCommissionPayoutCurrency('europe')).toBe('EUR');
      expect(resolveCommissionPayoutCurrency('global')).toBe('USD');
      expect(resolveCommissionPayoutCurrency('usa')).toBe('USD');
    });
  });

  describe('extractCommissionLines', () => {
    it('copies existing order commission lines without recalculating', () => {
      const lines = extractCommissionLines([
        {
          recipientUserId: 'u1',
          earningType: 'Partner Development',
          amount: 20,
          percentage: 10,
        },
        {
          recipientUserId: 'u2',
          earningType: 'Shop Introduction',
          amount: 15,
        },
        {
          recipientUserId: 'u3',
          earningType: 'Operational Support',
          amount: 15,
        },
      ]);
      expect(lines).toHaveLength(3);
      expect(sumCommissionLines(lines)).toBe(50);
    });

    it('ignores zero-amount lines', () => {
      expect(
        sumCommissionLines(
          extractCommissionLines([
            { earningType: 'Partner Development', amount: 0 },
            { earningType: 'Shop Introduction', amount: 25 },
          ]),
        ),
      ).toBe(25);
    });
  });

  describe('summarizeCommissionTypes', () => {
    it('summarizes commission types for admin display', () => {
      expect(
        summarizeCommissionTypes([
          { amount: 20, earningType: 'Partner Development' },
          { amount: 15, earningType: 'Shop Introduction' },
          { amount: 15, earningType: 'Operational Support' },
        ]),
      ).toBe('Partner + Shop + Operational');
    });
  });

  describe('buildOrderCommissionIdempotencyKey', () => {
    it('builds stable key per order', () => {
      expect(buildOrderCommissionIdempotencyKey('abc123')).toBe(
        'order-commission:abc123',
      );
      expect(buildOrderCommissionIdempotencyKey('abc123', 2)).toBe(
        'order-commission:abc123:retry:2',
      );
    });
  });

  describe('mapStripePayoutToTransferStatus', () => {
    it('maps paid stripe payout to completed', () => {
      expect(mapStripePayoutToTransferStatus('paid', 'awaiting_receipt')).toBe(
        'completed',
      );
    });

    it('maps in-flight stripe payout to processing', () => {
      expect(mapStripePayoutToTransferStatus('in_transit')).toBe('processing');
    });

    it('maps failed stripe payout to failed', () => {
      expect(mapStripePayoutToTransferStatus('failed')).toBe('failed');
    });
  });
});
