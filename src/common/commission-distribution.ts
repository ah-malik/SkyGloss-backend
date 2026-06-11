import { UserRole } from '../users/entities/user.entity';

export const REPRESENTATIVE_COMMISSION_RATE = 0.2;
export const PROMOTER_COMMISSION_RATE = 0.1;
export const REPRESENTATIVE_SOLO_RATE = 0.2;

export interface CommissionChain {
  promoter: { _id: string; partnerCode: string; role: string } | null;
  represented: { _id: string; partnerCode: string; role: string } | null;
  isDirectHub: boolean;
}

export interface CommissionEntry {
  recipientUserId: string;
  recipientPartnerCode: string;
  recipientRole: string;
  percentage: number;
  amount: number;
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

/** Walk shop → parent chain to find Promoter and Representative recipients. */
export async function resolveShopCommissionChain(
  shop: { referredByPartnerCode?: string },
  lookup: NetworkUserLookup,
): Promise<CommissionChain> {
  const empty: CommissionChain = {
    promoter: null,
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

  if (directParent.role === UserRole.REGIONAL_PARTNER || directParent.role === 'regional_partner') {
    const promoter = toNetworkUser(directParent);
    let represented: CommissionChain['represented'] = null;

    if (directParent.referredByPartnerCode) {
      const repParent = await lookup(directParent.referredByPartnerCode);
      if (
        repParent &&
        (repParent.role === UserRole.MASTER_PARTNER || repParent.role === 'master_partner')
      ) {
        represented = toNetworkUser(repParent);
      }
    }

    return {
      promoter,
      represented,
      isDirectHub: false,
    };
  }

  if (directParent.role === UserRole.MASTER_PARTNER || directParent.role === 'master_partner') {
    return {
      promoter: null,
      represented: toNetworkUser(directParent),
      isDirectHub: false,
    };
  }

  return empty;
}

/** Apply the three documented commission scenarios. */
export function calculateCommissionEntries(
  totalAmount: number,
  chain: CommissionChain,
): CommissionEntry[] {
  if (chain.isDirectHub || totalAmount <= 0) return [];

  const amount = (value: number) =>
    Math.round(value * totalAmount * 100) / 100;

  if (chain.promoter && chain.represented) {
    return [
      {
        recipientUserId: chain.represented._id,
        recipientPartnerCode: chain.represented.partnerCode,
        recipientRole: chain.represented.role,
        percentage: REPRESENTATIVE_COMMISSION_RATE * 100,
        amount: amount(REPRESENTATIVE_COMMISSION_RATE),
      },
      {
        recipientUserId: chain.promoter._id,
        recipientPartnerCode: chain.promoter.partnerCode,
        recipientRole: chain.promoter.role,
        percentage: PROMOTER_COMMISSION_RATE * 100,
        amount: amount(PROMOTER_COMMISSION_RATE),
      },
    ];
  }

  if (chain.represented && !chain.promoter) {
    return [
      {
        recipientUserId: chain.represented._id,
        recipientPartnerCode: chain.represented.partnerCode,
        recipientRole: chain.represented.role,
        percentage: REPRESENTATIVE_SOLO_RATE * 100,
        amount: amount(REPRESENTATIVE_SOLO_RATE),
      },
    ];
  }

  return [];
}
