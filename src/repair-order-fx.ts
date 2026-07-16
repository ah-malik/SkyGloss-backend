/**
 * Repair orders with missing/corrupt FX fields using the order receipt date rate.
 * Does NOT overwrite valid locked rates on existing orders.
 *
 * Run: npm run repair-order-fx
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  DEFAULT_EXCHANGE_RATES,
  normalizeCurrencyCode,
} from './common/currency-codes';
import { buildLockedMonetaryFields, roundExchangeRate } from './common/order-monetary';
import { fetchHistoricalRateToBase } from './common/historical-fx';

dotenv.config();

const MARKET_RATES_URL = 'https://api.frankfurter.app/latest?from=USD';

async function refreshRatesFromMarket(
  ratesCollection: mongoose.mongo.Collection,
): Promise<number> {
  const response = await fetch(MARKET_RATES_URL);
  if (!response.ok) {
    throw new Error(`Market FX fetch failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { rates?: Record<string, number> };
  const quotes = data.rates || {};
  let updated = 0;

  for (const [currency, unitsPerUsd] of Object.entries(quotes)) {
    if (!unitsPerUsd || unitsPerUsd <= 0) continue;

    const code = normalizeCurrencyCode(currency);
    if (code === 'USD') continue;

    const rateToBase = roundExchangeRate(1 / unitsPerUsd);
    await ratesCollection.updateOne(
      { currency: code },
      { $set: { currency: code, rateToBase } },
      { upsert: true },
    );
    updated += 1;
  }

  await ratesCollection.updateOne(
    { currency: 'USD' },
    { $set: { currency: 'USD', rateToBase: 1 } },
    { upsert: true },
  );

  return updated;
}

function isBrokenFxOrder(order: {
  exchangeRateAtOrderTime?: number;
  baseCurrencyAmount?: number;
  originalCurrency?: string;
  currency?: string;
}): boolean {
  const currency = normalizeCurrencyCode(order.originalCurrency || order.currency);
  if (currency === 'USD') return false;

  const lockedRate = order.exchangeRateAtOrderTime;
  return (
    !lockedRate ||
    lockedRate <= 0 ||
    lockedRate === 1 ||
    !order.baseCurrencyAmount ||
    order.baseCurrencyAmount <= 0
  );
}

async function bootstrap() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);

  const rates = mongoose.connection.collection('exchangerates');
  const orders = mongoose.connection.collection('orders');

  let seeded = 0;
  for (const [currency, rateToBase] of Object.entries(DEFAULT_EXCHANGE_RATES)) {
    const res = await rates.updateOne(
      { currency },
      { $setOnInsert: { currency, rateToBase } },
      { upsert: true },
    );
    if (res.upsertedCount) seeded += 1;
  }

  try {
    const marketUpdated = await refreshRatesFromMarket(rates);
    console.log(`Market FX refresh: ${marketUpdated} currency rate(s) updated.`);
  } catch (err) {
    console.warn('Market FX refresh failed; using database/default rates.', err);
  }

  const cursor = orders.find({
    totalAmount: { $gt: 0 },
    orderNumber: { $not: /^(SGREG|REG)/i },
  });

  let scanned = 0;
  let repaired = 0;

  for await (const order of cursor) {
    scanned += 1;
    if (!isBrokenFxOrder(order as Record<string, unknown>)) continue;

    const currency = normalizeCurrencyCode(
      order.originalCurrency || order.currency,
    );
    if (currency === 'USD') continue;

    const amount = order.originalAmount ?? order.totalAmount;
    if (!amount || amount <= 0) continue;

    const orderDate = order.createdAt ? new Date(order.createdAt) : new Date();
    let rate = await fetchHistoricalRateToBase(currency, orderDate);
    if (!rate || rate <= 0) {
      rate = DEFAULT_EXCHANGE_RATES[currency];
    }
    if (!rate || rate <= 0) continue;

    const fields = buildLockedMonetaryFields(amount, currency, rate);
    if (
      order.exchangeRateAtOrderTime === fields.exchangeRateAtOrderTime &&
      order.baseCurrencyAmount === fields.baseCurrencyAmount &&
      order.originalCurrency === fields.originalCurrency
    ) {
      continue;
    }

    await orders.updateOne({ _id: order._id }, { $set: fields });
    repaired += 1;
  }

  console.log(
    `FX repair complete: ${seeded} rate(s) seeded, ${scanned} orders scanned, ${repaired} repaired (order-date rates only).`,
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('FX repair failed:', err);
  process.exit(1);
});
