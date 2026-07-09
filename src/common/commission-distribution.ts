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
export const PARTNER_DEVELOPMENT_FIRST_ORDER_RATE = 0.05;
export const SHOP_INTRODUCTION_SUBSEQUENT_RATE = 0.1;
export const TOTAL_FIRST_ORDER_COMMISSION_RATE = 0.1;

/** @deprecated Legacy role defaults — representative commissions use earning-type rates only. */
export const DEFAULT_COMMISSION_RATES_PERCENT = {
  master_partner: 10,
  regional_partner: 0,
  sub_promoter: 0,
} as const;

/** Only Representatives (master_partner) earn commissions under the earning-type model. */
export function isCommissionEligibleRole(role?: string): boolean {
  if (!role) return false;
  return role === UserRole.MASTER_PARTNER || role === 'master_partner';
}

export function getDefaultCommissionRatePercent(role?: string): number {
  if (role === UserRole.MASTER_PARTNER || role === 'master_partner') {
    return DEFAULT_COMMISSION_RATES_PERCENT.master_partner;
  }
  return 0;
}

/** @deprecated Custom rates are not used for representative earning-type commissions. */
export function resolveCommissionRateDecimal(
  role: string,
  _customCommissionRate?: number | null,
): number {
  return getDefaultCommissionRatePercent(role) / 100;
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
    if (chain.represented) {
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
    const partnerDevelopmentRep = shopIntroRepUser
      ? await resolvePartnerDevelopmentRepresentative(shopIntroRepUser, lookup)
      : null;
    if (partnerDevelopmentRep) {
      result.partnerDevelopmentRepresentativeId = partnerDevelopmentRep._id;
      result.partnerDevelopmentRepresentativeCode =
        partnerDevelopmentRep.partnerCode;
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
 * First order: 10% total (5% Shop Introduction + 5% Partner Development).
 * Subsequent orders: 10% Shop Introduction only.
 */
export function calculateRepresentativeCommissionEntries(params: {
  shopId: string;
  assignments: ShopEarningAssignments;
  recipients: {
    shopIntroduction?: CommissionRecipient | null;
    partnerDevelopment?: CommissionRecipient | null;
  };
  monetary: CommissionOrderAmounts;
  isFirstSuccessfulOrder: boolean;
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

  if (isFirstSuccessfulOrder) {
    const partnerDev = recipients.partnerDevelopment;
    const canPayPartnerDev =
      partnerDev &&
      !assignments.partnerDevelopmentCommissionPaid &&
      partnerDev._id !== shopIntro._id;

    if (canPayPartnerDev) {
      entries.push(
        buildCommissionEntry(
          shopIntro,
          'Shop Introduction',
          SHOP_INTRODUCTION_FIRST_ORDER_RATE * 100,
          usdBase * SHOP_INTRODUCTION_FIRST_ORDER_RATE,
          context,
        ),
        buildCommissionEntry(
          partnerDev,
          'Partner Development',
          PARTNER_DEVELOPMENT_FIRST_ORDER_RATE * 100,
          usdBase * PARTNER_DEVELOPMENT_FIRST_ORDER_RATE,
          context,
        ),
      );
    } else {
      entries.push(
        buildCommissionEntry(
          shopIntro,
          'Shop Introduction',
          TOTAL_FIRST_ORDER_COMMISSION_RATE * 100,
          usdBase * TOTAL_FIRST_ORDER_COMMISSION_RATE,
          context,
        ),
      );
    }
  } else {
    entries.push(
      buildCommissionEntry(
        shopIntro,
        'Shop Introduction',
        SHOP_INTRODUCTION_SUBSEQUENT_RATE * 100,
        usdBase * SHOP_INTRODUCTION_SUBSEQUENT_RATE,
        context,
      ),
    );
  }

  return entries;
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
