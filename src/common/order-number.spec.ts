import {
  buildMigratedShopOrderNumber,
  extractCurrentRegistrationOrderSequence,
  extractCurrentShopOrderSequence,
  extractShopOrderSequence,
  formatRegistrationOrderNumber,
  formatShopOrderNumber,
  getNextRegistrationOrderSequence,
  getNextShopOrderSequence,
  getNextShopOrderSequenceForFlow,
  getShopOrderPrefix,
  isOrderRequest,
  ORDER_SEQUENCE_START,
  ORDER_SEQUENCE_STEP,
  rebuildShopOrderNumberCountry,
  resolveOrderCountryCode,
  SHOP_ORDER_PURCHASE_START,
  SHOP_ORDER_REQUEST_START,
} from './order-number';

describe('order-number', () => {
  it('resolves common country codes', () => {
    expect(resolveOrderCountryCode('United States')).toBe('USA');
    expect(resolveOrderCountryCode('Pakistan')).toBe('PAK');
    expect(resolveOrderCountryCode('England')).toBe('ENG');
    expect(resolveOrderCountryCode('Netherlands')).toBe('NED');
    expect(resolveOrderCountryCode('France')).toBe('FRA');
  });

  it('builds country-based shop prefixes', () => {
    expect(getShopOrderPrefix('request', 'Netherlands')).toBe('SGNED');
    expect(getShopOrderPrefix('request', 'Pakistan')).toBe('SGPAK');
    expect(getShopOrderPrefix('request', 'England')).toBe('SGENG');
    expect(getShopOrderPrefix('request', 'France')).toBe('SGFRA');
    expect(getShopOrderPrefix('purchase', 'United States')).toBe('SGUSAP');
  });

  it('extracts sequences from legacy formats', () => {
    expect(extractShopOrderSequence('REQ-254752')).toBe(254752);
    expect(extractShopOrderSequence('SG000043')).toBe(43);
    expect(extractShopOrderSequence('SGUSA-254752')).toBe(254752);
    expect(extractShopOrderSequence('ORD-1773557663563-190')).toBe(
      1773557663563,
    );
    expect(extractShopOrderSequence('REG000012')).toBeNull();
    expect(extractShopOrderSequence('SGREG0110')).toBeNull();
  });

  it('formats shop and registration IDs with country + 4-digit sequence', () => {
    expect(
      formatShopOrderNumber('request', ORDER_SEQUENCE_START, 'Pakistan'),
    ).toBe('SGPAK0110');
    expect(
      formatShopOrderNumber('request', ORDER_SEQUENCE_START, 'Netherlands'),
    ).toBe('SGNED0110');
    expect(
      formatShopOrderNumber('purchase', ORDER_SEQUENCE_START, 'United States'),
    ).toBe('SGUSAP0110');
    expect(formatRegistrationOrderNumber(ORDER_SEQUENCE_START)).toBe(
      'SGREG0110',
    );
    expect(
      formatShopOrderNumber(
        'request',
        ORDER_SEQUENCE_START + ORDER_SEQUENCE_STEP,
        'England',
      ),
    ).toBe('SGENG0117');
  });

  it('extracts sequences from the current country+flow formats', () => {
    expect(extractCurrentShopOrderSequence('SGPAK0110', 'request')).toBe(110);
    expect(extractCurrentShopOrderSequence('SGNED0117', 'request')).toBe(117);
    expect(extractCurrentShopOrderSequence('SGPAKR0110', 'request')).toBe(110);
    expect(extractCurrentShopOrderSequence('SGUSAP0117', 'purchase')).toBe(117);
    expect(extractCurrentShopOrderSequence('SGUSA-0000007', 'purchase')).toBeNull();
    expect(extractCurrentRegistrationOrderSequence('SGREG0110')).toBe(110);
    expect(extractCurrentRegistrationOrderSequence('REG000110')).toBeNull();
  });

  it('computes next sequence from mixed legacy numbers', () => {
    expect(
      getNextShopOrderSequence(['REQ-254775', 'SG000043', 'SGUSA-254700']),
    ).toBe(254776);
  });

  it('starts order request numbers at 0110 and increments by 7 across countries', () => {
    expect(getNextShopOrderSequenceForFlow([], 'request')).toBe(
      SHOP_ORDER_REQUEST_START,
    );
    expect(
      getNextShopOrderSequenceForFlow(
        [{ orderNumber: 'SGPAK0110', orderFlow: 'request' }],
        'request',
      ),
    ).toBe(117);
    expect(
      getNextShopOrderSequenceForFlow(
        [
          { orderNumber: 'SGPAK0110', orderFlow: 'request' },
          { orderNumber: 'SGNED0117', orderFlow: 'request' },
        ],
        'request',
      ),
    ).toBe(124);
  });

  it('starts purchase numbers at 0110 and increments by 7', () => {
    expect(getNextShopOrderSequenceForFlow([], 'purchase')).toBe(
      SHOP_ORDER_PURCHASE_START,
    );
    expect(
      getNextShopOrderSequenceForFlow(
        [{ orderNumber: 'SGUSAP0110', orderFlow: 'purchase' }],
        'purchase',
      ),
    ).toBe(117);
  });

  it('keeps request and purchase counters separate', () => {
    const orders = [
      { orderNumber: 'SGPAK0110', orderFlow: 'request' as const },
      { orderNumber: 'SGUSAP0110', orderFlow: 'purchase' as const },
    ];
    expect(getNextShopOrderSequenceForFlow(orders, 'request')).toBe(117);
    expect(getNextShopOrderSequenceForFlow(orders, 'purchase')).toBe(117);
  });

  it('ignores legacy shop IDs when computing the reset series', () => {
    const orders = [
      { orderNumber: 'SGPAK-0000999', orderFlow: 'request' as const },
      { orderNumber: 'SGUSA-0000500', orderFlow: 'purchase' as const },
    ];
    expect(getNextShopOrderSequenceForFlow(orders, 'request')).toBe(110);
    expect(getNextShopOrderSequenceForFlow(orders, 'purchase')).toBe(110);
  });

  it('starts registration numbers at 0110 and increments by 7', () => {
    expect(getNextRegistrationOrderSequence([])).toBe(110);
    expect(getNextRegistrationOrderSequence(['SGREG0110'])).toBe(117);
    expect(getNextRegistrationOrderSequence(['REG000999', 'SGREG0117'])).toBe(
      124,
    );
  });

  it('migrates legacy order numbers onto the country+flow series', () => {
    expect(buildMigratedShopOrderNumber('REQ-254752', 'Pakistan')).toBe(
      'SGPAK254752',
    );
    expect(buildMigratedShopOrderNumber('REQ-254752', 'Netherlands')).toBe(
      'SGNED254752',
    );
    expect(
      buildMigratedShopOrderNumber('SG000043', 'United States', 'purchase'),
    ).toBe('SGUSAP0043');
  });

  it('rebuilds country codes on existing shop IDs without changing sequence', () => {
    expect(
      rebuildShopOrderNumberCountry('SGPAK0201', 'Netherlands', 'request'),
    ).toBe('SGNED0201');
    expect(
      rebuildShopOrderNumberCountry('SGPAK0201', 'Pakistan', 'request'),
    ).toBeNull();
    expect(
      rebuildShopOrderNumberCountry('SGUSAP0110', 'England', 'purchase'),
    ).toBe('SGENGP0110');
  });

  it('detects order requests by flow and current request IDs', () => {
    expect(isOrderRequest({ orderFlow: 'request' })).toBe(true);
    expect(isOrderRequest({ orderFlow: 'purchase' })).toBe(false);
    expect(isOrderRequest({ orderNumber: 'SGNED0110' })).toBe(true);
    expect(isOrderRequest({ orderNumber: 'SGNEDR0110' })).toBe(true);
    expect(isOrderRequest({ orderNumber: 'SGUSAP0110' })).toBe(false);
  });
});
