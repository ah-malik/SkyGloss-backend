import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { UserRole } from '../users/entities/user.entity';
import { MediaService } from './media.service';
import {
  CompleteUploadDto,
  CreateUploadDto,
  FinishLargeUploadDto,
  ListMediaQueryDto,
} from './dto/media.dto';

/**
 * Admin media library backed by Backblaze B2.
 * Files go straight from the browser to B2 using short-lived upload tokens
 * issued here, so the API server never buffers large uploads.
 */
@Controller('media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  list(@Query() query: ListMediaQueryDto) {
    return this.mediaService.list(query);
  }

  @Get('stats')
  getStats() {
    return this.mediaService.getStats();
  }

  @Post('uploads')
  createUpload(@Body() dto: CreateUploadDto) {
    return this.mediaService.createUpload(dto);
  }

  @Post('uploads/:fileId/part-url')
  getUploadPartUrl(@Param('fileId') fileId: string) {
    return this.mediaService.getUploadPartUrl(fileId);
  }

  @Post('uploads/:fileId/finish')
  finishLargeUpload(
    @Param('fileId') fileId: string,
    @Body() dto: FinishLargeUploadDto,
  ) {
    return this.mediaService.finishLargeUpload(fileId, dto.partSha1Array);
  }

  @Delete('uploads/:fileId')
  cancelLargeUpload(@Param('fileId') fileId: string) {
    return this.mediaService.cancelLargeUpload(fileId);
  }

  @Post()
  completeUpload(
    @Body() dto: CompleteUploadDto,
    @GetUser('_id') userId: string,
  ) {
    return this.mediaService.completeUpload(
      dto,
      userId ? String(userId) : undefined,
    );
  }

  @Post('sync')
  syncFromBucket(@GetUser('_id') userId: string) {
    return this.mediaService.syncFromBucket(
      userId ? String(userId) : undefined,
    );
  }

  @Get(':id/share-url')
  getShareUrl(@Param('id') id: string) {
    return this.mediaService.getShareUrl(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mediaService.remove(id);
  }
}
