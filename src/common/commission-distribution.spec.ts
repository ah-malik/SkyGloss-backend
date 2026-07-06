import {
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
  const shopIntro = {
    _id: 'rep2',
    partnerCode: 'REP02',
    role: 'master_partner',
  };
  const partnerDev = {
    _id: 'rep1',
    partnerCode: 'REP01',
    role: 'master_partner',
  };

  const monetary = resolveCommissionOrderAmounts({
    originalAmount: 100,
    originalCurrency: 'USD',
  });

  it('splits first order 5% Shop Introduction + 5% Partner Development (10% total)', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: { partnerDevelopmentCommissionPaid: false },
      recipients: { shopIntroduction: shopIntro, partnerDevelopment: partnerDev },
      monetary,
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      earningType: 'Shop Introduction',
      percentage: 5,
      amount: 5,
      recipientPartnerCode: 'REP02',
    });
    expect(entries[1]).toMatchObject({
      earningType: 'Partner Development',
      percentage: 5,
      amount: 5,
      recipientPartnerCode: 'REP01',
    });
    expect(entries[0].amount + entries[1].amount).toBe(10);
  });

  it('gives full 10% Shop Introduction on second order with no Partner Development', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: { partnerDevelopmentCommissionPaid: true },
      recipients: { shopIntroduction: shopIntro, partnerDevelopment: partnerDev },
      monetary,
      isFirstSuccessfulOrder: false,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
      recipientPartnerCode: 'REP02',
    });
  });

  it('converts PKR order to USD before calculating commission', () => {
    const pkrMonetary = resolveCommissionOrderAmounts({
      originalAmount: 10000,
      originalCurrency: 'PKR',
      exchangeRateAtOrderTime: 0.0035,
      baseCurrencyAmount: 35,
    });

    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: { partnerDevelopmentCommissionPaid: false },
      recipients: { shopIntroduction: shopIntro, partnerDevelopment: partnerDev },
      monetary: pkrMonetary,
      isFirstSuccessfulOrder: true,
    });

    expect(entries[0].amount).toBe(1.75);
    expect(entries[1].amount).toBe(1.75);
    expect(entries[0].convertedUsdAmount).toBe(35);
    expect(entries[0].originalCurrency).toBe('PKR');
  });

  it('gives shop intro rep full 10% on first order when no partner development rep', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: {},
      recipients: { shopIntroduction: shopIntro, partnerDevelopment: null },
      monetary,
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      earningType: 'Shop Introduction',
      percentage: 10,
      amount: 10,
    });
  });
});

describe('resolvePartnerDevelopmentRepresentative', () => {
  const users = {
    REP01: {
      _id: { toString: () => 'rep1' },
      partnerCode: 'REP01',
      role: 'master_partner',
    },
    REP02: {
      _id: { toString: () => 'rep2' },
      partnerCode: 'REP02',
      role: 'master_partner',
      partnerDevelopmentRepresentativeCode: 'REP01',
      referredByPartnerCode: 'DIST01',
    },
  };

  const lookup = async (code: string) => {
    const map: Record<string, (typeof users)[keyof typeof users]> = {
      REP01: users.REP01,
      REP02: users.REP02,
    };
    return map[code] ?? null;
  };

  it('prefers explicit partnerDevelopmentRepresentativeCode on rep', async () => {
    const result = await resolvePartnerDevelopmentRepresentative(users.REP02, lookup);
    expect(result?.partnerCode).toBe('REP01');
  });
});

describe('resolveShopCommissionChain', () => {
  const users = {
    PROM01: {
      _id: { toString: () => 'prom1' },
      partnerCode: 'PROM01',
      role: 'regional_partner',
      referredByPartnerCode: 'REP02',
    },
    REP02: {
      _id: { toString: () => 'rep2' },
      partnerCode: 'REP02',
      role: 'master_partner',
      partnerDevelopmentRepresentativeCode: 'REP01',
    },
  };

  const lookup = async (code: string) => {
    const map: Record<string, (typeof users)[keyof typeof users]> = {
      PROM01: users.PROM01,
      REP02: users.REP02,
    };
    return map[code] ?? null;
  };

  it('resolves shop introduction representative via promoter chain', async () => {
    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: 'PROM01' },
      lookup,
    );

    expect(chain.represented?.partnerCode).toBe('REP02');
  });
});

