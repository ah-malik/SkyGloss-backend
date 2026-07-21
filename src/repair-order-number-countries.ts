/**
 * Re-stamp existing shop order numbers with the correct country code
 * (SG{CCC}R#### / SG{CCC}P####), keeping the same sequence.
 *
 * Country source: shippingAddress.country → user.country → GLB.
 * Registration IDs (SGREG*) are skipped.
 *
 * Dry run:  npm run repair-order-number-countries -- --dry-run
 * Apply:    npm run repair-order-number-countries
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  getShopOrderNumberRegex,
  isRegistrationOrderNumber,
  rebuildShopOrderNumberCountry,
  type ShopOrderFlow,
} from './common/order-number';

dotenv.config();

async function bootstrap() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in environment');
  }

  await mongoose.connect(uri);

  const orders = mongoose.connection.collection('orders');
  const users = mongoose.connection.collection('users');

  const shopOrders = await orders
    .find(
      {
        $or: [
          { orderNumber: { $regex: getShopOrderNumberRegex('request') } },
          { orderNumber: { $regex: getShopOrderNumberRegex('purchase') } },
        ],
      },
      {
        projection: {
          orderNumber: 1,
          orderFlow: 1,
          shippingAddress: 1,
          user: 1,
        },
      },
    )
    .toArray();

  const userIds = [
    ...new Set(
      shopOrders
        .map((order) => order.user)
        .filter(Boolean)
        .map((id) => String(id)),
    ),
  ];

  const userDocs = userIds.length
    ? await users
        .find(
          {
            _id: {
              $in: userIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
          },
          { projection: { country: 1 } },
        )
        .toArray()
    : [];

  const countryByUserId = new Map(
    userDocs.map((user) => [String(user._id), String(user.country || '')]),
  );

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const samples: string[] = [];

  for (const order of shopOrders) {
    scanned += 1;
    const current = String(order.orderNumber || '');

    if (isRegistrationOrderNumber(current)) {
      skipped += 1;
      continue;
    }

    const flow: ShopOrderFlow =
      order.orderFlow === 'purchase' ? 'purchase' : 'request';

    const shippingCountry = String(
      (order.shippingAddress as { country?: string } | undefined)?.country ||
        '',
    );
    const userCountry = order.user
      ? countryByUserId.get(String(order.user)) || ''
      : '';
    const country = shippingCountry || userCountry;

    const nextNumber = rebuildShopOrderNumberCountry(current, country, flow);
    if (!nextNumber) {
      skipped += 1;
      continue;
    }

    if (samples.length < 20) {
      samples.push(`${current} → ${nextNumber}`);
    }

    if (!dryRun) {
      await orders.updateOne(
        { _id: order._id },
        { $set: { orderNumber: nextNumber } },
      );
    }
    updated += 1;
  }

  console.log(
    `Order number country repair ${dryRun ? '(dry-run) ' : ''}complete: ${scanned} scanned, ${updated} ${dryRun ? 'would update' : 'updated'}, ${skipped} skipped.`,
  );
  if (samples.length) {
    console.log('Samples:');
    for (const line of samples) {
      console.log(`  ${line}`);
    }
  }

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('Order number country repair failed:', err);
  process.exit(1);
});
