import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CouponDocument = Coupon & Document;

export enum CouponDiscountType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
}

/** Where the coupon may be redeemed. */
export enum CouponUsageType {
  ORDER = 'order',
  SHOP_REGISTRATION = 'shop_registration',
}

@Schema({ timestamps: true })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({
    required: true,
    enum: CouponUsageType,
    default: CouponUsageType.ORDER,
  })
  usageType: CouponUsageType;

  @Prop({ required: true, enum: CouponDiscountType })
  discountType: CouponDiscountType;

  @Prop({ required: true, min: 0 })
  discountValue: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  expiresAt?: Date;

  /** Optional cap on total redemptions. */
  @Prop({ min: 1 })
  maxUses?: number;

  @Prop({ default: 0, min: 0 })
  timesUsed: number;

  @Prop()
  description?: string;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);
