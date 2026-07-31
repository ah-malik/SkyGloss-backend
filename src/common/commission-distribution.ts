import { UserRole } from '../users/entities/user.entity';
import {
  SYSTEM_BASE_CURRENCY,
  roundExchangeRate,
  roundMoney,
} from './order-monetary';

/** Allowed earning_type values — no custom types permitted. */
export const EARNING_TYPES = [
  'Shop Introduction',
  'Partner Development',
  'Operational Support',
] as const;

export type EarningType = (typeof EARNING_TYPES)[number];

export const SHOP_INTRODUCTION_FIRST_ORDER_RATE = 0.05;
export const PARTNER_DEVELOPMENT_FIRST_ORDER_RATE = 0.1;
export const SHOP_INTRODUCTION_SUBSEQUENT_RATE = 0.1;
export const TOTAL_FIRST_ORDER_COMMISSION_RATE = 0.15;

/** Default Shop Introduction % when FO network split does not apply. */
export const DEFAULT_COMMISSION_RATES_PERCENT = {
  master_partner: 20,
  regional_partner: 10,
  // sub_promoter: 0, // removed — Sub-Promoter role migrated to Promoter
} as const;

/** Representatives and Promoters earn Shop Introduction under the earning-type model. */
export function isCommissionEligibleRole(role?: string): boolean {
  if (!role) return false;
  return (
    role === UserRole.MASTER_PARTNER ||
    role === 'master_partner' ||
    role === UserRole.REGIONAL_PARTNER ||
    role === 'regional_partner'
  );
}

export function getDefaultCommissionRatePercent(role?: string): number {
  if (role === UserRole.MASTER_PARTNER || role === 'master_partner') {
    return DEFAULT_COMMISSION_RATES_PERCENT.master_partner;
  }
  if (role === UserRole.REGIONAL_PARTNER || role === 'regional_partner') {
    return DEFAULT_COMMISSION_RATES_PERCENT.regional_partner;
  }
  return 0;
}

/** Resolve Rep commission % (admin custom override, else role default 20%). */
export function resolveCommissionRatePercent(
  role: string,
  customCommissionRate?: number | null,
): number {
  if (
    customCommissionRate != null &&
    customCommissionRate !== ('' as unknown) &&
    !Number.isNaN(Number(customCommissionRate))
  ) {
    const n = Number(customCommissionRate);
    if (n >= 0 && n <= 100) return Math.round(n * 100) / 100;
  }
  return getDefaultCommissionRatePercent(role);
}

export function resolveCommissionRateDecimal(
  role: string,
  customCommissionRate?: number | null,
): number {
  return resolveCommissionRatePercent(role, customCommissionRate) / 100;
}

export interface CommissionRecipient {
  _id: string;
  partnerCode: string;
  role: string;
}

export interface CommissionChain {
  promoter: CommissionRecipient | null;
  subPromoter: CommissionRecipient | null;
  represented: CommissionRecipient | null;
  isDirectHub: boolean;
}

export interface CommissionEntry {
  recipientUserId: string;
  recipientPartnerCode: string;
  recipientRole: string;
  earningType: EarningType;
  percentage: number;
  /** Commission credited in USD (base currency). */
  amount: number;
  shopId?: string;
  orderAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  convertedUsdAmount?: number;
}

export interface ShopEarningAssignments {
  shopIntroductionRepresentativeId?: string;
  shopIntroductionRepresentativeCode?: string;
  partnerDevelopmentRepresentativeId?: string;
  partnerDevelopmentRepresentativeCode?: string;
  operationalSupportRepresentativeId?: string;
  operationalSupportRepresentativeCode?: string;
  partnerDevelopmentCommissionPaid?: boolean;
  /** Only shops created after Add-to-Network get FO Partner Development. */
  partnerDevelopmentEligible?: boolean;
  /** Frozen PD % for this shop (absolute Parent FO on first order). */
  partnerDevelopmentRatePercent?: number;
  /** Frozen Child FO % (first-order SI + subsequent SI for FO shops). */
  shopIntroductionFirstOrderRatePercent?: number;
}

