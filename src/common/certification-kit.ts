import { isUnpaidSelfRegisteredShop } from './unpaid-shop-pricing';
import { resolveFusionSizeCode } from './order-type';

/** Virtual catalog product id — not a Mongo ObjectId. */
export const CERTIFICATION_KIT_PRODUCT_ID = 'certification_kit_bundle';

export const CERTIFICATION_KIT_NAME = 'Certification Kit Bundle';

export const CERTIFICATION_KIT_SIZE = 'Kit';

/** Percent off component subtotal (e.g. €1070 → ~€995). */
export const CERTIFICATION_KIT_DISCOUNT_PERCENT = 7;

/** Activation / certification fee waived when purchasing the kit (USD messaging). */
export const CERTIFICATION_KIT_FEE_WAIVED_USD = 250;

export type CertificationKitComponentSpec = {
  key: 'fusion' | 'applicator_pack' | 'applicator_bottle' | 'seal';
  quantity: number;
  label: string;
};

/** Fixed recipe for the unpaid Certification Kit. */
export const CERTIFICATION_KIT_COMPONENTS: CertificationKitComponentSpec[] = [
  { key: 'fusion', quantity: 1, label: '1× Fusion 2000' },
  { key: 'applicator_pack', quantity: 10, label: '10× Applicators (2-Pack)' },
  { key: 'applicator_bottle', quantity: 4, label: '4× Applicator Bottles' },
  { key: 'seal', quantity: 2, label: '2× Seals' },
];

export function isCertificationKitProductId(id?: string | null): boolean {
  return String(id || '') === CERTIFICATION_KIT_PRODUCT_ID;
}

export function isCertificationKitProductName(name?: string | null): boolean {
  const upper = String(name || '').toUpperCase();
  return (
    upper.includes('CERTIFICATION KIT') ||
    upper === CERTIFICATION_KIT_NAME.toUpperCase()
  );
}

export function isCertificationKitCartItem(item: {
  product?: string;
  id?: string;
  name?: string;
}): boolean {
  return (
    isCertificationKitProductId(item.product) ||
    isCertificationKitProductId(item.id) ||
    isCertificationKitProductName(item.name)
  );
}

/** Eligible: unpaid self-registered shop (activation fee still owed). */
export function isCertificationKitEligibleUser(user: any): boolean {
  return isUnpaidSelfRegisteredShop(user);
}

export function findFusion2000Size(
  product: { sizes?: Array<{ size: string; price?: number; groupPrice?: number }> },
): { size: string; price: number; groupPrice?: number } | null {
  const sizes = Array.isArray(product?.sizes) ? product.sizes : [];
  for (const entry of sizes) {
    if (resolveFusionSizeCode(entry?.size) === '2000') {
      return {
        size: entry.size,
        price: Number(entry.price) || 0,
        groupPrice:
          entry.groupPrice != null ? Number(entry.groupPrice) : undefined,
      };
    }
  }
  return null;
}

export function isFusionKitCatalogProduct(name?: string | null): boolean {
  const upper = String(name || '').toUpperCase();
  if (!upper.includes('FUSION')) return false;
  if (upper.includes('EXTREME')) return false;
  return true;
}

export function isApplicatorPackCatalogProduct(name?: string | null): boolean {
  const upper = String(name || '').toUpperCase();
  if (upper.includes('BOTTLE')) return false;
  return (
    upper.includes('APPLICATORS') ||
    (upper.includes('APPLICATOR') && upper.includes('PACK'))
  );
}

export function isApplicatorBottleCatalogProduct(name?: string | null): boolean {
  return String(name || '')
    .toUpperCase()
    .includes('APPLICATOR BOTTLE');
}

export function isSealCatalogProduct(name?: string | null): boolean {
  const upper = String(name || '').toUpperCase();
  if (!upper.includes('SEAL')) return false;
  if (upper.includes('SEALER')) return false;
  return true;
}

/** Prefer pre-markup group price for unpaid viewers; else charge price. */
export function resolveComponentUnitPrice(sizeEntry: {
  price?: number;
  groupPrice?: number;
}): number {
  if (sizeEntry.groupPrice != null && Number.isFinite(Number(sizeEntry.groupPrice))) {
    return Number(sizeEntry.groupPrice);
  }
  return Number(sizeEntry.price) || 0;
}

export function roundMoney(amount: number): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

export function applyCertificationKitDiscount(subtotal: number): {
  subtotal: number;
  discount: number;
  total: number;
} {
  const sub = roundMoney(subtotal);
  const discount = roundMoney((sub * CERTIFICATION_KIT_DISCOUNT_PERCENT) / 100);
  return {
    subtotal: sub,
    discount,
    total: roundMoney(Math.max(0, sub - discount)),
  };
}

export type ResolvedKitComponent = {
  productId: string;
  name: string;
  size: string;
  quantity: number;
  unitPrice: number;
  image?: string;
  label: string;
};

