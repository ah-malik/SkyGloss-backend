import { UserRole } from '../users/entities/user.entity';
import {
  canPartnerDirectChatWithShop,
  canSendChatMessage,
  canViewChatRoom,
  getOtherChatParticipantId,
  isChatParticipant,
  isShopIntroductionPartner,
  makeChatPairKey,
  pickShopChatPeerCode,
} from './chat-connection';

describe('chat-connection', () => {
  const shop = {
    role: UserRole.CERTIFIED_SHOP,
    operationalSupportRepresentativeCode: 'R6R6',
    hubPartnerCode: 'HUB01',
    shopIntroductionRepresentativeCode: 'INTRO1',
    shopIntroductionPromoterCode: '',
  };

  it('prefers Operational Support Partner over Hub/Distributor', () => {
    expect(pickShopChatPeerCode(shop)).toEqual({
      code: 'R6R6',
      reason: 'operational_support',
    });
  });

  it('falls back to Hub/Distributor Parent Link when OSP is unassigned', () => {
    expect(
      pickShopChatPeerCode({
        ...shop,
        operationalSupportRepresentativeCode: '',
      }),
    ).toEqual({
      code: 'HUB01',
      reason: 'parent_link',
    });
  });

  it('does not let Shop Intro chat unless they are the assigned OSP', () => {
    expect(isShopIntroductionPartner(shop, 'INTRO1')).toBe(true);
    expect(
      canPartnerDirectChatWithShop(
        { partnerCode: 'INTRO1', role: UserRole.MASTER_PARTNER },
        shop,
      ),
    ).toBe(false);
    expect(
      canPartnerDirectChatWithShop(
        { partnerCode: 'R6R6', role: UserRole.MASTER_PARTNER },
        shop,
      ),
    ).toBe(true);
  });

  it('lets Hub/Distributor chat only when OSP is not assigned', () => {
    expect(
      canPartnerDirectChatWithShop(
        { partnerCode: 'HUB01', role: UserRole.PARTNER },
        shop,
      ),
    ).toBe(false);

    const noOsShop = { ...shop, operationalSupportRepresentativeCode: '' };
    expect(
      canPartnerDirectChatWithShop(
        { partnerCode: 'HUB01', role: UserRole.PARTNER },
        noOsShop,
      ),
    ).toBe(true);
    expect(
      canPartnerDirectChatWithShop(
        { partnerCode: 'HUB01', role: UserRole.DISTRIBUTOR },
        noOsShop,
      ),
    ).toBe(true);
    expect(
      canPartnerDirectChatWithShop(
        { partnerCode: 'HUB01', role: UserRole.MASTER_PARTNER },
        noOsShop,
      ),
    ).toBe(false);
  });

  it('keeps 1-to-1 rooms private to the two participants', () => {
    const room = {
      userId: 'shop36',
      peerUserId: 'r6r6',
      participantIds: ['shop36', 'r6r6'],
    };

    expect(isChatParticipant(room, 'shop36')).toBe(true);
    expect(isChatParticipant(room, 'r6r6')).toBe(true);
    expect(isChatParticipant(room, 'third-user')).toBe(false);
    expect(getOtherChatParticipantId(room, 'shop36')).toBe('r6r6');
    expect(canViewChatRoom(room, 'third-user', UserRole.MASTER_PARTNER)).toBe(
      false,
    );
    expect(canViewChatRoom(room, 'admin1', UserRole.ADMIN)).toBe(true);
    expect(canSendChatMessage(room, 'admin1', UserRole.ADMIN)).toBe(false);
    expect(canSendChatMessage(room, 'shop36', UserRole.CERTIFIED_SHOP)).toBe(
      true,
    );
    expect(canSendChatMessage(room, 'third-user', UserRole.PARTNER)).toBe(false);
    expect(canViewChatRoom(room, 'shop36', UserRole.CERTIFIED_SHOP)).toBe(true);
    expect(
      canPartnerDirectChatWithShop(
        { partnerCode: 'INTRO1', role: UserRole.REGIONAL_PARTNER },
        shop,
      ),
    ).toBe(false);
  });

  it('builds a stable pair key regardless of id order', () => {
    expect(makeChatPairKey('b', 'a')).toBe(makeChatPairKey('a', 'b'));
  });
});