/** Role-specific Admin First Order defaults (absolute %). */
export const DEFAULT_FIRST_ORDER_RATES_BY_ROLE = {
  master_partner: {
    shopIntroductionRate: 20,
    partnerDevelopmentRate: 10,
  },
  regional_partner: {
    shopIntroductionRate: 10,
    partnerDevelopmentRate: 5,
  },
} as const;

/**
 * Default FO Child Shop Introduction % (absolute).
 * Representative default — prefer getDefaultFirstOrderCommissionRates(role).
 */
export const DEFAULT_FIRST_ORDER_SHOP_INTRODUCTION_PERCENT =
  DEFAULT_FIRST_ORDER_RATES_BY_ROLE.master_partner.shopIntroductionRate;
/**
 * Default FO Parent Partner Development % (absolute).
 * Representative default — prefer getDefaultFirstOrderCommissionRates(role).
 */
export const DEFAULT_FIRST_ORDER_PARTNER_DEVELOPMENT_PERCENT =
  DEFAULT_FIRST_ORDER_RATES_BY_ROLE.master_partner.partnerDevelopmentRate;

/** Resolve Admin FO defaults by network role (Rep vs Promoter). */
export function getDefaultFirstOrderCommissionRates(role?: string): {
  shopIntroductionRate: number;
  partnerDevelopmentRate: number;
} {
  if (role === UserRole.REGIONAL_PARTNER || role === 'regional_partner') {
    return { ...DEFAULT_FIRST_ORDER_RATES_BY_ROLE.regional_partner };
  }
  // Representative (and unknown role fallback used by Rep FO paths).
  return { ...DEFAULT_FIRST_ORDER_RATES_BY_ROLE.master_partner };
}

/** Clamp a commission % to 0–100. */
export function clampCommissionPercent(
  value?: number | null,
  fallback = 0,
): number {
  if (value == null || Number.isNaN(Number(value))) return fallback;
  const n = Number(value);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
}

/** Clamp admin FO Partner Development % (role default when unset). */
export function normalizePartnerDevelopmentRatePercent(
  value?: number | null,
  role?: string,
): number {
  return clampCommissionPercent(
    value,
    getDefaultFirstOrderCommissionRates(role).partnerDevelopmentRate,
  );
}

/** Clamp admin FO Shop Introduction % for linked child (role default when unset). */
export function normalizeShopIntroductionFirstOrderRatePercent(
  value?: number | null,
  role?: string,
): number {
  return clampCommissionPercent(
    value,
    getDefaultFirstOrderCommissionRates(role).shopIntroductionRate,
  );
}

/**
 * Normalize both FO rates (absolute percentages).
 *
 * Semantics: Child FO % is Shop Introduction paid to the child.
 * Parent FO % is Partner Development paid to the parent on first order only.
 * Both are independent (not a pool split). Subsequent orders pay Child FO % only.
 *
 * Defaults: Representative child 20% / parent 10%; Promoter child 10% / parent 5%.
 */
export function normalizeFirstOrderCommissionRates(params?: {
  shopIntroductionRate?: number | null;
  partnerDevelopmentRate?: number | null;
  role?: string | null;
}): {
  shopIntroductionRate: number;
  partnerDevelopmentRate: number;
} {
  const role = params?.role ?? undefined;
  const shopIntroductionRate = normalizeShopIntroductionFirstOrderRatePercent(
    params?.shopIntroductionRate,
    role,
  );
  const partnerDevelopmentRate = normalizePartnerDevelopmentRatePercent(
    params?.partnerDevelopmentRate,
    role,
  );

  const hasExplicitInput =
    params != null &&
    (params.shopIntroductionRate != null ||
      params.partnerDevelopmentRate != null);

  if (
    hasExplicitInput &&
    partnerDevelopmentRate > shopIntroductionRate
  ) {
    throw new Error(
      'Parent First Order Commission cannot exceed Child First Order Commission.',
    );
  }

  return {
    shopIntroductionRate,
    partnerDevelopmentRate,
  };
}

/**
 * Resolve absolute FO rates for a first-order split.
 * Example: child 20%, parent 10% → child SI 20%, parent PD 10% (total 30%).
 */
