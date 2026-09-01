type ShopCommissionRecalculationHandler = (
  shopUserId: string,
) => Promise<{ processed: number; updated: number }>;

let handler: ShopCommissionRecalculationHandler | null = null;

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
