import {
  canonicalEarningType,
  missingCommissionAmount,
  uniqueSplitEarningType,
} from './commission-split';

describe('commission split helpers', () => {
  it('strips legacy and unique partial suffixes', () => {
    expect(canonicalEarningType('Shop Introduction')).toBe('Shop Introduction');
    expect(canonicalEarningType('Shop Introduction (partial)')).toBe(
      'Shop Introduction',
    );
    expect(
      canonicalEarningType('Shop Introduction (partial:6a832a774c071cd299f3f175)'),
    ).toBe('Shop Introduction');
  });

  it('creates a unique earning type for each partial lock', () => {
    const a = uniqueSplitEarningType('Shop Introduction', 'aaaaaaaaaaaaaaaaaaaaaaaa');
    const b = uniqueSplitEarningType('Shop Introduction (partial)', 'bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(a).toBe('Shop Introduction (partial:aaaaaaaaaaaaaaaaaaaaaaaa)');
    expect(b).toBe('Shop Introduction (partial:bbbbbbbbbbbbbbbbbbbbbbbb)');
    expect(a).not.toBe(b);
  });

  it('restores amount lost when a partial insert failed after shrinking the parent', () => {
    expect(missingCommissionAmount(100, [70, 30])).toBe(0);
    expect(missingCommissionAmount(100, [50, 30])).toBe(20);
    expect(missingCommissionAmount(100, [100])).toBe(0);
  });
});