export function resolveFirstOrderPoolSplit(params?: {
  shopIntroductionRate?: number | null;
  partnerDevelopmentRate?: number | null;
}): {
  /** Child FO % (first-order SI + subsequent-order SI). */
  childPoolPercent: number;
  /** Parent FO % on first order only. */
  parentPercent: number;
  /** Child SI on first order (absolute — same as child pool). */
  childKeepPercent: number;
} {
  const childPoolPercent = normalizeShopIntroductionFirstOrderRatePercent(
    params?.shopIntroductionRate,
  );
  const parentPercent = normalizePartnerDevelopmentRatePercent(
    params?.partnerDevelopmentRate,
  );
  return {
    childPoolPercent,
    parentPercent,
    childKeepPercent: childPoolPercent,
  };
}

export interface CommissionOrderAmounts {
  orderAmount: number;
  orderCurrency: string;
  exchangeRateToUsd: number;
  convertedUsdAmount: number;
}

/** Order total in original currency + locked FX rate for USD credit. */
export function resolveCommissionOrderAmounts(order: {
  totalAmount?: number;
  originalAmount?: number;
  originalCurrency?: string;
  currency?: string;
  exchangeRateAtOrderTime?: number;
  baseCurrencyAmount?: number;
}): CommissionOrderAmounts {
  const orderCurrency = (
    order.originalCurrency ||
    order.currency ||
    SYSTEM_BASE_CURRENCY
  ).toUpperCase();
  const orderAmount = roundMoney(order.originalAmount ?? order.totalAmount ?? 0);

  if (orderCurrency === SYSTEM_BASE_CURRENCY) {
    return {
      orderAmount,
      orderCurrency,
      exchangeRateToUsd: 1,
      convertedUsdAmount: orderAmount,
    };
  }

  if (
    order.exchangeRateAtOrderTime != null &&
    order.exchangeRateAtOrderTime > 0
  ) {
    const exchangeRateToUsd = roundExchangeRate(order.exchangeRateAtOrderTime);
    return {
      orderAmount,
      orderCurrency,
      exchangeRateToUsd,
      convertedUsdAmount: roundMoney(orderAmount * exchangeRateToUsd),
    };
  }

  if (
    typeof order.baseCurrencyAmount === 'number' &&
    orderAmount > 0 &&
    order.baseCurrencyAmount > 0
  ) {
    const exchangeRateToUsd = roundExchangeRate(
      order.baseCurrencyAmount / orderAmount,
    );
    return {
      orderAmount,
      orderCurrency,
      exchangeRateToUsd,
      convertedUsdAmount: roundMoney(order.baseCurrencyAmount),
    };
  }

  return {
    orderAmount,
    orderCurrency,
    exchangeRateToUsd: 1,
    convertedUsdAmount: orderAmount,
  };
}

type NetworkUserLookup = (partnerCode: string) => Promise<{
  _id: { toString(): string };
  partnerCode?: string;
  role: string;
  referredByPartnerCode?: string;
  partnerDevelopmentRepresentativeCode?: string;
} | null>;

type OperationalSupportLookup = (
  shopIntroductionRepresentativeCode: string,
) => Promise<{
  _id: { toString(): string };
  partnerCode?: string;
  role: string;
} | null>;

function toNetworkUser(user: {
  _id: { toString(): string };
  partnerCode?: string;
  role: string;
}) {
  if (!user.partnerCode) return null;
  return {
    _id: user._id.toString(),
    partnerCode: user.partnerCode,
    role: user.role,
  };
}

function isMainPromoterRole(role?: string): boolean {
  return role === UserRole.REGIONAL_PARTNER || role === 'regional_partner';
}

/** @deprecated Sub-Promoter role removed — kept for legacy unmigrated shop parents. */
function isSubPromoterRole(role?: string): boolean {
  return role === UserRole.SUB_PROMOTER || role === 'sub_promoter';
}

function isRepresentativeRole(role?: string): boolean {
  return role === UserRole.MASTER_PARTNER || role === 'master_partner';
}

