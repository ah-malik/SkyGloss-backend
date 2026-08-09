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
import { WsAuthService, WsAuthedUser } from '../auth/ws-auth.service';
import { installWsAuthMiddleware } from '../auth/install-ws-auth.middleware';

function resolveNotificationUserId(user: unknown): string | undefined {
  if (!user) return undefined;
  if (typeof user === 'string') return user;
  if (typeof user === 'object' && user !== null) {
    const obj = user as {
      _id?: { toString?: () => string };
      toString?: () => string;
    };
    if (obj._id) return obj._id.toString?.() ?? String(obj._id);
    if (typeof obj.toString === 'function') return obj.toString();
  }
  return String(user);
}

type AuthedSocket = Socket & { data: { user?: WsAuthedUser } };

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly wsAuthService: WsAuthService) {}

  afterInit(server: Server) {
    installWsAuthMiddleware(server, this.wsAuthService);
    this.logger.log('NotificationsGateway initialized');
  }

  async handleConnection(client: AuthedSocket) {
    const user = client.data?.user;
    if (!user) {
      this.logger.warn(
        `Rejecting unauthenticated notifications socket ${client.id}`,
      );
      client.emit('auth_error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }

    client.join(user.id);
    client.emit('authenticated', { userId: user.id });
    this.logger.log(
      `Notifications client ${client.id} authenticated as ${user.id}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected from notifications: ${client.id}`);
  }

  @SubscribeMessage('join_user_room')
  handleJoinUserRoom(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: AuthedSocket,
  ) {
    const user = client.data?.user;
    if (!user || !data?.userId) {
      return { error: 'Unauthorized' };
    }

    // Only allow joining your own notification room
    if (String(data.userId).trim() !== user.id) {
      return { error: 'Forbidden' };
    }

    client.join(user.id);
    this.logger.log(
      `Client ${client.id} joined notification room ${user.id}`,
    );
    return { ok: true };
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
      // Legacy admin-wide notifications (e.g. NEW_USER) — admins join their own rooms;
      // also emit globally for authenticated admin sockets listening.
      this.server.emit('new_notification', notification);
    } else {
      this.logger.warn(
        `Skipped broadcast for targeted notification without recipient: ${type}`,
      );
    }
    this.logger.log('Emit call completed');
  }

  broadcastSupportMessage(ticketId: string, updatedTicket: any) {
    if (!this.server) return;
    this.logger.log(`Broadcasting support_message for ticket ${ticketId}`);
    this.server.emit('support_message', { ticketId, ticket: updatedTicket });
  }
}
