import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Request,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ChatImageMulterFilter } from './chat-image-upload.filter';
import {
  CHAT_IMAGE_MAX_BYTES,
  isAllowedChatImageFile,
} from './chat-image.constants';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly cloudinaryService: CloudinaryService,
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

  @Post('room/:id/image')
  @UseFilters(ChatImageMulterFilter)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: CHAT_IMAGE_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!isAllowedChatImageFile(file)) {
          return cb(
            new BadRequestException(
              'Only PNG, JPG, and WEBP images up to 4 MB are allowed.',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadRoomImage(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const room = await this.assertCanAccessRoom(req, id);
    const userId = this.currentUserId(req);
    const canSend = await this.chatService.canUserSendInRoom(
      room,
      userId,
      req.user?.role,
    );
    if (!canSend) {
      throw new ForbiddenException('You cannot send images in this chat room');
    }

    if (!file) {
      throw new BadRequestException(
        'Please choose a PNG, JPG, or WEBP image up to 4 MB.',
      );
    }

    if (!isAllowedChatImageFile(file)) {
      throw new BadRequestException(
        'Only PNG, JPG, and WEBP images up to 4 MB are allowed.',
      );
    }

    if (file.size > CHAT_IMAGE_MAX_BYTES) {
      throw new BadRequestException('Image must be 4 MB or smaller.');
    }

    let result;
    try {
      result = await this.cloudinaryService.uploadChatImage(file);
    } catch {
      throw new BadRequestException('Image upload failed. Please try again.');
    }
    if (!result || !('secure_url' in result) || !result.secure_url) {
      throw new BadRequestException('Image upload failed. Please try again.');
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  }

  @Post('room/:id/close')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async closeRoom(@Param('id') id: string) {
    return this.chatService.closeRoom(id);
  }
}
