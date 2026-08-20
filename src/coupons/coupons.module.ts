import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { StripeCouponSyncService } from './stripe-coupon-sync.service';
import { Coupon, CouponSchema } from './entities/coupon.entity';
import { Order, OrderSchema } from '../orders/entities/order.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Coupon.name, schema: CouponSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [CouponsController],
  providers: [CouponsService, StripeCouponSyncService],
  exports: [CouponsService, StripeCouponSyncService],
})
export class CouponsModule {}
