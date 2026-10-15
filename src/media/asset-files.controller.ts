import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MediaService } from './media.service';

/** Portal (any signed-in user): download/preview URLs for files linked to the Assets library. */
@Controller('asset-files')
@UseGuards(JwtAuthGuard)
export class AssetFilesController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  getAssetFiles() {
    return this.mediaService.getAssetFiles();
  }
}