type CatalogProduct = {
  _id?: string | { toString(): string };
  name?: string;
  sizes?: Array<{ size: string; price?: number; groupPrice?: number }>;
  shopImages?: string[];
  images?: string[];
};

/**
 * Resolve kit components from a shop-priced catalog.
 * Uses groupPrice (pre +10%) when present so the kit is not double-marked-up.
 */
export function resolveCertificationKitComponents(
  catalog: CatalogProduct[],
): ResolvedKitComponent[] | null {
  if (!Array.isArray(catalog) || catalog.length === 0) return null;

  const fusion = catalog.find((p) => isFusionKitCatalogProduct(p.name));
  const pack = catalog.find((p) => isApplicatorPackCatalogProduct(p.name));
  const bottle = catalog.find((p) => isApplicatorBottleCatalogProduct(p.name));
  const seal = catalog.find((p) => isSealCatalogProduct(p.name));

  if (!fusion || !pack || !bottle || !seal) return null;

  const fusionSize = findFusion2000Size(fusion);
  if (!fusionSize) return null;

  const packSize = pack.sizes?.[0];
  const bottleSize = bottle.sizes?.[0];
  const sealSize = seal.sizes?.[0];
  if (!packSize || !bottleSize || !sealSize) return null;

  const idOf = (p: CatalogProduct) =>
    typeof p._id === 'string' ? p._id : p._id?.toString?.() || '';

  const imageOf = (p: CatalogProduct) =>
    p.shopImages?.[0] || p.images?.[0] || '';

  const components: ResolvedKitComponent[] = [
    {
      productId: idOf(fusion),
      name: String(fusion.name || 'FUSION'),
      size: fusionSize.size,
      quantity: 1,
      unitPrice: resolveComponentUnitPrice(fusionSize),
      image: imageOf(fusion),
      label: '1× Fusion 2000',
    },
    {
      productId: idOf(pack),
      name: String(pack.name || 'Applicators (2-Pack)'),
      size: packSize.size,
      quantity: 10,
      unitPrice: resolveComponentUnitPrice(packSize),
      image: imageOf(pack),
      label: '10× Applicators (2-Pack)',
    },
    {
      productId: idOf(bottle),
      name: String(bottle.name || 'Applicator Bottle'),
      size: bottleSize.size,
      quantity: 4,
      unitPrice: resolveComponentUnitPrice(bottleSize),
      image: imageOf(bottle),
      label: '4× Applicator Bottles',
    },
    {
      productId: idOf(seal),
      name: String(seal.name || 'SEAL'),
      size: sealSize.size,
      quantity: 2,
      unitPrice: resolveComponentUnitPrice(sealSize),
      image: imageOf(seal),
      label: '2× Seals',
    },
  ];

  if (components.some((c) => !c.productId || c.unitPrice < 0)) return null;
  return components;
}

export function buildCertificationKitCatalogProduct(params: {
  components: ResolvedKitComponent[];
  currency?: string;
  alreadyPurchased?: boolean;
}): Record<string, unknown> {
  const { components, currency = 'USD', alreadyPurchased = false } = params;
  const rawSubtotal = components.reduce(
    (sum, c) => sum + c.unitPrice * c.quantity,
    0,
  );
  const { subtotal, discount, total } =
    applyCertificationKitDiscount(rawSubtotal);

  return {
    _id: CERTIFICATION_KIT_PRODUCT_ID,
    name: CERTIFICATION_KIT_NAME,
    description:
      'One-time Certification Kit for unpaid shops: Fusion 2000, applicators, bottles, and Seals. Includes free shipping, a waived $250 certification fee, and 7% off the kit total.',
    category: 'Bundle',
    stock: alreadyPurchased ? 0 : 1,
    images: components.map((c) => c.image).filter(Boolean).slice(0, 4),
    shopImages: components.map((c) => c.image).filter(Boolean).slice(0, 4),
    features: [
      ...CERTIFICATION_KIT_COMPONENTS.map((c) => c.label),
      'Free Shipping',
      `$${CERTIFICATION_KIT_FEE_WAIVED_USD} certification fee waived`,
      `${CERTIFICATION_KIT_DISCOUNT_PERCENT}% kit discount`,
    ],
    sizes: [{ size: CERTIFICATION_KIT_SIZE, price: total }],
    status: 'published',
    targetAudience: 'shop',
    displayOrder: -100,
    currency,
    isCertificationKitBundle: true,
    maxQuantity: 1,
    kitContents: components.map((c) => ({
      label: c.label,
      name: c.name,
      size: c.size,
      quantity: c.quantity,
      unitPrice: c.unitPrice,
    })),
    kitPricing: {
      componentsSubtotal: subtotal,
      discountPercent: CERTIFICATION_KIT_DISCOUNT_PERCENT,
      discountAmount: discount,
      total,
      feeWaivedUsd: CERTIFICATION_KIT_FEE_WAIVED_USD,
      freeShipping: true,
    },
    certificationKitPurchased: alreadyPurchased,
  };
}
