import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccessCodesService } from './access-codes.service';
import { AccessCodesController } from './access-codes.controller';
import { AccessCode, AccessCodeSchema } from './entities/access-code.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccessCode.name, schema: AccessCodeSchema },
    ]),
  ],
  controllers: [AccessCodesController],
  providers: [AccessCodesService],
  exports: [AccessCodesService],
})
export class AccessCodesModule {}
