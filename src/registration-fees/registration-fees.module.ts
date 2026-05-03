import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RegistrationFeesService } from './registration-fees.service';
import { RegistrationFeesController } from './registration-fees.controller';
import { RegistrationFeeGroup, RegistrationFeeGroupSchema } from './entities/registration-fee-group.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RegistrationFeeGroup.name, schema: RegistrationFeeGroupSchema },
    ]),
  ],
  controllers: [RegistrationFeesController],
  providers: [RegistrationFeesService],
  exports: [RegistrationFeesService],
})
export class RegistrationFeesModule {}
