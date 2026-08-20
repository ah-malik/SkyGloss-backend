import {
  clampInventoryQuantity,
  isInventoryItemKey,
  INVENTORY_MAX_QUANTITY,
} from './inventory.constants';

describe('inventory.constants', () => {
  it('recognizes inventory item keys', () => {
    expect(isInventoryItemKey('boxes')).toBe(true);
    expect(isInventoryItemKey('labels')).toBe(true);
    expect(isInventoryItemKey('unknown')).toBe(false);
  });

  it('clamps quantities to a non-negative integer range', () => {
    expect(clampInventoryQuantity(-4)).toBe(0);
    expect(clampInventoryQuantity(3.9)).toBe(3);
    expect(clampInventoryQuantity(INVENTORY_MAX_QUANTITY + 10)).toBe(
      INVENTORY_MAX_QUANTITY,
    );
    expect(clampInventoryQuantity(Number.NaN)).toBe(0);
  });
});
