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

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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
    if (!this.chatService.canUserViewRoom(room, userId, role)) {
      throw new ForbiddenException('You do not have access to this chat room');
    }
    return room;
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
    const requestedUserId = body.userId?.toString?.() || actorId;
    return this.chatService.openDirectRoom(req.user, requestedUserId);
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