describe('resolveShopEarningAssignments', () => {
  const users = {
    PROM01: {
      _id: { toString: () => 'prom1' },
      partnerCode: 'PROM01',
      role: 'regional_partner',
      referredByPartnerCode: 'REP02',
    },
    REP01: {
      _id: { toString: () => 'rep1' },
      partnerCode: 'REP01',
      role: 'master_partner',
      operationalRepresentativeCodes: ['REP02'],
    },
    REP02: {
      _id: { toString: () => 'rep2' },
      partnerCode: 'REP02',
      role: 'master_partner',
      partnerDevelopmentRepresentativeCode: 'REP01',
    },
  };

  const lookup = async (code: string) => {
    const map: Record<string, (typeof users)[keyof typeof users]> = {
      PROM01: users.PROM01,
      REP01: users.REP01,
      REP02: users.REP02,
    };
    return map[code] ?? null;
  };
  const findOperational = async (shopIntroCode: string) => {
    if (shopIntroCode === 'REP02') return users.REP01;
    return null;
  };

  it('assigns shop introduction, partner development, and operational support reps', async () => {
    const assignments = await resolveShopEarningAssignments(
      { _id: { toString: () => 'shop1' }, referredByPartnerCode: 'PROM01' },
      lookup,
      findOperational,
    );

    expect(assignments.shopIntroductionRepresentativeCode).toBe('REP02');
    expect(assignments.partnerDevelopmentRepresentativeCode).toBe('REP01');
    expect(assignments.operationalSupportRepresentativeCode).toBe('REP01');
  });

  it('fills partner development when shop introduction is already assigned', async () => {
    const assignments = await resolveShopEarningAssignments(
      {
        _id: { toString: () => 'shop1' },
        referredByPartnerCode: 'PROM01',
        shopIntroductionRepresentativeCode: 'REP02',
      },
      lookup,
      findOperational,
    );

    expect(assignments.shopIntroductionRepresentativeCode).toBe('REP02');
    expect(assignments.partnerDevelopmentRepresentativeCode).toBe('REP01');
    expect(assignments.operationalSupportRepresentativeCode).toBe('REP01');
  });
});

describe('calculateRepresentativeCommissionEntries — partner development guard', () => {
  const shopIntro = {
    _id: 'rep2',
    partnerCode: 'REP02',
    role: 'master_partner',
  };
  const partnerDev = {
    _id: 'rep1',
    partnerCode: 'REP01',
    role: 'master_partner',
  };
  const monetary = resolveCommissionOrderAmounts({
    originalAmount: 100,
    originalCurrency: 'USD',
  });

  it('does not pay partner development when already paid flag is set on first order', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop1',
      assignments: { partnerDevelopmentCommissionPaid: true },
      recipients: { shopIntroduction: shopIntro, partnerDevelopment: partnerDev },
      monetary,
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].earningType).toBe('Shop Introduction');
    expect(entries[0].percentage).toBe(10);
  });

  // Partner Development is one-time per child Representative (not per shop).
  // Once the parent has been paid for the child rep's first shop, the first
  // order of any subsequent shop by the same child rep must NOT pay it again.
  it('gives child reps second shop full 10% shop intro when partner development already paid', () => {
    const entries = calculateRepresentativeCommissionEntries({
      shopId: 'shop2',
      assignments: {
        shopIntroductionRepresentativeCode: 'REP02',
        partnerDevelopmentRepresentativeCode: 'REP01',
        partnerDevelopmentCommissionPaid: true,
      },
      recipients: { shopIntroduction: shopIntro, partnerDevelopment: partnerDev },
      monetary,
      isFirstSuccessfulOrder: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].earningType).toBe('Shop Introduction');
    expect(entries[0].percentage).toBe(10);
    expect(
      entries.some((entry) => entry.earningType === 'Partner Development'),
    ).toBe(false);
  });
});
