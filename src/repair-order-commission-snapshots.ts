/**
 * Restore order.commissions recipients from the oldest CommissionRecord snapshot
 * when Admin OSP/SI changes wrongly rewrote past orders.
 *
 * Usage:
 *   npx ts-node -r dotenv/config src/repair-order-commission-snapshots.ts SGALB0341
 *   npx ts-node -r dotenv/config src/repair-order-commission-snapshots.ts SGALB0341 SGALB0342
 */
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from './app.module';
import { Order } from './orders/entities/order.entity';
import {
  CommissionRecord,
  CommissionLifecycleStatus,
} from './payouts/entities/commission-record.entity';
import { normalizePartnerCode } from './common/partner-code';

dotenv.config();

const EARNING_TYPES = [
  'Shop Introduction',
  'Operational Support',
  'Partner Development',
] as const;

async function bootstrap() {
  const orderNumbers = process.argv
    .slice(2)
    .map((n) => n.trim().toUpperCase())
    .filter(Boolean);

  if (!orderNumbers.length) {
    console.error(
      'Usage: npx ts-node -r dotenv/config src/repair-order-commission-snapshots.ts <ORDER_NUMBER> [ORDER_NUMBER...]',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const orderModel = app.get<Model<any>>(getModelToken(Order.name));
  const commissionModel = app.get<Model<any>>(
    getModelToken(CommissionRecord.name),
  );

  for (const orderNumber of orderNumbers) {
    const order = await orderModel.findOne({ orderNumber }).exec();
    if (!order) {
      console.error(`Order ${orderNumber} not found`);
      continue;
    }

    const records = await commissionModel
      .find({
        orderId: order._id,
        status: {
          $nin: [CommissionLifecycleStatus.CANCELLED],
        },
      })
      .sort({ createdAt: 1 })
      .exec();

    if (!records.length) {
      console.warn(
        `${orderNumber}: no CommissionRecord rows to restore from — fix order.commissions manually if needed`,
      );
      continue;
    }

    let changed = false;
    const commissions = [...(order.commissions || [])];

    for (const earningType of EARNING_TYPES) {
      const oldest = records.find(
        (r) =>
          (r.earningType || 'Shop Introduction') === earningType ||
          String(r.earningType || '')
            .replace(/\s*\(partial[^)]*\)\s*$/i, '')
            .trim() === earningType,
      );
      if (!oldest?.recipientPartnerCode) continue;

      const lockedCode = normalizePartnerCode(oldest.recipientPartnerCode);
      const idx = commissions.findIndex(
        (c) =>
          String(c.earningType || '')
            .replace(/\s*\(partial[^)]*\)\s*$/i, '')
            .trim() === earningType ||
          (!c.earningType && earningType === 'Shop Introduction'),
      );

      if (idx < 0) {
        commissions.push({
          recipientUserId: String(oldest.recipientUserId),
          recipientPartnerCode: oldest.recipientPartnerCode,
          recipientRole: oldest.recipientRole,
          earningType,
          percentage: oldest.percentage,
          amount: oldest.amount,
          status: 'pending',
          shopId: oldest.shopUserId ? String(oldest.shopUserId) : undefined,
          originalCurrency: oldest.originalCurrency,
          exchangeRate: oldest.exchangeRate,
          convertedUsdAmount: oldest.convertedUsdAmount,
        });
        changed = true;
        console.log(
          `${orderNumber}: restored missing ${earningType} → ${lockedCode}`,
        );
        continue;
      }

      const currentCode = normalizePartnerCode(
        commissions[idx].recipientPartnerCode,
      );
      if (currentCode === lockedCode) continue;

      console.log(
        `${orderNumber}: ${earningType} ${currentCode} → ${lockedCode} (from CommissionRecord ${oldest._id})`,
      );
      commissions[idx] = {
        ...commissions[idx],
        recipientUserId: String(oldest.recipientUserId),
        recipientPartnerCode: oldest.recipientPartnerCode,
        recipientRole: oldest.recipientRole || commissions[idx].recipientRole,
        percentage: oldest.percentage ?? commissions[idx].percentage,
        amount: oldest.amount ?? commissions[idx].amount,
      };
      changed = true;

      // Cancel newer wrong-recipient records for the same earning type
      for (const r of records) {
        const type =
          String(r.earningType || 'Shop Introduction')
            .replace(/\s*\(partial[^)]*\)\s*$/i, '')
            .trim() || 'Shop Introduction';
        if (type !== earningType) continue;
        if (normalizePartnerCode(r.recipientPartnerCode) === lockedCode) continue;
        if (r.status === CommissionLifecycleStatus.CANCELLED) continue;
        r.status = CommissionLifecycleStatus.CANCELLED;
        await r.save();
        console.log(
          `${orderNumber}: cancelled wrong ${earningType} record for ${r.recipientPartnerCode}`,
        );
      }
    }

    if (changed) {
      order.commissions = commissions;
      order.markModified('commissions');
      await order.save();
      console.log(`${orderNumber}: order.commissions saved`);
    } else {
      console.log(`${orderNumber}: already matches oldest CommissionRecord snapshot`);
    }
  }

  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
