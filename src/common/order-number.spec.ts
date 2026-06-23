import {
  buildMigratedShopOrderNumber,
  extractShopOrderSequence,
  formatShopOrderNumber,
  getNextShopOrderSequence,
  resolveOrderCountryCode,
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

  it('formats new shop order numbers', () => {
    expect(formatShopOrderNumber('USA', 254752)).toBe('SGUSA-254752');
    expect(formatShopOrderNumber('PAK', 1776784934722)).toBe(
      'SGPAK-1776784934722',
    );
  });

  it('computes next sequence from mixed legacy numbers', () => {
    expect(
      getNextShopOrderSequence(['REQ-254775', 'SG000043', 'SGUSA-254700']),
    ).toBe(254776);
  });

  it('migrates legacy order numbers with country', () => {
    expect(buildMigratedShopOrderNumber('REQ-254752', 'Pakistan')).toBe(
      'SGPAK-254752',
    );
    expect(buildMigratedShopOrderNumber('SG000043', 'United States')).toBe(
      'SGUSA-43',
    );
  });
});
