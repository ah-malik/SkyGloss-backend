import { UserRole } from '../users/entities/user.entity';
import {
  SYSTEM_BASE_CURRENCY,
  roundExchangeRate,
  roundMoney,
} from './order-monetary';

export const REPRESENTATIVE_COMMISSION_RATE = 0.2;
export const PROMOTER_COMMISSION_RATE = 0.1;
export const SUB_PROMOTER_COMMISSION_RATE = 0.05;
export const REPRESENTATIVE_SOLO_RATE = 0.2;

export const DEFAULT_COMMISSION_RATES_PERCENT = {
  master_partner: 20,
  regional_partner: 10,
  sub_promoter: 5,
} as const;

export function isCommissionEligibleRole(role?: string): boolean {
  if (!role) return false;
  return (
    role === UserRole.MASTER_PARTNER ||
    role === 'master_partner' ||
    role === UserRole.REGIONAL_PARTNER ||
    role === 'regional_partner' ||
    role === UserRole.SUB_PROMOTER ||
    role === 'sub_promoter'
  );
}

export function getDefaultCommissionRatePercent(role?: string): number {
  if (role === UserRole.MASTER_PARTNER || role === 'master_partner') {
    return DEFAULT_COMMISSION_RATES_PERCENT.master_partner;
  }
  if (role === UserRole.REGIONAL_PARTNER || role === 'regional_partner') {
    return DEFAULT_COMMISSION_RATES_PERCENT.regional_partner;
  }
  if (role === UserRole.SUB_PROMOTER || role === 'sub_promoter') {
    return DEFAULT_COMMISSION_RATES_PERCENT.sub_promoter;
  }
  return 0;
}

/** Resolve effective commission as a decimal (e.g. 0.2 for 20%). */
export function resolveCommissionRateDecimal(
  role: string,
  customCommissionRate?: number | null,
): number {
  if (
    customCommissionRate != null &&
    !Number.isNaN(customCommissionRate) &&
    customCommissionRate >= 0
  ) {
    return customCommissionRate / 100;
  }
  return getDefaultCommissionRatePercent(role) / 100;
}

export interface CommissionRecipient {
  _id: string;
  partnerCode: string;
  role: string;
  customCommissionRate?: number | null;
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
  percentage: number;
  /** Commission credited in USD (base currency). */
  amount: number;
}

export interface CommissionOrderAmounts {
  orderAmount: number;
  orderCurrency: string;
  exchangeRateToUsd: number;
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
    return { orderAmount, orderCurrency, exchangeRateToUsd: 1 };
  }

  if (
    order.exchangeRateAtOrderTime != null &&
    order.exchangeRateAtOrderTime > 0
  ) {
    return {
      orderAmount,
      orderCurrency,
      exchangeRateToUsd: roundExchangeRate(order.exchangeRateAtOrderTime),
    };
  }

  if (
    typeof order.baseCurrencyAmount === 'number' &&
    orderAmount > 0 &&
    order.baseCurrencyAmount > 0
  ) {
    return {
      orderAmount,
      orderCurrency,
      exchangeRateToUsd: roundExchangeRate(order.baseCurrencyAmount / orderAmount),
    };
  }

  return { orderAmount, orderCurrency, exchangeRateToUsd: 1 };
}

type NetworkUserLookup = (partnerCode: string) => Promise<{
  _id: { toString(): string };
  partnerCode?: string;
  role: string;
  referredByPartnerCode?: string;
  customCommissionRate?: number | null;
} | null>;

function toNetworkUser(user: {
  _id: { toString(): string };
  partnerCode?: string;
  role: string;
  customCommissionRate?: number | null;
}) {
  if (!user.partnerCode) return null;
  return {
    _id: user._id.toString(),
    partnerCode: user.partnerCode,
    role: user.role,
    customCommissionRate: user.customCommissionRate,
  };
}

function isMainPromoterRole(role?: string): boolean {
  return role === UserRole.REGIONAL_PARTNER || role === 'regional_partner';
}

function isSubPromoterRole(role?: string): boolean {
  return role === UserRole.SUB_PROMOTER || role === 'sub_promoter';
}

async function resolveRepresentativeForPromoter(
  promoter: { referredByPartnerCode?: string },
  lookup: NetworkUserLookup,
) {
  if (!promoter.referredByPartnerCode) return null;
  const repParent = await lookup(promoter.referredByPartnerCode.trim());
  if (
    repParent &&
    (repParent.role === UserRole.MASTER_PARTNER ||
      repParent.role === 'master_partner')
  ) {
    return toNetworkUser(repParent);
  }
  return null;
}

/** Walk shop → parent chain to find Promoter, Sub-Promoter, and Representative recipients. */
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

  if (directParent.role === UserRole.MASTER_PARTNER || directParent.role === 'master_partner') {
    return {
      promoter: null,
      subPromoter: null,
      represented: toNetworkUser(directParent),
      isDirectHub: false,
    };
  }

  return empty;
}

/** Apply commission % on order currency, then credit USD using locked FX rate. */
export function calculateCommissionEntries(
  orderAmountInOriginalCurrency: number,
  chain: CommissionChain,
  exchangeRateToUsd = 1,
): CommissionEntry[] {
  if (chain.isDirectHub || orderAmountInOriginalCurrency <= 0) return [];

  const usdRate = exchangeRateToUsd > 0 ? exchangeRateToUsd : 1;

  const toCommissionUsd = (rate: number) => {
    const inOrderCurrency = roundMoney(rate * orderAmountInOriginalCurrency);
    return roundMoney(inOrderCurrency * usdRate);
  };

  if (chain.represented && !chain.promoter) {
    const repRate = resolveCommissionRateDecimal(
      chain.represented.role,
      chain.represented.customCommissionRate,
    );
    return [
      {
        recipientUserId: chain.represented._id,
        recipientPartnerCode: chain.represented.partnerCode,
        recipientRole: chain.represented.role,
        percentage: repRate * 100,
        amount: toCommissionUsd(repRate),
      },
    ];
  }

  if (chain.promoter && chain.represented) {
    const repRate = resolveCommissionRateDecimal(
      chain.represented.role,
      chain.represented.customCommissionRate,
    );
    const promoterRate = resolveCommissionRateDecimal(
      chain.promoter.role,
      chain.promoter.customCommissionRate,
    );

    const entries: CommissionEntry[] = [
      {
        recipientUserId: chain.represented._id,
        recipientPartnerCode: chain.represented.partnerCode,
        recipientRole: chain.represented.role,
        percentage: repRate * 100,
        amount: toCommissionUsd(repRate),
      },
    ];

    if (chain.subPromoter) {
      const subRate = resolveCommissionRateDecimal(
        chain.subPromoter.role,
        chain.subPromoter.customCommissionRate,
      );
      entries.push(
        {
          recipientUserId: chain.promoter._id,
          recipientPartnerCode: chain.promoter.partnerCode,
          recipientRole: chain.promoter.role,
          percentage: promoterRate * 100,
          amount: toCommissionUsd(promoterRate),
        },
        {
          recipientUserId: chain.subPromoter._id,
          recipientPartnerCode: chain.subPromoter.partnerCode,
          recipientRole: chain.subPromoter.role,
          percentage: subRate * 100,
          amount: toCommissionUsd(subRate),
        },
      );
    } else {
      entries.push({
        recipientUserId: chain.promoter._id,
        recipientPartnerCode: chain.promoter.partnerCode,
        recipientRole: chain.promoter.role,
        percentage: promoterRate * 100,
        amount: toCommissionUsd(promoterRate),
      });
    }

    return entries;
  }

  return [];
}
