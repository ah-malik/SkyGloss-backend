import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

function resolveNotificationUserId(user: unknown): string | undefined {
  if (!user) return undefined;
  if (typeof user === 'string') return user;
  if (typeof user === 'object' && user !== null) {
    const obj = user as { _id?: { toString?: () => string }; toString?: () => string };
    if (obj._id) return obj._id.toString?.() ?? String(obj._id);
    if (typeof obj.toString === 'function') return obj.toString();
  }
  return String(user);
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  afterInit(server: Server) {
    this.logger.log('NotificationsGateway initialized');
  }

  handleConnection(client: Socket) {
    const userId = client.handshake.query?.userId;
    if (typeof userId === 'string' && userId.trim()) {
      client.join(userId.trim());
      this.logger.log(`Client ${client.id} auto-joined notification room ${userId.trim()}`);
    }
    this.logger.log(`Client connected to notifications: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected from notifications: ${client.id}`);
  }

  @SubscribeMessage('join_user_room')
  handleJoinUserRoom(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.userId) return;
    const roomId = String(data.userId).trim();
    client.join(roomId);
    this.logger.log(`Client ${client.id} joined notification room ${roomId}`);
  }

  broadcastNotification(notification: any) {
    const recipientId = resolveNotificationUserId(notification.user);
    const type = String(notification?.type || '');
    const isTargetedOnly =
      type.startsWith('WITHDRAWAL_') || type.startsWith('COMMISSION_');

    this.logger.log(
      `Sending new_notification${recipientId ? ` to ${recipientId}` : ' (broadcast)'}: ${type}`,
    );
    if (!this.server) {
      this.logger.error(
        'CRITICAL: WebSocket server is NOT initialized in NotificationsGateway!',
      );
      return;
    }
    if (recipientId) {
      this.server.to(recipientId).emit('new_notification', notification);
    } else if (!isTargetedOnly) {
      // Legacy admin-wide notifications (e.g. NEW_USER)
      this.server.emit('new_notification', notification);
    } else {
      this.logger.warn(`Skipped broadcast for targeted notification without recipient: ${type}`);
    }
    this.logger.log('Emit call completed');
  }

  broadcastSupportMessage(ticketId: string, updatedTicket: any) {
    if (!this.server) return;
    this.logger.log(`Broadcasting support_message for ticket ${ticketId}`);
    this.server.emit('support_message', { ticketId, ticket: updatedTicket });
  }
}
