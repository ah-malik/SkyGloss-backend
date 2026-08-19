import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat/chat.gateway';
import { ChatRoom, ChatRoomSchema } from './entities/chat-room.entity';
import { ChatMessage, ChatMessageSchema } from './entities/chat-message.entity';
import { UsersModule } from '../users/users.module';
import { WsAuthModule } from '../auth/ws-auth.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { ChatImagesService } from './chat-images.service';
import { ChatImagesScheduler } from './chat-images.scheduler';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => WsAuthModule),
    CloudinaryModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ChatImagesService, ChatImagesScheduler],
  exports: [ChatService],
})
export class ChatModule {}
