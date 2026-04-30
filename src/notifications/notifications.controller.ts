import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Delete,
  Req,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.notificationsService.findAllAdmin();
  }

  @Get('unread-count')
  @Roles(UserRole.ADMIN)
  getUnreadCount() {
    return this.notificationsService.getUnreadCount();
  }

  @Get('my-unread')
  getMyUnreadCount(@Req() req: any) {
    return this.notificationsService.getUnreadCountForUser(req.user.id);
  }

  @Get('my')
  getMyNotifications(@Req() req: any) {
    return this.notificationsService.findAllForUser(req.user.id);
  }

  @Patch('mark-my-chat-read')
  markMyChatRead(@Req() req: any) {
    return this.notificationsService.markChatNotificationsAsReadForUser(
      req.user.id,
    );
  }

  @Patch('mark-chat-read/:triggeredById')
  markChatReadByTriggeredBy(@Req() req: any, @Param('triggeredById') triggeredById: string) {
    return this.notificationsService.markChatNotificationsAsReadByTriggeredBy(
      req.user.id,
      triggeredById,
    );
  }

  @Patch('mark-all-my-read')
  markAllMyRead(@Req() req: any) {
    return this.notificationsService.markAllAsReadForUser(req.user.id);
  }

  @Patch(':id/read')


  @Roles(UserRole.ADMIN)
  markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  @Patch('read-all')
  @Roles(UserRole.ADMIN)
  markAllAsRead() {
    return this.notificationsService.markAllAsRead();
  }
}
