import { UserRole } from '../users/entities/user.entity';

/** Self-registered shops that have not completed activation payment. */
export function isUnpaidSelfRegisteredShop(user: any): boolean {
  if (!user) return false;
  const role = user.role;
  const isShop = role === UserRole.CERTIFIED_SHOP || role === 'certified_shop';
  return isShop && !user.isPartnerPaid && !!user.isSelfRegistered;
}

/** Unpaid shops pay Pricing Group price + 10%. */
export const UNPAID_SHOP_PRICE_MARKUP = 1.1;

export function applyUnpaidShopPriceMarkup(price: number): number {
  const base = Number(price) || 0;
  return Math.round(base * UNPAID_SHOP_PRICE_MARKUP * 100) / 100;
}

/**
 * Returns the price the shop should be charged.
 * Paid shops: pricing-group (or catalog) price as-is.
 * Unpaid shops: pricing-group price + 10%.
 */
export function resolveChargePriceForShop(
  groupOrCatalogPrice: number,
  user: any,
): number {
  const base = Number(groupOrCatalogPrice) || 0;
  if (isUnpaidSelfRegisteredShop(user)) {
    return applyUnpaidShopPriceMarkup(base);
  }
  return base;
}
