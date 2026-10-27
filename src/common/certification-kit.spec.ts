import {
  applyCertificationKitDiscount,
  buildCertificationKitCatalogProduct,
  CERTIFICATION_KIT_DISCOUNT_PERCENT,
  CERTIFICATION_KIT_ENABLED,
  isCertificationKitEligibleUser,
  isCertificationKitProductId,
  resolveCertificationKitComponents,
  resolveSavedCertificationKitComponents,
} from './certification-kit';

describe('certification-kit', () => {
  it('is only for shops that have not paid the certification fee', () => {
    // Kill-switch: kit is hidden from everyone while CERTIFICATION_KIT_ENABLED is false.
    expect(CERTIFICATION_KIT_ENABLED).toBe(false);
    expect(
      isCertificationKitEligibleUser({
        role: 'certified_shop',
        isSelfRegistered: true,
        isPartnerPaid: false,
      }),
    ).toBe(false);
    expect(
      isCertificationKitEligibleUser({
        role: 'certified_shop',
        isSelfRegistered: true,
        isPartnerPaid: true,
      }),
    ).toBe(false);
    expect(
      isCertificationKitEligibleUser({
        role: 'certified_shop',
        isSelfRegistered: false,
        isPartnerPaid: false,
      }),
    ).toBe(false);
    expect(
      isCertificationKitEligibleUser({
        role: 'certified_shop',
        isSelfRegistered: false,
        isPartnerPaid: true,
      }),
    ).toBe(false);
    expect(
      isCertificationKitEligibleUser({
        role: 'partner',
        isSelfRegistered: true,
        isPartnerPaid: false,
      }),
    ).toBe(false);
  });

  it('prices a saved kit: discounted products + fee + training', () => {
    const catalog = [
      { _id: 'f1', name: 'FUSION', sizes: [{ size: '2000ml', price: 790 }] },
      { _id: 'a1', name: 'Applicators (2-Pack)', sizes: [{ size: '2-Pack', price: 12 }] },
      { _id: 'b1', name: 'Applicator Bottle', sizes: [{ size: '1pc', price: 15 }] },
      { _id: 's1', name: 'SEAL', sizes: [{ size: '500ml', price: 50 }] },
    ];
    const items = [
      { productId: 'f1', size: '2000ml', quantity: 1 },
      { productId: 'a1', size: '2-Pack', quantity: 10 },
      { productId: 'b1', size: '1pc', quantity: 4 },
      { productId: 's1', size: '500ml', quantity: 2 },
    ];
    const components = resolveSavedCertificationKitComponents(catalog, items);
    expect(components).toHaveLength(4);
    const kit = buildCertificationKitCatalogProduct({
      components: components!,
      currency: 'USD',
      config: {
        items,
        discountPercent: 30.4,
        freeShipping: true,
        trainingIncluded: false,
        trainingPrice: 0,
        certificationFee: 250,
      },
    }) as any;
    // 1070 products, −325.28 → 744.72, + 250 fee
    expect(kit.kitPricing.componentsSubtotal).toBe(1070);
    expect(kit.kitPricing.discountAmount).toBeCloseTo(325.28, 2);
    expect(kit.kitPricing.compareAtTotal).toBe(1320);
    expect(kit.sizes[0].price).toBeCloseTo(994.72, 2);
    expect(kit.kitPricing.freeShipping).toBe(true);

    const withTraining = buildCertificationKitCatalogProduct({
      components: components!,
      config: {
        items,
        discountPercent: 0,
        freeShipping: false,
        trainingIncluded: true,
        trainingPrice: 100,
        certificationFee: 250,
      },
    }) as any;
    expect(withTraining.sizes[0].price).toBe(1420);
    expect(withTraining.kitPricing.discountAmount).toBe(0);
  });

  it('leaves out kit products missing from the viewer Pricing Group', () => {
    const catalog = [
      { _id: 'f1', name: 'FUSION', sizes: [{ size: '2000ml', price: 790 }] },
      { _id: 's1', name: 'SEAL', sizes: [{ size: '500ml', price: 50 }] },
    ];
    const components = resolveSavedCertificationKitComponents(catalog, [
      { productId: 'f1', size: '2000ml', quantity: 1 },
      { productId: 'x9', size: '1pc', quantity: 4 },
      { productId: 's1', size: '250ml', quantity: 2 },
      { productId: 's1', size: '500ml', quantity: 2 },
    ]);
    expect(components!.map((c) => `${c.productId}:${c.size}:${c.quantity}`)).toEqual([
      'f1:2000ml:1',
      's1:500ml:2',
    ]);
  });

  it('hides the kit only when none of its products are in the catalog', () => {
    expect(
      resolveSavedCertificationKitComponents(
        [{ _id: 'f1', name: 'FUSION', sizes: [{ size: '2000ml', price: 790 }] }],
        [{ productId: 'x9', size: '2000ml', quantity: 1 }],
      ),
    ).toBeNull();
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