async function resolveRepresentativeForPromoter(
  promoter: { referredByPartnerCode?: string },
  lookup: NetworkUserLookup,
) {
  if (!promoter.referredByPartnerCode) return null;
  const repParent = await lookup(promoter.referredByPartnerCode.trim());
  if (repParent && isRepresentativeRole(repParent.role)) {
    return toNetworkUser(repParent);
  }
  return null;
}

/** Walk shop → parent chain to find the Shop Introduction Representative. */
export async function resolveShopCommissionChain(
  shop: { referredByPartnerCode?: string },
  lookup: NetworkUserLookup,
): Promise<CommissionChain> {
  const empty: CommissionChain = {
    promoter: null,
    subPromoter: null,
    represented: null,
    isDirectHub: true,
  };

  const directCode = shop.referredByPartnerCode?.trim();
  if (!directCode) return empty;

  const directParent = await lookup(directCode);
  if (!directParent?.partnerCode) return empty;

  if (directParent.role === UserRole.PARTNER || directParent.role === 'partner') {
    return empty;
  }

  if (isSubPromoterRole(directParent.role)) {
    const subPromoter = toNetworkUser(directParent);
    if (!subPromoter) return empty;

    const mainCode = directParent.referredByPartnerCode?.trim();
    const mainParent = mainCode ? await lookup(mainCode) : null;
    const promoter =
      mainParent && isMainPromoterRole(mainParent.role)
        ? toNetworkUser(mainParent)
        : null;
    const represented = promoter
      ? await resolveRepresentativeForPromoter(mainParent!, lookup)
      : null;

    return {
      promoter,
      subPromoter,
      represented,
      isDirectHub: false,
    };
  }

  if (isMainPromoterRole(directParent.role)) {
    const promoter = toNetworkUser(directParent);
    if (!promoter) return empty;

    const represented = await resolveRepresentativeForPromoter(directParent, lookup);

    return {
      promoter,
      subPromoter: null,
      represented,
      isDirectHub: false,
    };
  }

  if (isRepresentativeRole(directParent.role)) {
    return {
      promoter: null,
      subPromoter: null,
      represented: toNetworkUser(directParent),
      isDirectHub: false,
    };
  }

  return empty;
}

/** Resolve the Representative who invited/added the shop introduction rep. */
export async function resolvePartnerDevelopmentRepresentative(
  shopIntroductionRep: {
    partnerDevelopmentRepresentativeCode?: string;
    referredByPartnerCode?: string;
  },
  lookup: NetworkUserLookup,
): Promise<CommissionRecipient | null> {
  const explicitCode = shopIntroductionRep.partnerDevelopmentRepresentativeCode?.trim();
  if (explicitCode) {
    const explicit = await lookup(explicitCode);
    if (explicit?.partnerCode && isRepresentativeRole(explicit.role)) {
      return toNetworkUser(explicit);
    }
  }

  const parentCode = shopIntroductionRep.referredByPartnerCode?.trim();
  if (!parentCode) return null;

  const parent = await lookup(parentCode);
  if (parent?.partnerCode && isRepresentativeRole(parent.role)) {
    return toNetworkUser(parent);
  }

  return null;
}

