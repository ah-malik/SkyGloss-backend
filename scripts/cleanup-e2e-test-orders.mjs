/**
 * Cleanup accidental E2E test orders on a real shop + cancel their commissions.
 * Usage: node scripts/cleanup-e2e-test-orders.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const ORDER_IDS = [
  '6ae1236aef4320fd0b4611fb', // SGIRL0551
  '6ae1236cef4320fd0b461279', // SGIRL0558
  '6ae1236eef4320fd0b4612f7', // SGIRL0565
];

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI missing');
  }
  await mongoose.connect(process.env.MONGO_URI);
  const ids = ORDER_IDS.map((id) => new mongoose.Types.ObjectId(id));

  const orders = mongoose.connection.collection('orders');
  const commissions = mongoose.connection.collection('commissionrecords');

  const orderDocs = await orders
    .find({ _id: { $in: ids } })
    .project({ orderNumber: 1, status: 1, deletedAt: 1, user: 1 })
    .toArray();
  console.log(
    'Orders:',
    orderDocs.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      deletedAt: o.deletedAt || null,
    })),
  );

  // Ensure soft-deleted
  const soft = await orders.updateMany(
    { _id: { $in: ids }, deletedAt: { $exists: false } },
    {
      $set: {
        deletedAt: new Date(),
        purgeAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      },
    },
  );
  console.log('Soft-deleted remaining:', soft.modifiedCount);

  const before = await commissions.find({ orderId: { $in: ids } }).toArray();
  console.log(
    'Commission records before:',
    before.map((r) => ({
      orderNumber: r.orderNumber,
      status: r.status,
      type: r.earningType,
      amount: r.amount,
      partner: r.recipientPartnerCode,
    })),
  );

  const cancelled = await commissions.updateMany(
    { orderId: { $in: ids }, status: { $ne: 'cancelled' } },
    { $set: { status: 'cancelled' } },
  );
  console.log('Commissions cancelled:', cancelled.modifiedCount);

  const after = await commissions.find({ orderId: { $in: ids } }).toArray();
  console.log(
    'Commission records after:',
    after.map((r) => ({
      orderNumber: r.orderNumber,
      status: r.status,
      type: r.earningType,
    })),
  );

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
