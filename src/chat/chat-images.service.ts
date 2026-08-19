import { Injectable, Logger } from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  CHAT_IMAGE_RETENTION_DAYS,
} from './chat-image.constants';

@Injectable()
export class ChatImagesService {
  private readonly logger = new Logger(ChatImagesService.name);

  constructor(private readonly cloudinaryService: CloudinaryService) {}

  async purgeExpiredChatImages(): Promise<number> {
    const cutoff = Date.now() - CHAT_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let nextCursor: string | undefined;
    let scannedPages = 0;
    const maxPages = 50;
    const expiredIds: string[] = [];

    do {
      let page: any;
      try {
        page = await this.cloudinaryService.listChatImages({
          maxResults: 100,
          nextCursor,
        });
      } catch (error: any) {
        const status = error?.http_code || error?.error?.http_code;
        if (status === 404) {
          this.logger.log('No Cloudinary chat images found to clean up');
          break;
        }
        throw error;
      }

      const resources = page?.resources || [];
      if (!resources.length) break;

      for (const resource of resources) {
        const createdAt = new Date(resource.created_at).getTime();
        if (
          !Number.isNaN(createdAt) &&
          createdAt <= cutoff &&
          resource.public_id
        ) {
          expiredIds.push(resource.public_id);
        }
      }

      scannedPages += 1;
      nextCursor = page.next_cursor;
    } while (nextCursor && scannedPages < maxPages);

    let deleted = 0;
    for (let i = 0; i < expiredIds.length; i += 100) {
      const batch = expiredIds.slice(i, i + 100);
      await this.cloudinaryService.deleteFiles(batch);
      deleted += batch.length;
    }

    if (deleted > 0) {
      this.logger.log(
        `Deleted ${deleted} expired chat image(s) from Cloudinary`,
      );
    }

    return deleted;
  }
}
