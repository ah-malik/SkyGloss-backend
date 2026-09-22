import { Module } from '@nestjs/common';
import { FedexService } from './fedex.service';

@Module({
  providers: [FedexService],
  exports: [FedexService],
})
export class FedexModule {}
