import {
  buildMigratedShopOrderNumber,
  extractShopOrderSequence,
  formatShopOrderNumber,
  getNextShopOrderSequence,
  getNextShopOrderSequenceForFlow,
  resolveOrderCountryCode,
  SHOP_ORDER_PURCHASE_START,
  SHOP_ORDER_REQUEST_START,
} from './order-number';

describe('order-number', () => {
  it('resolves common country codes', () => {
    expect(resolveOrderCountryCode('United States')).toBe('USA');
    expect(resolveOrderCountryCode('Pakistan')).toBe('PAK');
    expect(resolveOrderCountryCode('England')).toBe('ENG');
  });

  it('extracts sequences from legacy formats', () => {
    expect(extractShopOrderSequence('REQ-254752')).toBe(254752);
    expect(extractShopOrderSequence('SG000043')).toBe(43);
    expect(extractShopOrderSequence('SGUSA-254752')).toBe(254752);
    expect(extractShopOrderSequence('ORD-1773557663563-190')).toBe(
      1773557663563,
    );
    expect(extractShopOrderSequence('REG000012')).toBeNull();
  });

  it('formats new shop order numbers with 7-digit sequence', () => {
    expect(formatShopOrderNumber('USA', 0)).toBe('SGUSA-0000000');
    expect(formatShopOrderNumber('USA', 7)).toBe('SGUSA-0000007');
    expect(formatShopOrderNumber('USA', 254752)).toBe('SGUSA-0254752');
    expect(formatShopOrderNumber('PAK', 1776784934722)).toBe(
      'SGPAK-1776784934722',
    );
  });

  it('computes next sequence from mixed legacy numbers', () => {
    expect(
      getNextShopOrderSequence(['REQ-254775', 'SG000043', 'SGUSA-254700']),
    ).toBe(254776);
  });

  it('starts order request numbers at 0', () => {
    expect(getNextShopOrderSequenceForFlow([], 'request')).toBe(
      SHOP_ORDER_REQUEST_START,
    );
    expect(
      getNextShopOrderSequenceForFlow(
        [{ orderNumber: 'SGUSA-0000000', orderFlow: 'request' }],
        'request',
      ),
    ).toBe(1);
  });

  it('starts purchase numbers at 7', () => {
    expect(getNextShopOrderSequenceForFlow([], 'purchase')).toBe(
      SHOP_ORDER_PURCHASE_START,
    );
    expect(
      getNextShopOrderSequenceForFlow(
        [{ orderNumber: 'SGUSA-0000007', orderFlow: 'purchase' }],
        'purchase',
      ),
    ).toBe(8);
  });

  it('keeps request and purchase counters separate', () => {
    const orders = [
      { orderNumber: 'SGUSA-0000002', orderFlow: 'request' as const },
      { orderNumber: 'SGUSA-0000007', orderFlow: 'purchase' as const },
    ];
    expect(getNextShopOrderSequenceForFlow(orders, 'request')).toBe(3);
    expect(getNextShopOrderSequenceForFlow(orders, 'purchase')).toBe(8);
  });

  it('migrates legacy order numbers with country', () => {
    expect(buildMigratedShopOrderNumber('REQ-254752', 'Pakistan')).toBe(
      'SGPAK-0254752',
    );
    expect(buildMigratedShopOrderNumber('SG000043', 'United States')).toBe(
      'SGUSA-0000043',
    );
  });
});
