import {
  calculateCommissionEntries,
  calculateHierarchyCommissionEntries,
  calculateRepresentativeCommissionEntries,
  DEFAULT_COMMISSION_RATES_PERCENT,
  DEFAULT_PARTNER_INTRO_RATE_PERCENT,
  normalizeFirstOrderCommissionRates,
  resolveCommissionOrderAmounts,
  resolvePartnerDevelopmentRepresentative,
  resolveShopCommissionChain,
  resolveShopEarningAssignments,
  shouldUseFirstOrderNetworkCommission,
} from './commission-distribution';

describe('resolveCommissionOrderAmounts', () => {
  it('uses locked FX rate for non-USD orders', () => {
    const result = resolveCommissionOrderAmounts({
      originalAmount: 10000,
      originalCurrency: 'PKR',
      exchangeRateAtOrderTime: 0.0035,
      baseCurrencyAmount: 35,
    });
    // 10000 − 3.5% = 9650; USD = 9650 × 0.0035 = 33.775 → 33.78
    expect(result).toEqual({
      orderAmount: 9650,
      orderCurrency: 'PKR',
      exchangeRateToUsd: 0.0035,
      convertedUsdAmount: 33.78,
    });
  });

  it('defaults USD orders to rate 1', () => {
    const result = resolveCommissionOrderAmounts({
      totalAmount: 100,
      currency: 'USD',
    });
    // 100 − 3.5% = 96.5
    expect(result).toEqual({
      orderAmount: 96.5,
      orderCurrency: 'USD',
      exchangeRateToUsd: 1,
      convertedUsdAmount: 96.5,
    });
  });

  it('excludes shipping fee then deducts 3.5% from remaining', () => {
    // $125 − $25 shipping = $100; $100 − 3.5% = $96.50
    const result = resolveCommissionOrderAmounts({
      totalAmount: 125,
      shippingFee: 25,
      currency: 'USD',
    });
    expect(result).toEqual({
      orderAmount: 96.5,
      orderCurrency: 'USD',
      exchangeRateToUsd: 1,
      convertedUsdAmount: 96.5,
    });
  });

  it('excludes shipping from non-USD commission base using FX', () => {
    const result = resolveCommissionOrderAmounts({
      originalAmount: 120,
      shippingFee: 20,
      originalCurrency: 'EUR',
      exchangeRateAtOrderTime: 1.1,
    });
    // 100 − 3.5% = 96.5; USD = 96.5 × 1.1 = 106.15
    expect(result.orderAmount).toBe(96.5);
    expect(result.convertedUsdAmount).toBe(106.15);
  });
});

