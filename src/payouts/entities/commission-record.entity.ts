import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type CommissionRecordDocument = CommissionRecord & Document;

export enum CommissionLifecycleStatus {
  PENDING_HOLD = 'pending_hold',
  AVAILABLE = 'available',
  LOCKED = 'locked',
  WITHDRAWN = 'withdrawn',
  CANCELLED = 'cancelled',
}

/** @deprecated Use commission-hold.config.ts — production hold is 30 days */
export const COMMISSION_HOLD_DAYS = 30;

@Schema({ timestamps: true })
export class CommissionRecord {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({ required: true, index: true })
  orderNumber: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  recipientUserId: Types.ObjectId;

  @Prop({ required: true })
  recipientPartnerCode: string;

  @Prop({ required: true })
  recipientRole: string;

  @Prop({ required: true })
  earningType: string;

  @Prop({ required: true })
  percentage: number;

  @Prop({ required: true })
  amount: number;

  @Prop({ default: 'USD' })
  currency: string;

  @Prop({
    type: String,
    enum: CommissionLifecycleStatus,
    default: CommissionLifecycleStatus.PENDING_HOLD,
  })
  status: CommissionLifecycleStatus;

  @Prop({ required: true })
  shippedAt: Date;

  @Prop({ required: true, index: true })
  availableAt: Date;

  @Prop()
  availableConfirmedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WithdrawalRequest' })
  withdrawalRequestId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  shopUserId?: Types.ObjectId;

  @Prop()
  originalCurrency?: string;

  @Prop()
  exchangeRate?: number;

  @Prop()
  convertedUsdAmount?: number;
}

export const CommissionRecordSchema =
  SchemaFactory.createForClass(CommissionRecord);

CommissionRecordSchema.index(
  { orderId: 1, recipientUserId: 1, earningType: 1 },
  { unique: true },
);
CommissionRecordSchema.index({ recipientUserId: 1, status: 1, availableAt: 1 });
CommissionRecordSchema.index({ status: 1, availableAt: 1 });
