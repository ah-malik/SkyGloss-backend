import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ExchangeRate,
  ExchangeRateDocument,
} from './entities/exchange-rate.entity';
import {
  SYSTEM_BASE_CURRENCY,
  roundExchangeRate,
} from '../common/order-monetary';
import {
  DEFAULT_EXCHANGE_RATES,
  normalizeCurrencyCode,
} from '../common/currency-codes';

/** @deprecated import DEFAULT_EXCHANGE_RATES from currency-codes */
export { DEFAULT_EXCHANGE_RATES };

@Injectable()
export class ExchangeRatesService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly exchangeRateModel: Model<ExchangeRateDocument>,
  ) {}

  async onModuleInit() {
    for (const [currency, rateToBase] of Object.entries(DEFAULT_EXCHANGE_RATES)) {
      const existing = await this.exchangeRateModel.findOne({ currency }).exec();
      if (!existing) {
        await this.exchangeRateModel.create({ currency, rateToBase });
        this.logger.log(`Seeded exchange rate ${currency} → ${SYSTEM_BASE_CURRENCY} @ ${rateToBase}`);
      }
    }
    await this.ensureRatePrecision();
  }

  async getRateToBase(currency: string): Promise<number> {
    const code = normalizeCurrencyCode(currency);
    if (code === SYSTEM_BASE_CURRENCY) return 1;

    const row = await this.exchangeRateModel.findOne({ currency: code }).exec();
    let rate = row?.rateToBase ?? DEFAULT_EXCHANGE_RATES[code];

    if (!rate || rate <= 0) {
      this.logger.error(
        `Exchange rate not configured for ${code}; refusing USD 1:1 fallback`,
      );
      throw new Error(
        `Exchange rate is not configured for ${code}. Please add it in admin exchange rates.`,
      );
    }

    // Detect inverted storage (e.g. 280 PKR/USD stored instead of 0.00357)
    if (rate >= 10 && DEFAULT_EXCHANGE_RATES[code] && DEFAULT_EXCHANGE_RATES[code] < 1) {
      this.logger.warn(
        `Rate for ${code} looks inverted (${rate}); using 1/${rate}`,
      );
      rate = 1 / rate;
    }

    return roundExchangeRate(rate);
  }

  /** Fix seeded PKR rate that was stored before precision fix (0.0036 is ok, 0 is not). */
  async ensureRatePrecision(): Promise<void> {
    for (const [currency, expectedDefault] of Object.entries(
      DEFAULT_EXCHANGE_RATES,
    )) {
      const row = await this.exchangeRateModel.findOne({ currency }).exec();
      if (!row) continue;
      const normalized = roundExchangeRate(row.rateToBase);
      if (
        normalized !== row.rateToBase ||
        (currency === 'PKR' && row.rateToBase >= 10)
      ) {
        const fixed =
          row.rateToBase >= 10 && expectedDefault < 1
            ? roundExchangeRate(1 / row.rateToBase)
            : normalized || expectedDefault;
        await this.exchangeRateModel.updateOne(
          { currency },
          { $set: { rateToBase: fixed } },
        );
        this.logger.log(`Normalized exchange rate ${currency} → ${fixed}`);
      }
    }
  }

  async getAllRates(): Promise<ExchangeRateDocument[]> {
    return this.exchangeRateModel.find().sort({ currency: 1 }).exec();
  }

  async updateRate(currency: string, rateToBase: number): Promise<ExchangeRateDocument> {
    const code = currency.toUpperCase();
    if (rateToBase <= 0) {
      throw new Error('Exchange rate must be greater than zero');
    }
    return this.exchangeRateModel
      .findOneAndUpdate(
        { currency: code },
        { currency: code, rateToBase },
        { upsert: true, new: true },
      )
      .exec();
  }
}
