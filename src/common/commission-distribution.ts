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

/** @deprecated Legacy FO constants — commission now uses fixed 10/5/10 of order $. */
export const SHOP_INTRODUCTION_FIRST_ORDER_RATE = 0.1;
export const PARTNER_DEVELOPMENT_FIRST_ORDER_RATE = 0.05;
export const SHOP_INTRODUCTION_SUBSEQUENT_RATE = 0.1;
export const TOTAL_FIRST_ORDER_COMMISSION_RATE = 0.25;

/** Default Shop Introduction / Operational Support % of order $. */
export const DEFAULT_COMMISSION_RATES_PERCENT = {
  master_partner: 10,
  regional_partner: 10,
  // sub_promoter: 0, // removed — Sub-Promoter role migrated to Promoter
} as const;

/** Partner Intro (Partner Development) % of order $ on every shop order. */
export const DEFAULT_PARTNER_INTRO_RATE_PERCENT = 5;

/** Operational Support % of order $ when assigned on the shop. */
export const DEFAULT_OPERATIONAL_SUPPORT_RATE_PERCENT = 10;

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

/** Resolve Rep/Promoter commission % (admin custom override, else role default 10%). */
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
  /** When true, Partner Intro (Partner Development) is paid on every order. */
  partnerDevelopmentEligible?: boolean;
  /** Partner Intro % of order $ (default 5). */
  partnerDevelopmentRatePercent?: number;
  /** Shop Introduction % of order $ (default 10). Kept field name for shop stamps. */
  shopIntroductionFirstOrderRatePercent?: number;
}

