import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmailSettings,
  EmailSettingsSchema,
} from './entities/email-settings.entity';
import { EmailSettingsService } from './email-settings.service';
import { EmailSettingsController } from './email-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailSettings.name, schema: EmailSettingsSchema },
    ]),
  ],
  controllers: [EmailSettingsController],
  providers: [EmailSettingsService],
  exports: [EmailSettingsService],
})
export class EmailSettingsModule {}
