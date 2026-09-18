import { normalizeOrderItemType, type OrderItemType } from './order-type';

const SERVICE_PRODUCT_NAMES = new Set([
  'Advanced Technical Training',
  'Advanced Sales Training',
  'Lead Generation Marketing Program',
]);

/** Training / marketing lines are sold as single units (no case pack). */
export function isCaseEligibleProduct(productName?: string | null): boolean {
  const name = String(productName || '').trim();
  if (!name) return true;
  if (SERVICE_PRODUCT_NAMES.has(name)) return false;
  const lower = name.toLowerCase();
  return !(lower.includes('training') || lower.includes('marketing'));
}

/**
 * Physical catalog products ship in cases of 10 (same rule as Partner catalog).
 * Services stay at 1 so Case is not offered as a separate price.
 */
export function getUnitsPerCaseForProduct(productName?: string | null): number {
  return isCaseEligibleProduct(productName) ? 10 : 1;
}

/** Resolve charge price for a line from the Pricing Group unit price. */
export function resolveOrderLinePrice(
  unitPrice: number,
  orderType?: string | null,
  productName?: string | null,
): number {
  const base = Number(unitPrice) || 0;
  const type: OrderItemType = normalizeOrderItemType(orderType);
  if (type !== 'case') return base;
  return base * getUnitsPerCaseForProduct(productName);
}
