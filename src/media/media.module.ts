import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BackblazeModule } from '../backblaze/backblaze.module';
import { MediaFile, MediaFileSchema } from './entities/media-file.entity';
import { MediaController } from './media.controller';
import { AssetFilesController } from './asset-files.controller';
import { MediaService } from './media.service';

@Module({
  imports: [
    BackblazeModule,
    MongooseModule.forFeature([
      { name: MediaFile.name, schema: MediaFileSchema },
    ]),
  ],
  controllers: [MediaController, AssetFilesController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
