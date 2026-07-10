export type OrderItemType = 'unit' | 'case';

export function formatOrderItemTypeLabel(
  orderType?: string | null,
): string {
  if ((orderType || '').toLowerCase() === 'case') {
    return 'Case';
  }
  return 'Unit';
}

export function normalizeOrderItemType(
  orderType?: string | null,
): OrderItemType {
  return (orderType || '').toLowerCase() === 'case' ? 'case' : 'unit';
}
