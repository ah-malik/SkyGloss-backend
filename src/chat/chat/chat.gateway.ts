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

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.roomId);

    // Send chat history to the client
    const messages = await this.chatService.getMessages(data.roomId);
    client.emit('chat_history', messages);

    console.log(`Client ${client.id} joined room ${data.roomId}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody()
    data: {
      roomId: string;
      senderName: string;
      senderType: string;
      message: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    // Save message to database
    const savedMessage = await this.chatService.saveMessage(
      data.roomId,
      data.senderName,
      data.senderType,
      data.message,
    );

    // Broadcast message to all clients in the room
    this.server.to(data.roomId).emit('new_message', savedMessage);

    // Notify admin panel about new message, ONLY if sender is user
    if (data.senderType === 'user') {
      const { notification, isNew } =
        await this.notificationsService.createOrUpdateChatNotification({
          type: NotificationType.CHAT_MESSAGE,
          title: 'New Chat Message',
          message: `New message from ${data.senderName}: ${data.message.substring(0, 50)}${data.message.length > 50 ? '...' : ''}`,
          metadata: { roomId: data.roomId, senderName: data.senderName },
          link: `/live-chat?roomId=${data.roomId}`,
        });

      this.server.emit('message_notification', {
        roomId: data.roomId,
        message: data.message,
        senderName: data.senderName,
      });

      // Also emit to the notifications namespace if it's a new notification, OR an update one
      this.notificationsGateway.broadcastNotification(notification);
    }

    return savedMessage;
  }

  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { roomId: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Broadcast typing indicator to room except sender
    client.to(data.roomId).emit('user_typing', { userName: data.userName });
  }
}