describe('calculateRepresentativeCommissionEntries (10/5/10 of order $)', () => {
  const rep2 = { _id: 'rep2', partnerCode: 'REP0002', role: 'master_partner' };
  const rep1 = { _id: 'rep1', partnerCode: 'REP0001', role: 'master_partner' };
  const monetary = (usd: number) => ({
    orderAmount: usd,
    orderCurrency: 'USD',
    exchangeRateToUsd: 1,
    convertedUsdAmount: usd,
  });

  it('pays Shop Intro 10% + Partner Intro 5% of order $ on every order', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {
        partnerDevelopmentEligible: true,
        partnerDevelopmentRatePercent: 5,
        shopIntroductionFirstOrderRatePercent: 10,
        partnerDevelopmentRepresentativeCode: 'REP0001',
      },
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep1 },
      monetary: monetary(100),
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      recipientPartnerCode: 'REP0002',
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
    expect(entries[1]).toMatchObject({
      recipientPartnerCode: 'REP0001',
      earningType: 'Partner Development',
      percentage: 5,
      amount: 5, // 5% of order $, not of child SI
    });
  });

  it('subsequent orders still pay Partner Intro', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {
        partnerDevelopmentCommissionPaid: true,
        partnerDevelopmentEligible: true,
        partnerDevelopmentRatePercent: 5,
        shopIntroductionFirstOrderRatePercent: 10,
        partnerDevelopmentRepresentativeCode: 'REP0001',
      },
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep1 },
      monetary: monetary(100),
      isFirstSuccessfulOrder: false,
    });

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.earningType === 'Partner Development')).toMatchObject({
      percentage: 5,
      amount: 5,
    });
  });

  it('plain Shop Intro without Partner Intro uses default 10%', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop-old',
      assignments: {
        partnerDevelopmentEligible: false,
      },
      recipients: { shopIntroduction: rep2, partnerDevelopment: null },
      monetary: monetary(100),
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      recipientPartnerCode: 'REP0002',
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
  });

  it('Operational Support 10% can equal Shop Intro recipient', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {
        partnerDevelopmentEligible: false,
        shopIntroductionFirstOrderRatePercent: 10,
      },
      recipients: {
        shopIntroduction: rep2,
        partnerDevelopment: null,
        operationalSupport: rep2,
      },
      monetary: monetary(100),
      operationalSupportRatePercent: 10,
    });

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.earningType === 'Shop Introduction')).toMatchObject({
      recipientPartnerCode: 'REP0002',
      amount: 10,
    });
    expect(entries.find((e) => e.earningType === 'Operational Support')).toMatchObject({
      recipientPartnerCode: 'REP0002',
      percentage: 10,
      amount: 10,
    });
  });

  it('pays Operational Support only when Shop Introduction partner is unassigned', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop-os-only',
      assignments: {},
      recipients: {
        shopIntroduction: null,
        partnerDevelopment: null,
        operationalSupport: rep2,
      },
      monetary: monetary(100),
      operationalSupportRatePercent: 20,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      recipientPartnerCode: 'REP0002',
      earningType: 'Operational Support',
      percentage: 20,
      amount: 20,
    });
  });

  it('never pays Partner Intro to the same user as Shop Intro', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {
        partnerDevelopmentEligible: true,
        shopIntroductionFirstOrderRatePercent: 10,
      },
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep2 },
      monetary: monetary(100),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].percentage).toBe(10);
  });

  it('converts to USD using the locked FX rate', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {
        partnerDevelopmentEligible: true,
        partnerDevelopmentRatePercent: 5,
        shopIntroductionFirstOrderRatePercent: 10,
      },
      recipients: { shopIntroduction: rep2, partnerDevelopment: rep1 },
      monetary: {
        orderAmount: 100,
        orderCurrency: 'EUR',
        exchangeRateToUsd: 1.08,
        convertedUsdAmount: 108,
      },
    });

    expect(entries[0].amount).toBe(10.8); // 10% of $108
    expect(entries[1].amount).toBe(5.4); // 5% of $108
  });
});

describe('Promoter Shop Intro + Partner Intro + OS', () => {
  const rep = { _id: 'rep1', partnerCode: 'REP0001', role: 'master_partner' };
  const parentProm = {
    _id: 'prom1',
    partnerCode: 'PROM0001',
    role: 'regional_partner',
  };
  const childProm = {
    _id: 'prom2',
    partnerCode: 'PROM0002',
    role: 'regional_partner',
  };
  const monetary = (usd: number) => ({
    orderAmount: usd,
    orderCurrency: 'USD',
    exchangeRateToUsd: 1,
    convertedUsdAmount: usd,
  });

  it('pays SI 10% + Partner Intro 5% + OS 10% of order $', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {
        partnerDevelopmentEligible: true,
        partnerDevelopmentRatePercent: 5,
        shopIntroductionFirstOrderRatePercent: 10,
      },
      recipients: {
        shopIntroduction: childProm,
        partnerDevelopment: parentProm,
        operationalSupport: rep,
      },
      monetary: monetary(100),
      operationalSupportRatePercent: 10,
    });

    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.recipientPartnerCode === 'PROM0002')).toMatchObject({
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
    expect(entries.find((e) => e.recipientPartnerCode === 'PROM0001')).toMatchObject({
      earningType: 'Partner Development',
      percentage: 5,
      amount: 5,
    });
    expect(entries.find((e) => e.recipientPartnerCode === 'REP0001')).toMatchObject({
      earningType: 'Operational Support',
      percentage: 10,
      amount: 10,
    });
  });
});

describe('normalizeFirstOrderCommissionRates', () => {
  it('defaults to 10% Shop Intro and 5% Partner Intro', () => {
    expect(normalizeFirstOrderCommissionRates()).toEqual({
      shopIntroductionRate: 10,
      partnerDevelopmentRate: 5,
    });
  });

  it('allows Partner Intro rate independent of Shop Intro', () => {
    expect(
      normalizeFirstOrderCommissionRates({
        shopIntroductionRate: 10,
        partnerDevelopmentRate: 5,
      }),
    ).toEqual({
      shopIntroductionRate: 10,
      partnerDevelopmentRate: 5,
    });
  });
});

