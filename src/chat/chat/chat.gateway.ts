import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from '../chat.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { WsAuthService, WsAuthedUser } from '../../auth/ws-auth.service';
import { installWsAuthMiddleware } from '../../auth/install-ws-auth.middleware';
import {
  ADMIN_CHAT_MONITOR_ROOM,
  getOtherChatParticipantId,
} from '../chat-connection';

type AuthedSocket = Socket & { data: { user?: WsAuthedUser } };

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly wsAuthService: WsAuthService,
  ) {}

  afterInit(server: Server) {
    installWsAuthMiddleware(server, this.wsAuthService);
  }

  async handleConnection(client: AuthedSocket) {
    const user = client.data?.user;
    if (!user) {
      this.logger.warn(`Rejecting unauthenticated chat socket ${client.id}`);
      client.emit('auth_error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }

    // Personal notification/chat alerts room — always own id only
    client.join(user.id);
    if (this.wsAuthService.isAdmin(user.role)) {
      client.join(ADMIN_CHAT_MONITOR_ROOM);
    }
    client.emit('authenticated', { userId: user.id });
    this.logger.log(`Chat client ${client.id} authenticated as ${user.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Chat client disconnected: ${client.id}`);
  }

  private requireUser(client: AuthedSocket): WsAuthedUser | null {
    return client.data?.user || null;
  }

  private async canAccessRoom(
    user: WsAuthedUser,
    roomId: string,
  ): Promise<boolean> {
    const room = await this.chatService.getRoomById(roomId);
    if (!room) return false;
    return this.chatService.canUserViewRoom(room, user.id, user.role);
  }

  private async canSendInRoom(
    user: WsAuthedUser,
    roomId: string,
  ): Promise<boolean> {
    const room = await this.chatService.getRoomById(roomId);
    if (!room) return false;
    return await this.chatService.canUserSendInRoom(room, user.id, user.role);
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    const user = this.requireUser(client);
    if (!user || !data?.roomId) {
      return { error: 'Unauthorized' };
    }

    const allowed = await this.canAccessRoom(user, data.roomId);
    if (!allowed) {
      return { error: 'Forbidden' };
    }

    client.join(data.roomId);
    const messages = await this.chatService.getMessages(data.roomId);
    client.emit('chat_history', messages);
    this.logger.log(`Client ${client.id} joined room ${data.roomId}`);
    return { ok: true };
  }

  @SubscribeMessage('join_user_room')
  async handleJoinUserRoom(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    const user = this.requireUser(client);
    if (!user || !data?.userId) {
      return { error: 'Unauthorized' };
    }

    // Prevent spoofing another user's personal room (admins use roomId joins).
    if (String(data.userId) !== user.id) {
      return { error: 'Forbidden' };
    }

    client.join(user.id);
    return { ok: true };
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody()
    data: {
      roomId: string;
      senderName?: string;
      senderType?: string;
      message: string;
    },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    const user = this.requireUser(client);
    if (!user || !data?.roomId || !data?.message?.trim()) {
      return { error: 'Unauthorized' };
    }

    const allowed = await this.canSendInRoom(user, data.roomId);
    if (!allowed) {
      return { error: 'Forbidden' };
    }

    // Never trust client-provided sender identity
    const senderType = this.wsAuthService.resolveSenderType(user.role);
    const senderName = this.wsAuthService.displayName(user);
    const messageText = data.message.trim();

    const savedMessage = await this.chatService.saveMessage(
      data.roomId,
      senderName,
      senderType,
      messageText,
    );

    this.server.to(data.roomId.toString()).emit('new_message', savedMessage);

    const room = await this.chatService.getRoomById(data.roomId);
    const peerId = room ? getOtherChatParticipantId(room, user.id) : null;

    this.server.to(ADMIN_CHAT_MONITOR_ROOM).emit('message_notification', {
      roomId: data.roomId.toString(),
      message: messageText,
      senderName,
    });

    if (peerId) {
      const shopId = room?.userId?.toString?.() || '';
      const peerIsShop = shopId === peerId;

      if (peerIsShop) {
        this.server.to(peerId).emit('new_admin_message', {
          roomId: data.roomId.toString(),
          message: messageText,
          senderName,
        });
      }

      const partnerNotif = await this.notificationsService.create({
        user: peerId,
        type: NotificationType.CHAT_MESSAGE,
        title: peerIsShop ? 'New message from Partner' : 'New message from Shop',
        message:
          peerIsShop
            ? messageText.substring(0, 50) +
              (messageText.length > 50 ? '...' : '')
            : `Shop "${senderName}" sent a message.`,
        metadata: {
          roomId: data.roomId.toString(),
          senderName,
        },
        link: `/live-chat?roomId=${data.roomId.toString()}`,
        triggeredBy: user.id,
      });
      this.notificationsGateway.broadcastNotification(partnerNotif);
    }

    // Admin monitoring record only — do not broadcast message content globally.
    if (senderType === 'user') {
      await this.notificationsService.createOrUpdateChatNotification({
        type: NotificationType.CHAT_MESSAGE,
        title: 'New Chat Message',
        message: `New message from ${senderName}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`,
        metadata: {
          roomId: data.roomId.toString(),
          senderName,
        },
        link: `/live-chat?roomId=${data.roomId.toString()}`,
        triggeredBy: user.id,
      });
    }

    return savedMessage;
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @MessageBody() data: { roomId: string; userName?: string },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    const user = this.requireUser(client);
    if (!user || !data?.roomId) return;
    if (this.wsAuthService.isAdmin(user.role)) return;

    const allowed = await this.canSendInRoom(user, data.roomId);
    if (!allowed) return;

    client.to(data.roomId).emit('user_typing', {
      userName: this.wsAuthService.displayName(user),
    });
  }
}