/** Role-specific Shop Intro / Partner Intro defaults (absolute % of order $). */
export const DEFAULT_FIRST_ORDER_RATES_BY_ROLE = {
  master_partner: {
    shopIntroductionRate: 10,
    partnerDevelopmentRate: 5,
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
 * Normalize Shop Intro / Partner Intro rates (% of order $).
 *
 * Defaults: Shop Introduction 10%, Partner Intro 5% for both Rep and Promoter.
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

  return {
    shopIntroductionRate,
    partnerDevelopmentRate,
  };
}

/**
 * Resolve Shop Intro / Partner Intro percents of order $.
 * Example: child 10%, parent 5% → SI $10 and Partner Intro $5 on a $100 order.
 */
export function resolveFirstOrderPoolSplit(params?: {
  shopIntroductionRate?: number | null;
  partnerDevelopmentRate?: number | null;
}): {
  /** Shop Introduction % of shop order $. */
  childPoolPercent: number;
  /** Partner Intro % of shop order $. */
  parentPercent: number;
  /** Shop Introduction % of shop order $ (same as child pool). */
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

/**
 * Partner Intro $ = parent% of order $.
 * Example: order $100, parent 5% → $5.
 *
 * `childShopIntroductionPercent` is ignored (kept for call-site compatibility).
 */
export function resolvePartnerDevelopmentAmountFromChildCommission(params: {
  orderUsdAmount: number;
  childShopIntroductionPercent?: number;
  parentPartnerDevelopmentPercent: number;
}): number {
  return (
    params.orderUsdAmount * (params.parentPartnerDevelopmentPercent / 100)
  );
}

export interface CommissionOrderAmounts {
  orderAmount: number;
  orderCurrency: string;
  exchangeRateToUsd: number;
  convertedUsdAmount: number;
}

/**
 * Platform deduction applied to (order total − shipping) before commission %.
 * Example: $125 − $25 shipping = $100 remaining → $96.50 commissionable (3.5% off).
 */
export const COMMISSION_PLATFORM_DEDUCTION_RATE = 0.035;

/** Order total in original currency + locked FX rate for USD credit.
 *  Commission base excludes shipping fees, then deducts 3.5% from the remainder.
 */
export function resolveCommissionOrderAmounts(order: {
  totalAmount?: number;
  originalAmount?: number;
  shippingFee?: number;
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
  const grossAmount = roundMoney(order.originalAmount ?? order.totalAmount ?? 0);
  const shippingFee = roundMoney(Math.max(0, Number(order.shippingFee) || 0));
  // Commission is on product/subtotal only — never on shipping.
  const remainingAmount = roundMoney(Math.max(0, grossAmount - shippingFee));
  // Then deduct 3.5% from remaining → commissionable base.
  const orderAmount = roundMoney(
    remainingAmount * (1 - COMMISSION_PLATFORM_DEDUCTION_RATE),
  );

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
    grossAmount > 0 &&
    order.baseCurrencyAmount > 0
  ) {
    const exchangeRateToUsd = roundExchangeRate(
      order.baseCurrencyAmount / grossAmount,
    );
    return {
      orderAmount,
      orderCurrency,
      exchangeRateToUsd,
      convertedUsdAmount: roundMoney(orderAmount * exchangeRateToUsd),
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
  partnerDevelopmentPromoterCode?: string;
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

  // Partner Intro comes from the Shop Intro user's Partner Intro assignment.
  // Operational Support stays Unassigned until Admin sets it on the shop.
  if (!result.partnerDevelopmentRepresentativeCode) {
    const shopIntroRepUser = await lookup(shopIntroCode);
    if (shopIntroRepUser) {
      if (isMainPromoterRole(shopIntroRepUser.role)) {
        const promoterPdCode =
          shopIntroRepUser.partnerDevelopmentRepresentativeCode?.trim() ||
          shopIntroRepUser.partnerDevelopmentPromoterCode?.trim();
        if (promoterPdCode) {
          const pdUser = await lookup(promoterPdCode);
          if (pdUser?.partnerCode) {
            const pd = toNetworkUser(pdUser);
            if (pd) {
              result.partnerDevelopmentRepresentativeId = pd._id;
              result.partnerDevelopmentRepresentativeCode = pd.partnerCode;
            }
          }
        } else {
          // Promoter under REP: parent REP is Partner Intro.
          const upstreamRep = await resolveRepresentativeForPromoter(
            shopIntroRepUser,
            lookup,
          );
          if (upstreamRep) {
            result.partnerDevelopmentRepresentativeId = upstreamRep._id;
            result.partnerDevelopmentRepresentativeCode =
              upstreamRep.partnerCode;
          }
        }
      } else {
        const partnerDevelopmentRep =
          await resolvePartnerDevelopmentRepresentative(
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
  }

  // Do not auto-resolve Operational Support — Admin assigns REPs only.
  void findOperationalSupportRep;

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
 * Commission by earning type on every shop order:
 *   - Shop Introduction → 10% of order $ (Shop Intro recipient)
 *   - Partner Intro (Partner Development) → 5% of order $ when assigned
 *   - Operational Support → 10% of order $ when Admin-assigned (may equal Shop Intro)
 */
export function calculateRepresentativeCommissionEntries(params: {
  shopId: string;
  assignments: ShopEarningAssignments;
  recipients: {
    shopIntroduction?: CommissionRecipient | null;
    partnerDevelopment?: CommissionRecipient | null;
    /** Admin-assigned Operational Support Representative (REP only). */
    operationalSupport?: CommissionRecipient | null;
  };
  monetary: CommissionOrderAmounts;
  /** @deprecated Ignored — Partner Intro pays on every order. */
  isFirstSuccessfulOrder?: boolean;
  /** Admin/default Shop Intro % (default 10%). */
  defaultShopIntroductionRatePercent?: number;
  /** Operational Support % (default 10%). */
  operationalSupportRatePercent?: number;
}): CommissionEntry[] {
  const { shopId, assignments, recipients, monetary } = params;
  const usdBase = monetary.convertedUsdAmount;
  if (usdBase <= 0) return [];

  const shopIntro = recipients.shopIntroduction;
  const operationalSupport = params.recipients.operationalSupport;
  const partnerDev = recipients.partnerDevelopment;

  if (!shopIntro && !operationalSupport && !partnerDev) return [];

  const context = {
    shopId,
    orderAmount: monetary.orderAmount,
    originalCurrency: monetary.orderCurrency,
    exchangeRate: monetary.exchangeRateToUsd,
    convertedUsdAmount: monetary.convertedUsdAmount,
  };

  const entries: CommissionEntry[] = [];

  if (shopIntro) {
    const defaultSiPercent =
      params.defaultShopIntroductionRatePercent != null &&
      !Number.isNaN(Number(params.defaultShopIntroductionRatePercent))
        ? Math.max(
            0,
            Math.min(100, Number(params.defaultShopIntroductionRatePercent)),
          )
        : DEFAULT_COMMISSION_RATES_PERCENT.master_partner;

    const siPercent = normalizeShopIntroductionFirstOrderRatePercent(
      assignments.shopIntroductionFirstOrderRatePercent ?? defaultSiPercent,
    );

    entries.push(
      buildCommissionEntry(
        shopIntro,
        'Shop Introduction',
        siPercent,
        usdBase * (siPercent / 100),
        context,
      ),
    );

    const canPayPartnerIntro =
      !!partnerDev &&
      partnerDev._id !== shopIntro._id &&
      assignments.partnerDevelopmentEligible !== false;

    if (canPayPartnerIntro) {
      const partnerIntroPercent = normalizePartnerDevelopmentRatePercent(
        assignments.partnerDevelopmentRatePercent,
      );
      entries.push(
        buildCommissionEntry(
          partnerDev,
          'Partner Development',
          partnerIntroPercent,
          resolvePartnerDevelopmentAmountFromChildCommission({
            orderUsdAmount: usdBase,
            parentPartnerDevelopmentPercent: partnerIntroPercent,
          }),
          context,
        ),
      );
    }
  }

  // Operational Support on every order when Admin has assigned a REP (may equal SI).
  if (operationalSupport) {
    const osPct =
      params.operationalSupportRatePercent ??
      DEFAULT_OPERATIONAL_SUPPORT_RATE_PERCENT;
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
 * Prefer stamped earning-type commissions whenever Shop Intro / Partner Intro /
 * Operational Support assignments exist. Hierarchy path is legacy fallback only.
 */
export function shouldUseFirstOrderNetworkCommission(params: {
  partnerDevelopmentEligible?: boolean;
  partnerDevelopmentPromoterEligible?: boolean;
  shopIntroductionRole?: string;
  hasOperationalSupport?: boolean;
}): boolean {
  if (params.hasOperationalSupport === true) return true;
  if (params.partnerDevelopmentPromoterEligible === true) return true;
  if (params.partnerDevelopmentEligible === true) return true;
  // Still use earning-type path for plain Rep/Promoter Shop Intro stamps.
  return (
    isRepresentativeRole(params.shopIntroductionRole) ||
    isMainPromoterRole(params.shopIntroductionRole)
  );
}

/**
 * Legacy hierarchy commission fallback.
 *
 * Rep → Shop: Rep Shop Introduction (10%).
 * Rep → Promoter → Shop: Promoter Shop Introduction (10%) only —
 * Operational Support is Admin-assigned and not auto-inferred here.
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

  if (chain.promoter) {
    const entries: CommissionEntry[] = [
      buildCommissionEntry(
        chain.promoter,
        'Shop Introduction',
        promPct,
        usdBase * (promPct / 100),
        context,
      ),
    ];

    // Partner Intro: upstream REP (when Promoter sits under a REP).
    if (chain.represented) {
      entries.push(
        buildCommissionEntry(
          chain.represented,
          'Partner Development',
          DEFAULT_PARTNER_INTRO_RATE_PERCENT,
          usdBase * (DEFAULT_PARTNER_INTRO_RATE_PERCENT / 100),
          context,
        ),
      );
    }

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
