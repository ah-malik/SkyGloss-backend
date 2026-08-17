import { UserRole } from '../users/entities/user.entity';
import { isShopParentLinkRole } from '../common/user-hierarchy';
import { normalizePartnerCode } from '../common/partner-code';

export const ADMIN_CHAT_MONITOR_ROOM = 'admin_chat_monitor';

export type ShopChatPeerReason = 'operational_support' | 'parent_link';

export type ShopChatFields = {
  operationalSupportRepresentativeCode?: string | null;
  hubPartnerCode?: string | null;
  shopIntroductionRepresentativeCode?: string | null;
  shopIntroductionPromoterCode?: string | null;
  role?: string | null;
};

export type ChatRoomLike = {
  userId?: { toString(): string } | string | null;
  peerUserId?: { toString(): string } | string | null;
  participantIds?: Array<{ toString(): string } | string> | null;
};

function idString(value?: { toString(): string } | string | null): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString();
}

export function makeChatPairKey(idA: string, idB: string): string {
  return [String(idA), String(idB)].filter(Boolean).sort().join('_');
}

export function pickShopChatPeerCode(
  shop: ShopChatFields,
): { code: string; reason: ShopChatPeerReason } | null {
  const osCode = normalizePartnerCode(
    shop.operationalSupportRepresentativeCode || undefined,
  );
  if (osCode) {
    return { code: osCode, reason: 'operational_support' };
  }

  const parentCode = normalizePartnerCode(shop.hubPartnerCode || undefined);
  if (parentCode) {
    return { code: parentCode, reason: 'parent_link' };
  }

  return null;
}

export function isShopIntroductionPartner(
  shop: ShopChatFields,
  partnerCode?: string | null,
): boolean {
  const code = normalizePartnerCode(partnerCode || undefined);
  if (!code) return false;
  return (
    normalizePartnerCode(shop.shopIntroductionRepresentativeCode || undefined) ===
      code ||
    normalizePartnerCode(shop.shopIntroductionPromoterCode || undefined) === code
  );
}

/**
 * Shop chats with Operational Support Partner first.
 * If none is assigned, Hub/Distributor Parent Link is the fallback.
 * Shop Intro is never a chat counterpart unless that same person is OSP/parent.
 */
export function canPartnerDirectChatWithShop(
  partner: { partnerCode?: string | null; role?: string | null },
  shop: ShopChatFields,
): boolean {
  if (shop.role && shop.role !== UserRole.CERTIFIED_SHOP) return false;

  const partnerCode = normalizePartnerCode(partner.partnerCode || undefined);
  if (!partnerCode) return false;

  const picked = pickShopChatPeerCode(shop);
  if (!picked || picked.code !== partnerCode) return false;

  if (picked.reason === 'operational_support') {
    return (
      partner.role === UserRole.MASTER_PARTNER ||
      partner.role === 'master_partner'
    );
  }

  return isShopParentLinkRole(partner.role || undefined);
}

export function getChatParticipantIds(room: ChatRoomLike): string[] {
  const fromArray = (room.participantIds || [])
    .map((id) => idString(id))
    .filter(Boolean);
  if (fromArray.length >= 2) {
    return [...new Set(fromArray)];
  }

  const ids = [idString(room.userId), idString(room.peerUserId)].filter(
    Boolean,
  );
  return [...new Set(ids)];
}

export function isChatParticipant(
  room: ChatRoomLike,
  userId?: string | null,
): boolean {
  if (!userId) return false;
  return getChatParticipantIds(room).includes(String(userId));
}

export function getOtherChatParticipantId(
  room: ChatRoomLike,
  userId?: string | null,
): string | null {
  if (!userId) return null;
  const other = getChatParticipantIds(room).find((id) => id !== String(userId));
  return other || null;
}

export function canViewChatRoom(
  room: ChatRoomLike,
  userId: string,
  role?: string | null,
): boolean {
  if (role === UserRole.ADMIN) return true;
  return isChatParticipant(room, userId);
}

export function canSendChatMessage(
  room: ChatRoomLike,
  userId: string,
  role?: string | null,
): boolean {
  if (role === UserRole.ADMIN) return false;
  return isChatParticipant(room, userId);
}
