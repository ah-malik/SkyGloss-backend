/**
 * Split legacy registration orders whose fee line was stored tax-inclusive
 * (e.g. €302.50 = €250 fee + 21% VAT) into fee + discount + VAT.
 * totalAmount and FX fields are never changed — only the breakdown.
 * Orders already stored as fee-only are skipped, so the script is safe to re-run.
 *
 * Dry run:  npm run repair-registration-order-vat -- --dry-run
 * Apply:    npm run repair-registration-order-vat
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import { countriesMatch } from './common/country-match';
import {
  buildRegistrationFeeQuote,
  calculateRegistrationTotals,
  splitPaidRegistrationAmount,
} from './common/registration-pricing';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');

type FeeGroup = {
  countries?: string[];
  feeAmount?: number;
  taxAmount?: number;
  currency?: string;
  isDefault?: boolean;
};

function findFeeGroup(groups: FeeGroup[], country: string): FeeGroup | null {
  const match = groups.find((g) =>
    (g.countries || []).some((listed) => countriesMatch(listed, country)),
  );
  return match || groups.find((g) => g.isDefault) || null;
}

async function bootstrap() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);

  const feeGroups = (await mongoose.connection
    .collection('registrationfeegroups')
    .find({ isActive: true })
    .toArray()) as FeeGroup[];
  const orders = mongoose.connection.collection('orders');

  const cursor = orders.find({
    $or: [
      { items: { $elemMatch: { product: 'registration_fee' } } },
      { orderNumber: { $regex: '^SGREG\\d+$', $options: 'i' } },
      { orderNumber: { $regex: '^REG\\d+$', $options: 'i' } },
    ],
  });

  let scanned = 0;
  let repaired = 0;
  let skippedMismatch = 0;

  for await (const order of cursor) {
    scanned += 1;
    const items: Array<{ product?: string; price?: number }> = Array.isArray(
      order.items,
    )
      ? (order.items as Array<{ product?: string; price?: number }>)
      : [];
    const itemIndex = items.findIndex(
      (item) => item?.product === 'registration_fee',
    );
    if (itemIndex < 0 || items.length !== 1) continue;

    const shippingAddress = order.shippingAddress as
      | { country?: string }
      | undefined;
    const country = String(shippingAddress?.country || '');
    const quote = buildRegistrationFeeQuote(
      findFeeGroup(feeGroups, country),
      country,
    );
    const undiscounted = calculateRegistrationTotals(quote);
    if (undiscounted.taxAmount <= 0) continue;

    const storedPrice = Number(items[itemIndex].price) || 0;
    if (Math.abs(storedPrice - quote.feeAmount) < 0.01) continue;
    if (Math.abs(storedPrice - undiscounted.total) >= 0.01) {
      skippedMismatch += 1;
      console.warn(
        `Skip ${order.orderNumber}: stored price ${storedPrice} does not match fee ${quote.feeAmount} + tax ${undiscounted.taxAmount} for "${country}"`,
      );
      continue;
    }

    const totals = splitPaidRegistrationAmount(
      quote,
      Number(order.totalAmount) || 0,
    );
    const vatRate =
      totals.taxAmount > 0 && quote.vatRate != null ? quote.vatRate : 0;
    const update = {
      [`items.${itemIndex}.price`]: totals.feeAmount,
      discount: totals.discount,
      vatAmount: totals.taxAmount,
      vatRate,
    };

    console.log(
      `${DRY_RUN ? '[dry-run] ' : ''}${order.orderNumber}: price ${storedPrice} -> ${totals.feeAmount}, discount ${order.discount || 0} -> ${totals.discount}, VAT ${order.vatAmount || 0} -> ${totals.taxAmount} (${vatRate}%), total ${order.totalAmount} (unchanged)`,
    );

    if (!DRY_RUN) {
      await orders.updateOne({ _id: order._id }, { $set: update });
    }
    repaired += 1;
  }

  console.log(
    `Registration VAT repair ${DRY_RUN ? '(dry run) ' : ''}complete: ${scanned} scanned, ${repaired} ${DRY_RUN ? 'would be ' : ''}repaired, ${skippedMismatch} skipped (fee mismatch).`,
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('Registration VAT repair failed:', err);
  process.exit(1);
});
