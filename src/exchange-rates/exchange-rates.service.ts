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

const MARKET_RATES_URL = 'https://api.frankfurter.app/latest?from=USD';

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
    await this.refreshRatesFromMarket();
  }

  /**
   * Fetch latest USD-based FX quotes and store as rateToBase (1 unit → USD).
   * Frankfurter returns foreign units per 1 USD, so rateToBase = 1 / quote.
   */
  async refreshRatesFromMarket(): Promise<number> {
    try {
      const response = await fetch(MARKET_RATES_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        rates?: Record<string, number>;
      };
      const quotes = data.rates || {};
      let updated = 0;

      for (const [currency, unitsPerUsd] of Object.entries(quotes)) {
        if (!unitsPerUsd || unitsPerUsd <= 0) continue;

        const code = normalizeCurrencyCode(currency);
        if (code === SYSTEM_BASE_CURRENCY) continue;

        const rateToBase = roundExchangeRate(1 / unitsPerUsd);
        await this.exchangeRateModel.findOneAndUpdate(
          { currency: code },
          { currency: code, rateToBase },
          { upsert: true },
        );
        updated += 1;
      }

      await this.exchangeRateModel.findOneAndUpdate(
        { currency: SYSTEM_BASE_CURRENCY },
        { currency: SYSTEM_BASE_CURRENCY, rateToBase: 1 },
        { upsert: true },
      );

      this.logger.log(
        `Exchange rates refreshed from market (${updated} currencies updated)`,
      );
      return updated;
    } catch (err) {
      this.logger.warn(
        'Failed to refresh exchange rates from market; using database/default rates',
        err,
      );
      return 0;
    }
  }

  async getRatesMap(): Promise<Record<string, number>> {
    const rows = await this.exchangeRateModel.find().lean().exec();
    const map: Record<string, number> = { [SYSTEM_BASE_CURRENCY]: 1 };

    for (const row of rows) {
      if (row.currency && row.rateToBase > 0) {
        map[row.currency] = roundExchangeRate(row.rateToBase);
      }
    }

    for (const [currency, rateToBase] of Object.entries(DEFAULT_EXCHANGE_RATES)) {
      if (!map[currency] || map[currency] <= 0) {
        map[currency] = rateToBase;
      }
    }

    return map;
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
