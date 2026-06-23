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

export interface CommissionChain {
  promoter: { _id: string; partnerCode: string; role: string } | null;
  subPromoter: { _id: string; partnerCode: string; role: string } | null;
  represented: { _id: string; partnerCode: string; role: string } | null;
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
    return [
      {
        recipientUserId: chain.represented._id,
        recipientPartnerCode: chain.represented.partnerCode,
        recipientRole: chain.represented.role,
        percentage: REPRESENTATIVE_SOLO_RATE * 100,
        amount: toCommissionUsd(REPRESENTATIVE_SOLO_RATE),
      },
    ];
  }

  if (chain.promoter && chain.represented) {
    const entries: CommissionEntry[] = [
      {
        recipientUserId: chain.represented._id,
        recipientPartnerCode: chain.represented.partnerCode,
        recipientRole: chain.represented.role,
        percentage: REPRESENTATIVE_COMMISSION_RATE * 100,
        amount: toCommissionUsd(REPRESENTATIVE_COMMISSION_RATE),
      },
    ];

    if (chain.subPromoter) {
      entries.push(
        {
          recipientUserId: chain.promoter._id,
          recipientPartnerCode: chain.promoter.partnerCode,
          recipientRole: chain.promoter.role,
          percentage: PROMOTER_COMMISSION_RATE * 100,
          amount: toCommissionUsd(PROMOTER_COMMISSION_RATE),
        },
        {
          recipientUserId: chain.subPromoter._id,
          recipientPartnerCode: chain.subPromoter.partnerCode,
          recipientRole: chain.subPromoter.role,
          percentage: SUB_PROMOTER_COMMISSION_RATE * 100,
          amount: toCommissionUsd(SUB_PROMOTER_COMMISSION_RATE),
        },
      );
    } else {
      entries.push({
        recipientUserId: chain.promoter._id,
        recipientPartnerCode: chain.promoter.partnerCode,
        recipientRole: chain.promoter.role,
        percentage: PROMOTER_COMMISSION_RATE * 100,
        amount: toCommissionUsd(PROMOTER_COMMISSION_RATE),
      });
    }

    return entries;
  }

  return [];
}
