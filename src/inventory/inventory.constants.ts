export const INVENTORY_ITEM_KEYS = [
  'bottlesAndPackaging',
  'boxes',
  'labels',
  'components',
] as const;

export type InventoryItemKey = (typeof INVENTORY_ITEM_KEYS)[number];

export const INVENTORY_MAX_QUANTITY = 1_000_000;

export function isInventoryItemKey(value: string): value is InventoryItemKey {
  return (INVENTORY_ITEM_KEYS as readonly string[]).includes(value);
}

export function clampInventoryQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(INVENTORY_MAX_QUANTITY, Math.max(0, Math.trunc(value)));
}
