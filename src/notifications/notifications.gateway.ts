import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

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
    this.logger.log(`Client connected to notifications: ${client.id}`);
    this.logger.log(
      `Handshake details: ${JSON.stringify({
        query: client.handshake.query,
        auth: client.handshake.auth,
        address: client.handshake.address,
      })}`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected from notifications: ${client.id}`);
  }

  broadcastNotification(notification: any) {
    this.logger.log(
      `Broadcasting new_notification: ${JSON.stringify(notification)}`,
    );
    if (!this.server) {
      this.logger.error(
        'CRITICAL: WebSocket server is NOT initialized in NotificationsGateway!',
      );
      return;
    }
    this.server.emit('new_notification', notification);
    this.logger.log('Emit call completed');
  }

  broadcastSupportMessage(ticketId: string, updatedTicket: any) {
    if (!this.server) return;
    this.logger.log(`Broadcasting support_message for ticket ${ticketId}`);
    this.server.emit('support_message', { ticketId, ticket: updatedTicket });
  }
}