/** Assign immutable earning representatives for a shop (one-time per earning type). */
export async function resolveShopEarningAssignments(
  shop: {
    _id: { toString(): string };
    referredByPartnerCode?: string;
    shopIntroductionRepresentativeCode?: string;
    partnerDevelopmentRepresentativeCode?: string;
    operationalSupportRepresentativeCode?: string;
    partnerDevelopmentCommissionPaid?: boolean;
  },
  lookup: NetworkUserLookup,
  findOperationalSupportRep?: OperationalSupportLookup,
): Promise<ShopEarningAssignments> {
  const result: ShopEarningAssignments = {
    shopIntroductionRepresentativeId: undefined,
    shopIntroductionRepresentativeCode:
      shop.shopIntroductionRepresentativeCode,
    partnerDevelopmentRepresentativeId: undefined,
    partnerDevelopmentRepresentativeCode:
      shop.partnerDevelopmentRepresentativeCode,
    operationalSupportRepresentativeId: undefined,
    operationalSupportRepresentativeCode:
      shop.operationalSupportRepresentativeCode,
    partnerDevelopmentCommissionPaid: shop.partnerDevelopmentCommissionPaid ?? false,
  };

  if (!result.shopIntroductionRepresentativeCode) {
    const chain = await resolveShopCommissionChain(shop, lookup);
    // Shop certified by a Promoter → Promoter earns Shop Introduction.
    // Do NOT skip to the upstream Representative (that left Promoters at 0%).
    if (chain.promoter) {
      result.shopIntroductionRepresentativeId = chain.promoter._id;
      result.shopIntroductionRepresentativeCode = chain.promoter.partnerCode;
    } else if (chain.represented) {
      result.shopIntroductionRepresentativeId = chain.represented._id;
      result.shopIntroductionRepresentativeCode = chain.represented.partnerCode;
    }
  }

  const shopIntroCode = result.shopIntroductionRepresentativeCode;
  if (!shopIntroCode) {
    return result;
  }

  if (!result.partnerDevelopmentRepresentativeCode) {
    const shopIntroRepUser = await lookup(shopIntroCode);
    // Rep → Promoter → Shop: upstream Rep is Operational Support, not FO Partner Development.
    if (shopIntroRepUser && isMainPromoterRole(shopIntroRepUser.role)) {
      const upstreamRep = await resolveRepresentativeForPromoter(
        shopIntroRepUser,
        lookup,
      );
      if (upstreamRep && !result.operationalSupportRepresentativeCode) {
        result.operationalSupportRepresentativeId = upstreamRep._id;
        result.operationalSupportRepresentativeCode = upstreamRep.partnerCode;
      }
    } else if (shopIntroRepUser) {
      const partnerDevelopmentRep = await resolvePartnerDevelopmentRepresentative(
        shopIntroRepUser,
        lookup,
      );
      if (partnerDevelopmentRep) {
        result.partnerDevelopmentRepresentativeId = partnerDevelopmentRep._id;
        result.partnerDevelopmentRepresentativeCode =
          partnerDevelopmentRep.partnerCode;
      }
    }
  }

  if (!result.operationalSupportRepresentativeCode && findOperationalSupportRep) {
    const found = await findOperationalSupportRep(shopIntroCode);
    if (found?.partnerCode && isRepresentativeRole(found.role)) {
      const operationalSupportRep = toNetworkUser(found);
      if (operationalSupportRep) {
        result.operationalSupportRepresentativeId = operationalSupportRep._id;
        result.operationalSupportRepresentativeCode =
          operationalSupportRep.partnerCode;
      }
    }
  }

  return result;
}

function buildCommissionEntry(
  recipient: CommissionRecipient,
  earningType: EarningType,
  percentage: number,
  usdAmount: number,
  context: {
    shopId: string;
    orderAmount: number;
    originalCurrency: string;
    exchangeRate: number;
    convertedUsdAmount: number;
  },
): CommissionEntry {
  return {
    recipientUserId: recipient._id,
    recipientPartnerCode: recipient.partnerCode,
    recipientRole: recipient.role,
    earningType,
    percentage: roundMoney(percentage),
    amount: roundMoney(usdAmount),
    shopId: context.shopId,
    orderAmount: context.orderAmount,
    originalCurrency: context.originalCurrency,
    exchangeRate: context.exchangeRate,
    convertedUsdAmount: context.convertedUsdAmount,
  };
}

/**
 * Representative-only commission by earning type.
 *
 * Default (Rep NOT Add-to-Network linked, or shop existed before the link):
 *   - Full Shop Introduction at admin/default rate (20%, or custom on the Rep)
 *   - No Partner Development / First Order split
 *
 * When Rep2 is linked under Rep1 via Add to Network, only shops that join
 * Rep2 AFTER that link are FO-eligible. On an eligible shop's FIRST order:
 *   - Shop Introduction % → Rep2  (admin per-link, default 10%)
 *   - Partner Development % → Rep1 (admin per-link, default 5%, must be ≤ Rep2 %)
 * Subsequent orders on eligible shops: 10% Shop Introduction.
 *
 * Partner Development is tracked per shop via partnerDevelopmentCommissionPaid.
 */
