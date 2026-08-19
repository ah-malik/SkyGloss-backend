import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChatImagesService } from './chat-images.service';

@Injectable()
export class ChatImagesScheduler {
  private readonly logger = new Logger(ChatImagesScheduler.name);

  constructor(private readonly chatImagesService: ChatImagesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleExpiredChatImages() {
    try {
      const deleted = await this.chatImagesService.purgeExpiredChatImages();
      if (deleted > 0) {
        this.logger.log(
          `Chat image cleanup removed ${deleted} Cloudinary file(s) older than 30 days`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        'Chat image cleanup job failed',
        error?.stack || error,
      );
    }
  }
}
