import {
  calculateCommissionEntries,
  resolveCommissionOrderAmounts,
} from './commission-distribution';

describe('resolveCommissionOrderAmounts', () => {
  it('uses locked FX rate for non-USD orders', () => {
    const result = resolveCommissionOrderAmounts({
      originalAmount: 100,
      originalCurrency: 'EUR',
      exchangeRateAtOrderTime: 1.08,
      baseCurrencyAmount: 108,
    });
    expect(result).toEqual({
      orderAmount: 100,
      orderCurrency: 'EUR',
      exchangeRateToUsd: 1.08,
    });
  });

  it('defaults USD orders to rate 1', () => {
    const result = resolveCommissionOrderAmounts({
      totalAmount: 50,
      currency: 'USD',
    });
    expect(result).toEqual({
      orderAmount: 50,
      orderCurrency: 'USD',
      exchangeRateToUsd: 1,
    });
  });
});

describe('calculateCommissionEntries', () => {
  const chainBase = {
    isDirectHub: false,
    represented: {
      _id: 'rep1',
      partnerCode: '0001',
      role: 'master_partner',
    },
    promoter: {
      _id: 'prom1',
      partnerCode: '0002',
      role: 'regional_partner',
    },
    subPromoter: null as null,
  };

  it('calculates commission in order currency then converts to USD', () => {
    const entries = calculateCommissionEntries(100, chainBase, 1.08);
    expect(entries).toHaveLength(2);
    expect(entries[0].amount).toBe(21.6);
    expect(entries[1].amount).toBe(10.8);
  });

  it('keeps USD amounts unchanged when order is USD', () => {
    const entries = calculateCommissionEntries(100, chainBase, 1);
    expect(entries[0].amount).toBe(20);
    expect(entries[1].amount).toBe(10);
  });

  it('splits promoter commission 5% + 5% when sub-promoter exists', () => {
    const entries = calculateCommissionEntries(
      100,
      {
        ...chainBase,
        subPromoter: {
          _id: 'sub1',
          partnerCode: '0003',
          role: 'sub_promoter',
        },
      },
      1,
    );

    expect(entries).toHaveLength(3);
    expect(entries[1]).toMatchObject({
      recipientRole: 'regional_partner',
      percentage: 5,
      amount: 5,
    });
    expect(entries[2]).toMatchObject({
      recipientRole: 'sub_promoter',
      percentage: 5,
      amount: 5,
    });
  });
});
