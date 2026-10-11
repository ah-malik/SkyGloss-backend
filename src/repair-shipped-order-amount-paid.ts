/**
 * Backfill amountPaid on SHIPPED / DELIVERED orders so admin badge logic can
 * show Paid+Shipped for orders that were paid before ship, and Shipped-only
 * for proven direct ships.
 *
 * Sources (in order):
 * 1. paidConfirmationEmailSentAt / inventoryDeductedAt → was paid
 * 2. order_activity_logs with a PAID transition → was paid
 * 3. activity shows ship from PENDING/PENDING_PAYMENT with no PAID ever → leave 0
 * 4. no activity / unknown → set amountPaid = totalAmount (legacy default;
 *    disable with --strict)
 *
 * Dry run:  npm run repair-shipped-order-amount-paid -- --dry-run
 * Apply:    npm run repair-shipped-order-amount-paid
 * Strict:   npm run repair-shipped-order-amount-paid -- --strict
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const STRICT = process.argv.includes('--strict');

async function bootstrap() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);

  const orders = mongoose.connection.collection('orders');
  const activity = mongoose.connection.collection('order_activity_logs');

  const cursor = orders.find({
    status: { $in: ['SHIPPED', 'DELIVERED'] },
    $or: [
      { amountPaid: { $exists: false } },
      { amountPaid: null },
      { amountPaid: 0 },
      { amountPaid: { $lte: 0.01 } },
    ],
  });

  let scanned = 0;
  let backfilled = 0;
  let leftDirect = 0;
  let skippedUnknown = 0;

  while (await cursor.hasNext()) {
    const order = await cursor.next();
    if (!order) continue;
    scanned += 1;

    const total = Number(order.totalAmount) || 0;
    const orderId = order._id;

    const logs = await activity
      .find({ orderId })
      .project({ previousStatus: 1, newStatus: 1 })
      .toArray();

    const statuses = logs.flatMap((entry) => [
      String(entry.previousStatus || '').toUpperCase(),
      String(entry.newStatus || '').toUpperCase(),
    ]);
    const everPaid = statuses.includes('PAID');
    const shippedFromPending = logs.some((entry) => {
      const prev = String(entry.previousStatus || '').toUpperCase();
      const next = String(entry.newStatus || '').toUpperCase();
      return (
        next === 'SHIPPED' &&
        (prev === 'PENDING' || prev === 'PENDING_PAYMENT')
      );
    });

    const hasPaidEvidence =
      !!order.paidConfirmationEmailSentAt ||
      !!order.inventoryDeductedAt ||
      everPaid;

    let nextAmountPaid: number | null = null;
    let reason = '';

    if (hasPaidEvidence) {
      nextAmountPaid = total;
      reason = everPaid
        ? 'activity PAID'
        : order.inventoryDeductedAt
          ? 'inventoryDeductedAt'
          : 'paidConfirmationEmailSentAt';
    } else if (shippedFromPending && logs.length > 0 && !everPaid) {
      leftDirect += 1;
      continue;
    } else if (!STRICT) {
      // Legacy rows with no activity: historically treated as paid once shipped.
      nextAmountPaid = total;
      reason = 'legacy assume-paid';
    } else {
      skippedUnknown += 1;
      continue;
    }

    if (nextAmountPaid == null) continue;

    backfilled += 1;
    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}#${order.orderNumber || orderId} → amountPaid=${nextAmountPaid} (${reason})`,
    );

    if (!DRY_RUN) {
      await orders.updateOne(
        { _id: orderId },
        { $set: { amountPaid: nextAmountPaid } },
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        strict: STRICT,
        scanned,
        backfilled,
        leftDirect,
        skippedUnknown,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
