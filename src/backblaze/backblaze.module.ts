import { Module } from '@nestjs/common';
import { BackblazeController } from './backblaze.controller';
import { BackblazeService } from './backblaze.service';

@Module({
  controllers: [BackblazeController],
  providers: [BackblazeService],
  exports: [BackblazeService],
})
export class BackblazeModule {}
