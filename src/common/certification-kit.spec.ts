import {
  applyCertificationKitDiscount,
  CERTIFICATION_KIT_DISCOUNT_PERCENT,
  CERTIFICATION_KIT_ENABLED,
  isCertificationKitEligibleUser,
  isCertificationKitProductId,
  resolveCertificationKitComponents,
} from './certification-kit';

describe('certification-kit', () => {
  it('is temporarily disabled via CERTIFICATION_KIT_ENABLED', () => {
    expect(CERTIFICATION_KIT_ENABLED).toBe(false);
    expect(
      isCertificationKitEligibleUser({
        role: 'shop',
        registrationSource: 'self',
        isPaid: false,
      }),
    ).toBe(false);
  });

  it('applies ~7% discount (1070 → 995.1)', () => {
    const result = applyCertificationKitDiscount(1070);
    expect(result.subtotal).toBe(1070);
    expect(result.discount).toBeCloseTo(74.9, 5);
    expect(result.total).toBeCloseTo(995.1, 5);
    expect(CERTIFICATION_KIT_DISCOUNT_PERCENT).toBe(7);
  });

  it('identifies virtual kit product id', () => {
    expect(isCertificationKitProductId('certification_kit_bundle')).toBe(true);
    expect(isCertificationKitProductId('abc')).toBe(false);
  });

  it('resolves kit components from catalog', () => {
    const catalog = [
      {
        _id: 'f1',
        name: 'FUSION',
        sizes: [
          { size: '500ml', price: 100, groupPrice: 100 },
          { size: '2L', price: 400, groupPrice: 400 },
        ],
      },
      {
        _id: 'a1',
        name: 'Applicators (2-Pack)',
        sizes: [{ size: '2-Pack', price: 20, groupPrice: 20 }],
      },
      {
        _id: 'b1',
        name: 'Applicator Bottle',
        sizes: [{ size: '1pc', price: 10, groupPrice: 10 }],
      },
      {
        _id: 's1',
        name: 'SEAL',
        sizes: [{ size: '500ml', price: 50, groupPrice: 50 }],
      },
    ];
    const components = resolveCertificationKitComponents(catalog);
    expect(components).not.toBeNull();
    expect(components).toHaveLength(4);
    expect(components![0].quantity).toBe(1);
    expect(components![1].quantity).toBe(10);
    expect(components![2].quantity).toBe(4);
    expect(components![3].quantity).toBe(2);
    const subtotal = components!.reduce(
      (sum, c) => sum + c.unitPrice * c.quantity,
      0,
    );
    // 400 + 20*10 + 10*4 + 50*2 = 400+200+40+100 = 740
    expect(subtotal).toBe(740);
  });

  it('uses unpaid charge price (+10%), not groupPrice', () => {
    const catalog = [
      {
        _id: 'f1',
        name: 'FUSION',
        sizes: [{ size: '2L', price: 440, groupPrice: 400 }],
      },
      {
        _id: 'a1',
        name: 'Applicators (2-Pack)',
        sizes: [{ size: '2-Pack', price: 22, groupPrice: 20 }],
      },
      {
        _id: 'b1',
        name: 'Applicator Bottle',
        sizes: [{ size: '1pc', price: 11, groupPrice: 10 }],
      },
      {
        _id: 's1',
        name: 'SEAL',
        sizes: [{ size: '500ml', price: 55, groupPrice: 50 }],
      },
    ];
    const components = resolveCertificationKitComponents(catalog);
    expect(components).not.toBeNull();
    expect(components![0].unitPrice).toBe(440);
    const subtotal = components!.reduce(
      (sum, c) => sum + c.unitPrice * c.quantity,
      0,
    );
    // 440 + 22*10 + 11*4 + 55*2 = 440+220+44+110 = 814
    expect(subtotal).toBe(814);
    const discounted = applyCertificationKitDiscount(subtotal);
    expect(discounted.total).toBeCloseTo(814 * 0.93, 5);
  });
});
