import {
  calculateCommissionEntries,
  calculateRepresentativeCommissionEntries,
  resolveCommissionOrderAmounts,
  resolvePartnerDevelopmentRepresentative,
  resolveShopCommissionChain,
  resolveShopEarningAssignments,
} from './commission-distribution';

describe('resolveCommissionOrderAmounts', () => {
  it('uses locked FX rate for non-USD orders', () => {
    const result = resolveCommissionOrderAmounts({
      originalAmount: 10000,
      originalCurrency: 'PKR',
      exchangeRateAtOrderTime: 0.0035,
      baseCurrencyAmount: 35,
    });
    expect(result).toEqual({
      orderAmount: 10000,
      orderCurrency: 'PKR',
      exchangeRateToUsd: 0.0035,
      convertedUsdAmount: 35,
    });
  });

  it('defaults USD orders to rate 1', () => {
    const result = resolveCommissionOrderAmounts({
      totalAmount: 100,
      currency: 'USD',
    });
    expect(result).toEqual({
      orderAmount: 100,
      orderCurrency: 'USD',
      exchangeRateToUsd: 1,
      convertedUsdAmount: 100,
    });
  });
});

describe('calculateRepresentativeCommissionEntries', () => {
  const rep2 = { _id: 'rep2', partnerCode: 'REP0002', role: 'master_partner' };
  const rep1 = { _id: 'rep1', partnerCode: 'REP0001', role: 'master_partner' };
  const monetary = (usd: number) => ({
    orderAmount: usd,
    orderCurrency: 'USD',
    exchangeRateToUsd: 1,
    convertedUsdAmount: usd,
  });

  it('first order: 5% Shop Introduction + 5% Partner Development (10% total, never 15%)', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: { partnerDevelopmentCommissionPaid: false },
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep1 },
      monetary: monetary(100),
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      recipientPartnerCode: 'REP0002',
      earningType: 'Shop Introduction',
      percentage: 5,
      amount: 5,
    });
    expect(entries[1]).toMatchObject({
      recipientPartnerCode: 'REP0001',
      earningType: 'Partner Development',
      percentage: 5,
      amount: 5,
    });

    const total = entries.reduce((sum, e) => sum + e.percentage, 0);
    expect(total).toBe(10);
  });

  it('subsequent orders: 10% Shop Introduction only, Partner Development is $0', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: { partnerDevelopmentCommissionPaid: true },
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep1 },
      monetary: monetary(100),
      isFirstSuccessfulOrder: false,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      recipientPartnerCode: 'REP0002',
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
  });

  it('first order without a Partner Development rep: full 10% to Shop Introduction', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {},
      recipients: { shopIntroduction: rep2, partnerDevelopment: null },
      monetary: monetary(100),
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
  });

  it('first order when Partner Development already paid: full 10% to Shop Introduction', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: { partnerDevelopmentCommissionPaid: true },
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep1 },
      monetary: monetary(100),
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
  });

  it('never pays Partner Development to the same Representative as Shop Introduction', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {},
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep2 },
      monetary: monetary(100),
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].percentage).toBe(10);
  });

  it('no Shop Introduction recipient means no commissions at all', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {},
      recipients: { shopIntroduction: null, partnerDevelopment: rep1 },
      monetary: monetary(100),
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(0);
  });

  it('converts to USD using the locked FX rate', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {},
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep1 },
      monetary: {
        orderAmount: 100,
        orderCurrency: 'EUR',
        exchangeRateToUsd: 1.08,
        convertedUsdAmount: 108,
      },
      isFirstSuccessfulOrder: true,
    });

    expect(entries[0].amount).toBe(5.4);
    expect(entries[1].amount).toBe(5.4);
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

  it('resolves the Representative even when the shop links through a promoter chain', async () => {
    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: 'PROM01' },
      lookup,
    );

    expect(chain.promoter?.partnerCode).toBe('PROM01');
    expect(chain.represented?.partnerCode).toBe('REP01');
  });

  it('resolves the Representative through a sub-promoter chain', async () => {
    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: 'SUB001' },
      lookup,
    );

    expect(chain.subPromoter?.partnerCode).toBe('SUB001');
    expect(chain.represented?.partnerCode).toBe('REP01');
  });

  it('resolves the Representative directly', async () => {
    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: 'REP01' },
      lookup,
    );

    expect(chain.represented?.partnerCode).toBe('REP01');
    expect(chain.promoter).toBeNull();
  });
});

