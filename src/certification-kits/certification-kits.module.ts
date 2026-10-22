import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CertificationKit,
  CertificationKitSchema,
} from './entities/certification-kit.entity';
import { CertificationKitsService } from './certification-kits.service';
import { CertificationKitBuilderService } from './certification-kit-builder.service';
import { CertificationKitsController } from './certification-kits.controller';
import { UsersModule } from '../users/users.module';
import { RegistrationFeesModule } from '../registration-fees/registration-fees.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CertificationKit.name, schema: CertificationKitSchema },
    ]),
    UsersModule,
    RegistrationFeesModule,
    ExchangeRatesModule,
    forwardRef(() => ProductsModule),
  ],
  controllers: [CertificationKitsController],
  providers: [CertificationKitsService, CertificationKitBuilderService],
  exports: [CertificationKitsService],
})
export class CertificationKitsModule {}