export function calculateRepresentativeCommissionEntries(params: {
  shopId: string;
  assignments: ShopEarningAssignments;
  recipients: {
    shopIntroduction?: CommissionRecipient | null;
    partnerDevelopment?: CommissionRecipient | null;
    /** Parent Promoter's upstream Rep — REP → PRO → PRO → SHOP Operational Support. */
    operationalSupport?: CommissionRecipient | null;
  };
  monetary: CommissionOrderAmounts;
  isFirstSuccessfulOrder: boolean;
  /** Admin/default Shop Intro % when FO network split does not apply. */
  defaultShopIntroductionRatePercent?: number;
  /** Operational Support % for parent Promoter's Rep (default 20%). */
  operationalSupportRatePercent?: number;
}): CommissionEntry[] {
  const { shopId, assignments, recipients, monetary, isFirstSuccessfulOrder } =
    params;
  const usdBase = monetary.convertedUsdAmount;
  if (usdBase <= 0) return [];

  const shopIntro = recipients.shopIntroduction;
  if (!shopIntro) return [];

  const context = {
    shopId,
    orderAmount: monetary.orderAmount,
    originalCurrency: monetary.orderCurrency,
    exchangeRate: monetary.exchangeRateToUsd,
    convertedUsdAmount: monetary.convertedUsdAmount,
  };

  const entries: CommissionEntry[] = [];
  const useNetworkFirstOrderSplit =
    assignments.partnerDevelopmentEligible === true;
  const defaultSiPercent =
    params.defaultShopIntroductionRatePercent != null &&
    !Number.isNaN(Number(params.defaultShopIntroductionRatePercent))
      ? Math.max(
          0,
          Math.min(100, Number(params.defaultShopIntroductionRatePercent)),
        )
      : DEFAULT_COMMISSION_RATES_PERCENT.master_partner;

  // Unlinked Rep / pre-link shops: always default Shop Introduction (e.g. 20%).
  if (!useNetworkFirstOrderSplit) {
    entries.push(
      buildCommissionEntry(
        shopIntro,
        'Shop Introduction',
        defaultSiPercent,
        usdBase * (defaultSiPercent / 100),
        context,
      ),
    );
    return entries;
  }

  // Child/Parent FO % are absolute (not a pool split).
  const split = resolveFirstOrderPoolSplit({
    shopIntroductionRate: assignments.shopIntroductionFirstOrderRatePercent,
    partnerDevelopmentRate: assignments.partnerDevelopmentRatePercent,
  });

  if (isFirstSuccessfulOrder) {
    const partnerDev = recipients.partnerDevelopment;
    const canPayPartnerDev =
      partnerDev &&
      !assignments.partnerDevelopmentCommissionPaid &&
      partnerDev._id !== shopIntro._id;

    if (canPayPartnerDev) {
      // First order: child SI % + parent PD % (both absolute).
      entries.push(
        buildCommissionEntry(
          shopIntro,
          'Shop Introduction',
          split.childKeepPercent,
          usdBase * (split.childKeepPercent / 100),
          context,
        ),
        buildCommissionEntry(
          partnerDev,
          'Partner Development',
          split.parentPercent,
          usdBase * (split.parentPercent / 100),
          context,
        ),
      );
    } else {
      // FO-eligible but PD not payable → child FO % only.
      entries.push(
        buildCommissionEntry(
          shopIntro,
          'Shop Introduction',
          split.childPoolPercent,
          usdBase * (split.childPoolPercent / 100),
          context,
        ),
      );
    }
  } else {
    // After first order: Child FO % to child only.
    entries.push(
      buildCommissionEntry(
        shopIntro,
        'Shop Introduction',
        split.childPoolPercent,
        usdBase * (split.childPoolPercent / 100),
        context,
      ),
    );
  }

  // REP → PRO → PRO → SHOP: parent Promoter's Rep earns Operational Support on every order.
  const operationalSupport = params.recipients.operationalSupport;
  if (operationalSupport && useNetworkFirstOrderSplit) {
    const osPct =
      params.operationalSupportRatePercent ??
      DEFAULT_COMMISSION_RATES_PERCENT.master_partner;
    entries.push(
      buildCommissionEntry(
        operationalSupport,
        'Operational Support',
        osPct,
        usdBase * (osPct / 100),
        context,
      ),
    );
  }

  return entries;
}

