import { Module } from '@nestjs/common';
import { BackblazeService } from './backblaze.service';

@Module({
  providers: [BackblazeService],
  exports: [BackblazeService],
})
export class BackblazeModule {}
