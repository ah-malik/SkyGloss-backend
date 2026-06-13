import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './entities/exchange-rate.entity';
import { ExchangeRatesService } from './exchange-rates.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  providers: [ExchangeRatesService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
