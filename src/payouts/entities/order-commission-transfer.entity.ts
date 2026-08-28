import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { StripeAccountKey } from '../stripe-wise-payouts.logic';

export type OrderCommissionTransferLine = {
  recipientUserId?: string;
  recipientPartnerCode?: string;
  earningType?: string;
  amount: number;
  percentage?: number;
};

export const ORDER_COMMISSION_TRANSFER_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

export type OrderCommissionTransferStatus =
  (typeof ORDER_COMMISSION_TRANSFER_STATUSES)[number];

export type OrderCommissionTransferDocument = OrderCommissionTransfer & Document;

@Schema({ timestamps: true, collection: 'order_commission_transfers' })
export class OrderCommissionTransfer {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true,
  })
  orderId: Types.ObjectId;

  @Prop({ required: true, index: true })
  orderNumber: string;

  @Prop({ required: true })
  orderAmount: number;

  /** Original checkout currency for display (commission transfer uses USD). */
  @Prop()
  orderCurrency?: string;

  @Prop({ required: true })
  commissionAmount: number;

  @Prop({ type: [Object], default: [] })
  commissionLines: OrderCommissionTransferLine[];

  @Prop()
  commissionTypesSummary?: string;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ index: true, sparse: true, unique: true })
  stripePaymentId?: string;

  @Prop({ type: String, required: true, default: 'global' })
  stripeAccountKey: StripeAccountKey;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'StripeWisePayout',
    index: true,
    sparse: true,
  })
  stripeWisePayoutId?: Types.ObjectId;

  @Prop()
  stripePayoutId?: string;

  @Prop()
  stripeOutboundPaymentId?: string;

  @Prop()
  wiseTransferId?: string;

  @Prop({
    type: String,
    required: true,
    default: 'pending',
    index: true,
  })
  status: OrderCommissionTransferStatus;

  @Prop()
  errorReason?: string;

  @Prop({ type: Date })
  transferDate?: Date;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ required: true, unique: true, index: true })
  idempotencyKey: string;

  @Prop({ type: Object })
  snapshot?: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OrderCommissionTransferSchema = SchemaFactory.createForClass(
  OrderCommissionTransfer,
);

OrderCommissionTransferSchema.index({ createdAt: -1 });
OrderCommissionTransferSchema.index({ status: 1, createdAt: -1 });
