import { forwardRef, Inject, Logger } from '@nestjs/common';
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
import { UsersService } from '../../users/users.service';
import { WsAuthService, WsAuthedUser } from '../../auth/ws-auth.service';
import { installWsAuthMiddleware } from '../../auth/install-ws-auth.middleware';

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
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
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
    const ownerId = room.userId?.toString?.();
    if (ownerId && ownerId === user.id) return true;
    return this.wsAuthService.canAccessOtherUserRooms(user.role);
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

    const allowed = await this.canAccessRoom(user, data.roomId);
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

    if (senderType === 'user') {
      const { notification } =
        await this.notificationsService.createOrUpdateChatNotification({
          type: NotificationType.CHAT_MESSAGE,
          title: 'New Chat Message',
          message: `New message from ${senderName}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`,
          metadata: {
            roomId: data.roomId.toString(),
            senderName,
          },
          link: `/live-chat?roomId=${data.roomId.toString()}`,
          triggeredBy: (
            await this.chatService.getRoomById(data.roomId)
          )?.userId?.toString(),
        });

      this.server.emit('message_notification', {
        roomId: data.roomId.toString(),
        message: messageText,
        senderName,
      });

      this.notificationsGateway.broadcastNotification(notification);

      try {
        const room = await this.chatService.getRoomById(data.roomId);
        if (room && room.userId) {
          const roomUser = await this.usersService.findOne(
            room.userId.toString(),
          );
          if (roomUser && roomUser.referredByPartnerCode) {
            const partner = await this.usersService.findByPartnerCode(
              roomUser.referredByPartnerCode,
            );
            if (
              partner &&
              partner._id.toString() !== room.userId.toString()
            ) {
              const partnerNotif = await this.notificationsService.create({
                user: partner._id.toString(),
                type: NotificationType.CHAT_MESSAGE,
                title: 'New message from Shop',
                message: `Shop "${senderName}" sent a message.`,
                metadata: {
                  roomId: data.roomId.toString(),
                  senderName,
                },
                link: `/live-chat?roomId=${data.roomId.toString()}`,
                triggeredBy: room.userId.toString(),
              });
              this.notificationsGateway.broadcastNotification(partnerNotif);
            }
          }
        }
      } catch (err) {
        this.logger.error('Failed to notify partner', err as any);
      }
    }

    if (senderType === 'admin') {
      const room = await this.chatService.getRoomById(data.roomId);
      if (room && room.userId) {
        const userId = room.userId.toString();

        this.server.to(userId).emit('new_admin_message', {
          roomId: data.roomId.toString(),
          message: messageText,
          senderName,
        });

        await this.notificationsService.create({
          user: userId,
          type: NotificationType.CHAT_MESSAGE,
          title: 'New message from Partner',
          message:
            messageText.substring(0, 50) +
            (messageText.length > 50 ? '...' : ''),
          metadata: {
            roomId: data.roomId.toString(),
            senderName,
          },
          link: `/live-chat?roomId=${data.roomId.toString()}`,
          triggeredBy: user.id,
        });
      }
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

    const allowed = await this.canAccessRoom(user, data.roomId);
    if (!allowed) return;

    client.to(data.roomId).emit('user_typing', {
      userName: this.wsAuthService.displayName(user),
    });
  }
}
