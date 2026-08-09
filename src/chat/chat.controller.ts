import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { WsAuthService } from '../auth/ws-auth.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly wsAuthService: WsAuthService,
  ) {}

  private currentUserId(req: any): string {
    return (
      req.user?._id?.toString?.() ||
      req.user?.id ||
      ''
    );
  }

  private async assertCanAccessRoom(req: any, roomId: string) {
    const room = await this.chatService.getRoomById(roomId);
    if (!room) {
      throw new ForbiddenException('Chat room not found');
    }

    const userId = this.currentUserId(req);
    const role = req.user?.role;
    const roomOwnerId = room.userId?.toString?.();

    if (roomOwnerId && roomOwnerId === userId) {
      return room;
    }
    if (this.wsAuthService.canAccessOtherUserRooms(role)) {
      return room;
    }
    throw new ForbiddenException('You do not have access to this chat room');
  }

  @Post('room')
  async createRoom(
    @Request() req: any,
    @Body()
    body: {
      userId?: string;
      userName?: string;
      userEmail?: string;
      userType?: string;
    },
  ) {
    const actorId = this.currentUserId(req);
    const role = req.user?.role;
    const requestedUserId = body.userId?.toString?.() || actorId;

    // Partners/admins may open a room for a shop; everyone else only for themselves.
    if (
      requestedUserId !== actorId &&
      !this.wsAuthService.canAccessOtherUserRooms(role)
    ) {
      throw new ForbiddenException('Cannot create a chat room for another user');
    }

    const isOwnRoom = requestedUserId === actorId;
    return this.chatService.createOrGetRoom({
      userId: requestedUserId,
      userName: isOwnRoom
        ? this.wsAuthService.displayName(this.wsAuthService.toWsUser(req.user))
        : body.userName || 'User',
      userEmail: isOwnRoom
        ? req.user?.email || body.userEmail || ''
        : body.userEmail || '',
      userType: isOwnRoom ? role : body.userType || 'certified_shop',
    });
  }

  @Get('rooms')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllRooms() {
    return this.chatService.getAllRooms();
  }

  @Get('room/:id')
  async getRoom(@Request() req: any, @Param('id') id: string) {
    return this.assertCanAccessRoom(req, id);
  }

  @Get('room/:id/messages')
  async getRoomMessages(@Request() req: any, @Param('id') id: string) {
    await this.assertCanAccessRoom(req, id);
    return this.chatService.getMessages(id);
  }

  @Post('room/:id/close')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async closeRoom(@Param('id') id: string) {
    return this.chatService.closeRoom(id);
  }
}
