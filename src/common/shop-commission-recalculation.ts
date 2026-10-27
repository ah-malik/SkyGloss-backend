export type ShopCommissionRecalculationHandler = (
  shopUserId: string,
) => Promise<{ processed: number; updated: number }>;

export type PartnerAssignmentEarningType =
  | 'Operational Support'
  | 'Shop Introduction';

export type SelectiveShopCommissionLinkParams = {
  shopUserId: string;
  earningType: PartnerAssignmentEarningType;
  orderIds: string[];
};

export type SelectiveShopCommissionLinkHandler = (
  params: SelectiveShopCommissionLinkParams,
) => Promise<{ linked: number; skipped: number }>;

let handler: ShopCommissionRecalculationHandler | null = null;
let selectiveLinkHandler: SelectiveShopCommissionLinkHandler | null = null;

export function registerShopCommissionRecalculationHandler(
  fn: ShopCommissionRecalculationHandler,
): void {
  handler = fn;
}

export function queueShopCommissionRecalculation(shopUserId: string): void {
  if (!handler) return;
  void handler(shopUserId).catch((err) => {
    console.error(
      `[ShopCommissionRecalculation] Failed for shop ${shopUserId}:`,
      err instanceof Error ? err.message : String(err),
    );
  });
}

export function registerSelectiveShopCommissionLinkHandler(
  fn: SelectiveShopCommissionLinkHandler,
): void {
  selectiveLinkHandler = fn;
}

/**
 * Link only the given order IDs to the newly assigned partner earning type.
 * Uses the same commission rules as applyOrderCommissions / syncFromShippedOrder.
 */
export function queueSelectiveShopCommissionLink(
  params: SelectiveShopCommissionLinkParams,
): void {
  if (!selectiveLinkHandler) return;
  if (!params.orderIds?.length) return;
  void selectiveLinkHandler(params).catch((err) => {
    console.error(
      `[SelectiveShopCommissionLink] Failed for shop ${params.shopUserId} (${params.earningType}):`,
      err instanceof Error ? err.message : String(err),
    );
  });
}