describe('resolvePartnerDevelopmentRepresentative', () => {
  const rep1 = {
    _id: { toString: () => 'rep1' },
    partnerCode: 'REP0001',
    role: 'master_partner',
  };
  const rep2Parent = {
    _id: { toString: () => 'rep2' },
    partnerCode: 'REP0002',
    role: 'master_partner',
    referredByPartnerCode: 'REP0001',
  };

  const lookup = async (code: string) => {
    if (code === 'REP0001') return rep1;
    if (code === 'REP0002') return rep2Parent;
    return null;
  };

  it('prefers the explicit partnerDevelopmentRepresentativeCode', async () => {
    const result = await resolvePartnerDevelopmentRepresentative(
      { partnerDevelopmentRepresentativeCode: 'REP0001' },
      lookup,
    );
    expect(result?.partnerCode).toBe('REP0001');
  });

  it('falls back to referredByPartnerCode when no explicit PD rep is set', async () => {
    const result = await resolvePartnerDevelopmentRepresentative(
      { referredByPartnerCode: 'REP0001' },
      lookup,
    );
    expect(result?.partnerCode).toBe('REP0001');
  });

  it('returns null when neither resolves to a Representative', async () => {
    const result = await resolvePartnerDevelopmentRepresentative({}, lookup);
    expect(result).toBeNull();
  });
});

describe('resolveShopEarningAssignments', () => {
  const rep2 = {
    _id: { toString: () => 'rep2' },
    partnerCode: 'REP0002',
    role: 'master_partner',
    referredByPartnerCode: undefined as string | undefined,
    partnerDevelopmentRepresentativeCode: 'REP0001',
  };
  const rep1 = {
    _id: { toString: () => 'rep1' },
    partnerCode: 'REP0001',
    role: 'master_partner',
  };

  const lookup = async (code: string) => {
    if (code === 'REP0002') return rep2;
    if (code === 'REP0001') return rep1;
    return null;
  };

  it('assigns Shop Introduction + Partner Development from the chain on first resolution', async () => {
    const result = await resolveShopEarningAssignments(
      { _id: { toString: () => 'shop1' }, referredByPartnerCode: 'REP0002' },
      lookup,
    );

    expect(result.shopIntroductionRepresentativeCode).toBe('REP0002');
    expect(result.partnerDevelopmentRepresentativeCode).toBe('REP0001');
    expect(result.partnerDevelopmentCommissionPaid).toBe(false);
  });

  it('never overwrites an already-assigned Shop Introduction rep (immutable)', async () => {
    const result = await resolveShopEarningAssignments(
      {
        _id: { toString: () => 'shop1' },
        referredByPartnerCode: 'REP0001', // would resolve differently if re-evaluated
        shopIntroductionRepresentativeCode: 'REP0002',
      },
      lookup,
    );

    expect(result.shopIntroductionRepresentativeCode).toBe('REP0002');
  });

  it('backfills only the missing Partner Development assignment when Shop Introduction already exists', async () => {
    const result = await resolveShopEarningAssignments(
      {
        _id: { toString: () => 'shop1' },
        shopIntroductionRepresentativeCode: 'REP0002',
      },
      lookup,
    );

    expect(result.partnerDevelopmentRepresentativeCode).toBe('REP0001');
  });
});

describe('calculateCommissionEntries (deprecated legacy wrapper)', () => {
  it('still pays the Representative found via the promoter chain', () => {
    const entries = calculateCommissionEntries(
      100,
      {
        isDirectHub: false,
        represented: { _id: 'rep1', partnerCode: 'REP01', role: 'master_partner' },
        promoter: { _id: 'prom1', partnerCode: 'PROM01', role: 'regional_partner' },
        subPromoter: null,
      },
      1,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      recipientPartnerCode: 'REP01',
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
  });

  it('returns nothing for a direct-hub shop', () => {
    const entries = calculateCommissionEntries(100, {
      isDirectHub: true,
      represented: null,
      promoter: null,
      subPromoter: null,
    });
    expect(entries).toHaveLength(0);
  });
});
