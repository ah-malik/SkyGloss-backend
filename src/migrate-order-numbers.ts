/**
 * Migrate legacy shop order numbers to the current country+flow format
 * (SG{CCC}R#### for request / SG{CCC}P#### for purchase).
 *
 * Run: npm run migrate-order-numbers
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  buildMigratedShopOrderNumber,
  isMigratableShopOrderNumber,
  isRegistrationOrderNumber,
  type ShopOrderFlow,
} from './common/order-number';

dotenv.config();

async function bootstrap() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in environment');
  }

  await mongoose.connect(uri);

  const orders = mongoose.connection.collection('orders');

  const allOrders = await orders
    .find({}, { projection: { orderNumber: 1, orderFlow: 1 } })
    .toArray();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of allOrders) {
    scanned += 1;
    const current = String(order.orderNumber || '');

    if (isRegistrationOrderNumber(current)) {
      skipped += 1;
      continue;
    }

    if (!isMigratableShopOrderNumber(current)) {
      skipped += 1;
      continue;
    }

    const flow: ShopOrderFlow =
      order.orderFlow === 'purchase' ? 'purchase' : 'request';

    const nextNumber = buildMigratedShopOrderNumber(current, undefined, flow);
    if (!nextNumber || nextNumber === current) {
      skipped += 1;
      continue;
    }

    await orders.updateOne(
      { _id: order._id },
      { $set: { orderNumber: nextNumber } },
    );
    updated += 1;
  }

  console.log(
    `Order number migration complete: ${scanned} scanned, ${updated} updated, ${skipped} skipped.`,
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('Order number migration failed:', err);
  process.exit(1);
});