describe('shouldUseFirstOrderNetworkCommission', () => {
  it('uses earning-type path for Rep / Promoter Shop Intro', () => {
    expect(
      shouldUseFirstOrderNetworkCommission({
        shopIntroductionRole: 'master_partner',
      }),
    ).toBe(true);
    expect(
      shouldUseFirstOrderNetworkCommission({
        shopIntroductionRole: 'regional_partner',
      }),
    ).toBe(true);
  });

  it('uses earning-type path when Operational Support is assigned', () => {
    expect(
      shouldUseFirstOrderNetworkCommission({
        hasOperationalSupport: true,
      }),
    ).toBe(true);
  });
});

describe('calculateHierarchyCommissionEntries', () => {
  const monetary = {
    orderAmount: 100,
    orderCurrency: 'USD',
    exchangeRateToUsd: 1,
    convertedUsdAmount: 100,
  };

  it('Rep → Shop: 10% Shop Introduction', () => {
    const entries = calculateHierarchyCommissionEntries({
      shopId: 's1',
      chain: {
        promoter: null,
        subPromoter: null,
        represented: {
          _id: 'r1',
          partnerCode: 'REP1',
          role: 'master_partner',
        },
        isDirectHub: false,
      },
      monetary,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      earningType: 'Shop Introduction',
      percentage: DEFAULT_COMMISSION_RATES_PERCENT.master_partner,
      amount: 10,
    });
  });

  it('Rep → Promoter → Shop: Promoter SI + Rep Partner Intro (not auto OS)', () => {
    const entries = calculateHierarchyCommissionEntries({
      shopId: 's1',
      chain: {
        promoter: {
          _id: 'p1',
          partnerCode: 'PROM1',
          role: 'regional_partner',
        },
        subPromoter: null,
        represented: {
          _id: 'r1',
          partnerCode: 'REP1',
          role: 'master_partner',
        },
        isDirectHub: false,
      },
      monetary,
    });
    expect(entries.find((e) => e.earningType === 'Shop Introduction')).toMatchObject({
      recipientPartnerCode: 'PROM1',
      percentage: 10,
      amount: 10,
    });
    expect(entries.find((e) => e.earningType === 'Partner Development')).toMatchObject({
      recipientPartnerCode: 'REP1',
      percentage: DEFAULT_PARTNER_INTRO_RATE_PERCENT,
      amount: 5,
    });
    expect(entries.some((e) => e.earningType === 'Operational Support')).toBe(false);
  });
});

describe('resolveShopEarningAssignments', () => {
  it('does not auto-assign Operational Support', async () => {
    const users: Record<string, any> = {
      REP2: {
        _id: { toString: () => 'id-rep2' },
        partnerCode: 'REP2',
        role: 'master_partner',
        partnerDevelopmentRepresentativeCode: 'REP1',
      },
      REP1: {
        _id: { toString: () => 'id-rep1' },
        partnerCode: 'REP1',
        role: 'master_partner',
      },
    };

    const result = await resolveShopEarningAssignments(
      { _id: { toString: () => 'shop1' }, referredByPartnerCode: 'REP2' },
      async (code) => users[code] || null,
      async () => users.REP1,
    );

    expect(result.shopIntroductionRepresentativeCode).toBe('REP2');
    expect(result.partnerDevelopmentRepresentativeCode).toBe('REP1');
    expect(result.operationalSupportRepresentativeCode).toBeUndefined();
  });
});

describe('resolvePartnerDevelopmentRepresentative', () => {
  it('uses explicit Partner Intro code on the Shop Intro user', async () => {
    const result = await resolvePartnerDevelopmentRepresentative(
      {
        partnerDevelopmentRepresentativeCode: 'REP1',
        referredByPartnerCode: 'HUB1',
      },
      async (code) =>
        code === 'REP1'
          ? {
              _id: { toString: () => 'id1' },
              partnerCode: 'REP1',
              role: 'master_partner',
            }
          : null,
    );
    expect(result?.partnerCode).toBe('REP1');
  });
});

describe('resolveShopCommissionChain', () => {
  it('resolves Rep → Shop', async () => {
    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: 'REP1' },
      async () => ({
        _id: { toString: () => 'r1' },
        partnerCode: 'REP1',
        role: 'master_partner',
      }),
    );
    expect(chain.represented?.partnerCode).toBe('REP1');
    expect(chain.promoter).toBeNull();
  });
});

describe('calculateCommissionEntries (deprecated wrapper)', () => {
  it('returns Shop Intro for represented chain', () => {
    const entries = calculateCommissionEntries(100, {
      promoter: null,
      subPromoter: null,
      represented: {
        _id: 'r1',
        partnerCode: 'REP1',
        role: 'master_partner',
      },
      isDirectHub: false,
    });
    expect(entries[0]?.earningType).toBe('Shop Introduction');
  });
});