/**
 * True when commission should use Add-to-Network First Order split logic.
 * Rep → Promoter → Shop is normal hierarchy (Promoter SI + Rep OS), not FO.
 */
export function shouldUseFirstOrderNetworkCommission(params: {
  partnerDevelopmentEligible?: boolean;
  partnerDevelopmentPromoterEligible?: boolean;
  shopIntroductionRole?: string;
}): boolean {
  if (params.partnerDevelopmentPromoterEligible === true) return true;
  if (params.partnerDevelopmentEligible !== true) return false;
  return isRepresentativeRole(params.shopIntroductionRole);
}

/**
 * Default hierarchy commission on every shop order (not First Order network split).
 *
 * Rep → Shop: Rep earns Shop Introduction (default 20%).
 * Rep → Promoter → Shop: Promoter Shop Introduction (10%) + Rep Operational Support (20%).
 */
export function calculateHierarchyCommissionEntries(params: {
  shopId: string;
  chain: CommissionChain;
  monetary: CommissionOrderAmounts;
  promoterRatePercent?: number;
  representativeRatePercent?: number;
  subPromoterRatePercent?: number;
}): CommissionEntry[] {
  const { shopId, chain, monetary } = params;
  const usdBase = monetary.convertedUsdAmount;
  if (usdBase <= 0 || chain.isDirectHub) return [];

  const context = {
    shopId,
    orderAmount: monetary.orderAmount,
    originalCurrency: monetary.orderCurrency,
    exchangeRate: monetary.exchangeRateToUsd,
    convertedUsdAmount: monetary.convertedUsdAmount,
  };

  const repPct =
    params.representativeRatePercent ??
    DEFAULT_COMMISSION_RATES_PERCENT.master_partner;
  const promPct =
    params.promoterRatePercent ??
    DEFAULT_COMMISSION_RATES_PERCENT.regional_partner;
  const subPct = params.subPromoterRatePercent ?? 5;

  if (chain.represented && !chain.promoter) {
    return [
      buildCommissionEntry(
        chain.represented,
        'Shop Introduction',
        repPct,
        usdBase * (repPct / 100),
        context,
      ),
    ];
  }

  if (chain.promoter && chain.represented) {
    const entries: CommissionEntry[] = [
      buildCommissionEntry(
        chain.represented,
        'Operational Support',
        repPct,
        usdBase * (repPct / 100),
        context,
      ),
      buildCommissionEntry(
        chain.promoter,
        'Shop Introduction',
        promPct,
        usdBase * (promPct / 100),
        context,
      ),
    ];

    if (chain.subPromoter) {
      entries.push(
        buildCommissionEntry(
          chain.subPromoter,
          'Shop Introduction',
          subPct,
          usdBase * (subPct / 100),
          context,
        ),
      );
    }

    return entries;
  }

  return [];
}

/** @deprecated Use calculateRepresentativeCommissionEntries */
export function calculateCommissionEntries(
  orderAmountInOriginalCurrency: number,
  chain: CommissionChain,
  exchangeRateToUsd = 1,
): CommissionEntry[] {
  const monetary = resolveCommissionOrderAmounts({
    originalAmount: orderAmountInOriginalCurrency,
    originalCurrency: SYSTEM_BASE_CURRENCY,
    exchangeRateAtOrderTime: exchangeRateToUsd,
    baseCurrencyAmount: roundMoney(orderAmountInOriginalCurrency * exchangeRateToUsd),
  });

  if (chain.isDirectHub || !chain.represented) return [];

  return calculateRepresentativeCommissionEntries({
    shopId: '',
    assignments: {},
    recipients: {
      shopIntroduction: chain.represented,
      partnerDevelopment: null,
    },
    monetary,
    isFirstSuccessfulOrder: true,
  });
}
