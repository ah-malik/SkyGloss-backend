/**
 * Seed missing FX rates and repair non-USD orders that were converted at 1:1.
 *
 * Run: npm run repair-order-fx
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  DEFAULT_EXCHANGE_RATES,
  normalizeCurrencyCode,
} from './common/currency-codes';
import { buildLockedMonetaryFields } from './common/order-monetary';

dotenv.config();

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

  const allRates = await rates.find({}).toArray();
  const rateMap = new Map(allRates.map((r) => [r.currency, r.rateToBase]));

  const cursor = orders.find({
    totalAmount: { $gt: 0 },
    orderNumber: { $not: /^REG/i },
  });

  let scanned = 0;
  let repaired = 0;

  for await (const order of cursor) {
    scanned += 1;
    const currency = normalizeCurrencyCode(
      order.originalCurrency || order.currency,
    );
    if (currency === 'USD') continue;

    const amount = order.originalAmount ?? order.totalAmount;
    if (!amount || amount <= 0) continue;

    let rate = rateMap.get(currency);
    if (!rate || rate <= 0) {
      rate = DEFAULT_EXCHANGE_RATES[currency];
    }
    if (!rate || rate <= 0) continue;

    const fields = buildLockedMonetaryFields(amount, currency, rate);
    const needsRepair =
      order.exchangeRateAtOrderTime !== fields.exchangeRateAtOrderTime ||
      order.baseCurrencyAmount !== fields.baseCurrencyAmount ||
      order.originalCurrency !== fields.originalCurrency;

    if (!needsRepair) continue;

    await orders.updateOne({ _id: order._id }, { $set: fields });
    repaired += 1;
  }

  console.log(
    `FX repair complete: ${seeded} rate(s) seeded, ${scanned} orders scanned, ${repaired} repaired.`,
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('FX repair failed:', err);
  process.exit(1);
});
