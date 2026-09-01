/**
 * Backfill commissions on existing shop orders after a Representative link.
 * Run: npm run backfill-rep-shop-commissions -- SKYGLOSSPNW
 * Or for one shop: npm run backfill-rep-shop-commissions -- SKYGLOSSPNW <shopUserId>
 */
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from './app.module';
import { OrdersService } from './orders/orders.service';
import { User, UserRole } from './users/entities/user.entity';
import { normalizePartnerCode } from './common/partner-code';

dotenv.config();

async function bootstrap() {
  const partnerCode = normalizePartnerCode(process.argv[2] || '');
  const shopUserId = (process.argv[3] || '').trim();

  if (!partnerCode && !shopUserId) {
    console.error(
      'Usage: npm run backfill-rep-shop-commissions -- <partnerCode> [shopUserId]',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const userModel = app.get<Model<any>>(getModelToken(User.name));
  const ordersService = app.get(OrdersService);

  let shopIds: string[] = [];
  if (shopUserId) {
    shopIds = [shopUserId];
  } else {
    const shops = await userModel
      .find({
        role: UserRole.CERTIFIED_SHOP,
        $or: [
          { referredByPartnerCode: partnerCode },
          { operationalSupportRepresentativeCode: partnerCode },
        ],
      })
      .select('_id shopName email referredByPartnerCode operationalSupportRepresentativeCode')
      .lean()
      .exec();
    shopIds = shops.map((shop) => String(shop._id));
    console.log(
      `Found ${shopIds.length} shop(s) linked to ${partnerCode}:`,
      shops.map((s) => s.shopName || s.email),
    );
  }

  let totalProcessed = 0;
  let totalUpdated = 0;

  for (const id of shopIds) {
    const result = await ordersService.recalculateCommissionsForShop(id);
    totalProcessed += result.processed;
    totalUpdated += result.updated;
    console.log(`Shop ${id}: ${result.processed} order(s), ${result.updated} updated`);
  }

  console.log(
    `Backfill complete: ${shopIds.length} shop(s), ${totalProcessed} order(s) scanned, ${totalUpdated} updated.`,
  );

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
