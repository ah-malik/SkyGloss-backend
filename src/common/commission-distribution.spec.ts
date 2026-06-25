import {
  calculateCommissionEntries,
  resolveCommissionOrderAmounts,
  resolveShopCommissionChain,
  resolveCommissionRateDecimal,
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

  it('allocates 20% + 10% + 5% when sub-promoter exists (35% total)', () => {
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
    expect(entries[0]).toMatchObject({
      recipientRole: 'master_partner',
      percentage: 20,
      amount: 20,
    });
    expect(entries[1]).toMatchObject({
      recipientRole: 'regional_partner',
      percentage: 10,
      amount: 10,
    });
    expect(entries[2]).toMatchObject({
      recipientRole: 'sub_promoter',
      percentage: 5,
      amount: 5,
    });
  });

  it('uses per-user custom commission rates when set', () => {
    const entries = calculateCommissionEntries(
      100,
      {
        ...chainBase,
        represented: {
          ...chainBase.represented,
          customCommissionRate: 25,
        },
        promoter: {
          ...chainBase.promoter,
          customCommissionRate: 12,
        },
        subPromoter: {
          _id: 'sub1',
          partnerCode: '0003',
          role: 'sub_promoter',
          customCommissionRate: 8,
        },
      },
      1,
    );

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ percentage: 25, amount: 25 });
    expect(entries[1]).toMatchObject({ percentage: 12, amount: 12 });
    expect(entries[2]).toMatchObject({ percentage: 8, amount: 8 });
  });
});

describe('resolveCommissionRateDecimal', () => {
  it('falls back to role defaults', () => {
    expect(resolveCommissionRateDecimal('master_partner')).toBe(0.2);
    expect(resolveCommissionRateDecimal('regional_partner')).toBe(0.1);
    expect(resolveCommissionRateDecimal('sub_promoter')).toBe(0.05);
  });

  it('uses custom rate when provided', () => {
    expect(resolveCommissionRateDecimal('master_partner', 15)).toBe(0.15);
  });
});

describe('resolveShopCommissionChain', () => {
  const users = {
    PROM: {
      _id: { toString: () => 'prom1' },
      partnerCode: 'PROM01',
      role: 'regional_partner',
      referredByPartnerCode: 'REP01',
    },
    SUB: {
      _id: { toString: () => 'sub1' },
      partnerCode: 'SUB001',
      role: 'sub_promoter',
      referredByPartnerCode: 'PROM01',
    },
    REP: {
      _id: { toString: () => 'rep1' },
      partnerCode: 'REP01',
      role: 'master_partner',
    },
  };

  const lookup = async (code: string) => {
    const map: Record<string, (typeof users)[keyof typeof users]> = {
      PROM01: users.PROM,
      SUB001: users.SUB,
      REP01: users.REP,
    };
    return map[code] ?? null;
  };

  it('gives full promoter commission when shop links directly to promoter', async () => {
    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: 'PROM01' },
      lookup,
    );

    expect(chain.promoter?.partnerCode).toBe('PROM01');
    expect(chain.subPromoter).toBeNull();
    expect(chain.represented?.partnerCode).toBe('REP01');

    const entries = calculateCommissionEntries(100, chain, 1);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      recipientPartnerCode: 'PROM01',
      percentage: 10,
      amount: 10,
    });
  });

  it('allocates 20% + 10% + 5% when shop links directly to sub-promoter', async () => {
    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: 'SUB001' },
      lookup,
    );

    expect(chain.subPromoter?.partnerCode).toBe('SUB001');
    expect(chain.promoter?.partnerCode).toBe('PROM01');

    const entries = calculateCommissionEntries(100, chain, 1);
    expect(entries).toHaveLength(3);
    expect(entries[1]).toMatchObject({
      recipientPartnerCode: 'PROM01',
      percentage: 10,
      amount: 10,
    });
    expect(entries[2]).toMatchObject({
      recipientPartnerCode: 'SUB001',
      percentage: 5,
      amount: 5,
    });
  });
});
