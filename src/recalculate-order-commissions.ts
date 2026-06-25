/**
 * Recalculate commission amounts/percentages on existing shop orders
 * using each user's custom rate when set, otherwise role defaults
 * (Rep 20%, Promoter 10%, Sub-Promoter 5%).
 *
 * Run: npm run recalculate-order-commissions
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  calculateCommissionEntries,
  resolveCommissionOrderAmounts,
  resolveShopCommissionChain,
} from './common/commission-distribution';

dotenv.config();

type CommissionStatus = 'pending' | 'earned';

function defaultCommissionStatus(orderStatus?: string): CommissionStatus {
  const status = (orderStatus || '').toUpperCase();
  return status === 'SHIPPED' || status === 'DELIVERED' ? 'earned' : 'pending';
}

async function bootstrap() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in environment');
  }

  await mongoose.connect(uri);

  const orders = mongoose.connection.collection('orders');
  const users = mongoose.connection.collection('users');

  const lookup = async (partnerCode: string) => {
    const code = partnerCode?.trim();
    if (!code) return null;
    const user = await users.findOne({ partnerCode: code });
    if (!user) return null;
    return {
      _id: user._id,
      partnerCode: user.partnerCode as string | undefined,
      role: user.role as string,
      referredByPartnerCode: user.referredByPartnerCode as string | undefined,
      customCommissionRate: user.customCommissionRate as number | undefined,
    };
  };

  const cursor = orders.find({
    commissions: { $exists: true, $not: { $size: 0 } },
  });

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  for await (const order of cursor) {
    processed += 1;

    const shopUser = await users.findOne({
      _id: order.user,
      role: 'certified_shop',
    });

    if (!shopUser) {
      skipped += 1;
      continue;
    }

    const chain = await resolveShopCommissionChain(
      {
        referredByPartnerCode: shopUser.referredByPartnerCode as string | undefined,
      },
      lookup,
    );

    const { orderAmount, exchangeRateToUsd } = resolveCommissionOrderAmounts({
      totalAmount: order.totalAmount,
      originalAmount: order.originalAmount,
      originalCurrency: order.originalCurrency,
      currency: order.currency,
      exchangeRateAtOrderTime: order.exchangeRateAtOrderTime,
      baseCurrencyAmount: order.baseCurrencyAmount,
    });

    const newEntries = calculateCommissionEntries(
      orderAmount,
      chain,
      exchangeRateToUsd,
    );

    const existingCommissions = (order.commissions || []) as Array<{
      recipientPartnerCode?: string;
      status?: CommissionStatus;
    }>;
    const statusByCode = new Map<string, CommissionStatus>();
    for (const entry of existingCommissions) {
      const code = entry.recipientPartnerCode?.trim();
      if (code && entry.status) {
        statusByCode.set(code, entry.status);
      }
    }

    const fallbackStatus = defaultCommissionStatus(order.status as string | undefined);
    const nextCommissions = newEntries.map((entry) => ({
      ...entry,
      status: statusByCode.get(entry.recipientPartnerCode) ?? fallbackStatus,
    }));

    const changed =
      JSON.stringify(existingCommissions) !== JSON.stringify(nextCommissions);

    if (changed) {
      await orders.updateOne(
        { _id: order._id },
        { $set: { commissions: nextCommissions } },
      );
      updated += 1;
    }
  }

  console.log(
    `Commission recalculation complete: ${processed} order(s) scanned, ${updated} updated, ${skipped} skipped (non-shop placer).`,
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('Commission recalculation failed:', err);
  process.exit(1);
});
