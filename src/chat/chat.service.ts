import {
  ForbiddenException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatRoom, ChatRoomDocument } from './entities/chat-room.entity';
import {
  ChatMessage,
  ChatMessageDocument,
} from './entities/chat-message.entity';
import { UsersService } from '../users/users.service';
import { UserDocument, UserRole, UserStatus } from '../users/entities/user.entity';
import { isShopParentLinkRole } from '../common/user-hierarchy';
import { normalizePartnerCode } from '../common/partner-code';
import {
  canSendChatMessage,
  canViewChatRoom,
  makeChatPairKey,
} from './chat-connection';

type ChatUserSnapshot = {
  id: string;
  name: string;
  email: string;
  type: string;
};

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatRoom.name) private chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessageDocument>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  private displayName(user: {
    firstName?: string;
    lastName?: string;
    email?: string;
    shopName?: string;
  }): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.shopName || user.email || 'User';
  }

  private toSnapshot(user: UserDocument): ChatUserSnapshot {
    return {
      id: user._id.toString(),
      name: this.displayName(user),
      email: user.email || '',
      type: user.role,
    };
  }

  private isUsableChatPeer(
    user: UserDocument | null | undefined,
  ): user is UserDocument {
    if (!user) return false;
    return !user.status || user.status === UserStatus.ACTIVE;
  }

  async resolveChatPeerForShop(
    shop: UserDocument,
  ): Promise<UserDocument | null> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return null;

    const osCode = normalizePartnerCode(
      shop.operationalSupportRepresentativeCode || undefined,
    );
    if (osCode) {
      const osUser = await this.usersService.findByPartnerCode(osCode);
      if (
        this.isUsableChatPeer(osUser) &&
        osUser.role === UserRole.MASTER_PARTNER
      ) {
        return osUser;
      }
    }

    const parentCode =
      await this.usersService.resolveActingParentPartnerCodeForShop({
        hubPartnerCode: shop.hubPartnerCode,
        country: shop.country,
      });
    if (!parentCode) return null;

    const parent = await this.usersService.findByPartnerCode(parentCode);
    if (
      this.isUsableChatPeer(parent) &&
      isShopParentLinkRole(parent.role)
    ) {
      return parent;
    }

    return null;
  }

  async createOrGetDirectRoom(
    userA: UserDocument,
    userB: UserDocument,
  ): Promise<ChatRoom> {
    const idA = userA._id.toString();
    const idB = userB._id.toString();
    if (idA === idB) {
      throw new ForbiddenException('Chat must be between two different users');
    }

    const pairKey = makeChatPairKey(idA, idB);
    const existing = await this.chatRoomModel.findOne({ pairKey }).exec();
    if (existing) {
      if (existing.status !== 'active') {
        existing.status = 'active';
        await existing.save();
      }
      return existing;
    }

    const shopSide =
      userA.role === UserRole.CERTIFIED_SHOP
        ? userA
        : userB.role === UserRole.CERTIFIED_SHOP
          ? userB
          : userA;
    const peerSide = shopSide._id.toString() === idA ? userB : userA;
    const shopSnap = this.toSnapshot(shopSide);
    const peerSnap = this.toSnapshot(peerSide);

    const newRoom = new this.chatRoomModel({
      pairKey,
      participantIds: [new Types.ObjectId(idA), new Types.ObjectId(idB)],
      userId: new Types.ObjectId(shopSnap.id),
      userName: shopSnap.name,
      userEmail: shopSnap.email,
      userType: shopSnap.type,
      peerUserId: new Types.ObjectId(peerSnap.id),
      peerUserName: peerSnap.name,
      peerUserEmail: peerSnap.email,
      peerUserType: peerSnap.type,
      status: 'active',
    });

    try {
      return await newRoom.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        const raced = await this.chatRoomModel.findOne({ pairKey }).exec();
        if (raced) return raced;
      }
      throw err;
    }
  }

  async openDirectRoom(
    actor: UserDocument,
    requestedUserId?: string,
  ): Promise<ChatRoom> {
    if (actor.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Admin can view chats but cannot participate',
      );
    }

    if (actor.role === UserRole.CERTIFIED_SHOP) {
      const peer = await this.resolveChatPeerForShop(actor);
      if (!peer) {
        throw new ForbiddenException(
          'No Operational Support Partner, Hub, or Distributor is available for chat',
        );
      }
      return this.createOrGetDirectRoom(actor, peer);
    }

    const shopId = requestedUserId?.toString?.() || '';
    if (!shopId || shopId === actor._id.toString()) {
      throw new ForbiddenException(
        'Select a shop from your Network to start a private chat',
      );
    }

    const shop = await this.usersService.findOne(shopId);
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) {
      throw new ForbiddenException('Chat is only available with a shop user');
    }

    const resolvedPeer = await this.resolveChatPeerForShop(shop);
    if (!resolvedPeer || resolvedPeer._id.toString() !== actor._id.toString()) {
      throw new ForbiddenException('You cannot chat with this shop');
    }

    return this.createOrGetDirectRoom(shop, actor);
  }

  /**
   * Legacy helper kept for older rooms that predate 1-to-1 pairing.
   * Never returns a private pair room by shop userId alone.
   */
  async createOrGetRoom(userData: {
    userId?: string;
    userName: string;
    userEmail: string;
    userType: string;
  }): Promise<ChatRoom> {
    if (userData.userId) {
      const existingRoom = await this.chatRoomModel
        .findOne({
          userId: new Types.ObjectId(userData.userId),
          status: 'active',
          $or: [
            { pairKey: { $exists: false } },
            { pairKey: null },
            { pairKey: '' },
          ],
        })
        .exec();
      if (existingRoom) return existingRoom;
    }

    throw new ForbiddenException(
      'Chat must be a private 1-to-1 conversation',
    );
  }

  canUserViewRoom(room: ChatRoom, userId: string, role?: string): boolean {
    return canViewChatRoom(room, userId, role);
  }

  async canUserSendInRoom(
    room: ChatRoom,
    userId: string,
    role?: string,
  ): Promise<boolean> {
    if (!canSendChatMessage(room, userId, role)) return false;

    const shopId = room.userId?.toString?.();
    const peerId = room.peerUserId?.toString?.();
    if (!shopId || !peerId) return false;

    const shop = await this.usersService.findOne(shopId);
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) return false;

    const resolvedPeer = await this.resolveChatPeerForShop(shop);
    if (!resolvedPeer) return false;

    return resolvedPeer._id.toString() === peerId;
  }

  async saveMessage(
    roomId: string,
    senderName: string,
    senderType: string,
    message: string,
    image?: { url?: string; publicId?: string },
  ): Promise<ChatMessage> {
    const imageUrl = image?.url || undefined;
    const chatMessage = new this.chatMessageModel({
      roomId: new Types.ObjectId(roomId),
      senderName,
      senderType,
      message: message || '',
      ...(imageUrl
        ? { imageUrl, imagePublicId: image?.publicId || undefined }
        : {}),
    });

    const lastMessage = message?.trim()
      ? message.trim()
      : imageUrl
        ? '📷 Photo'
        : message;

    // Update room's last message
    await this.chatRoomModel.findByIdAndUpdate(roomId, {
      lastMessage,
      lastMessageAt: new Date(),
    });

    return chatMessage.save();
  }

  async getMessages(roomId: string): Promise<ChatMessage[]> {
    return this.chatMessageModel
      .find({ roomId: new Types.ObjectId(roomId) })
      .sort({ createdAt: 1 })
      .exec();
  }

  async getAllRooms(): Promise<ChatRoom[]> {
    return this.chatRoomModel
      .find()
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .exec();
  }

  async getRoomById(roomId: string): Promise<ChatRoom | null> {
    return this.chatRoomModel.findById(roomId).exec();
  }

  async closeRoom(roomId: string): Promise<ChatRoom | null> {
    return this.chatRoomModel
      .findByIdAndUpdate(roomId, { status: 'closed' }, { new: true })
      .exec();
  }
}
