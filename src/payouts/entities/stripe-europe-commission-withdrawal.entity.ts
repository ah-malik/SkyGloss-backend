import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type StripeEuropeCommissionWithdrawalDocument =
  StripeEuropeCommissionWithdrawal & Document;

/**
 * Admin-recorded receive/withdraw amounts against Stripe Europe commission.
 * Total earned comes from order_commission_transfers (europe); remaining =
 * total earned − sum(these withdrawals).
 */
@Schema({
  timestamps: true,
  collection: 'stripe_europe_commission_withdrawals',
})
export class StripeEuropeCommissionWithdrawal {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  createdBy: Types.ObjectId;

  /** Amount received/withdrawn (USD ledger, same as Europe commissionAmount). */
  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  /** Date the admin attributes to this receive/withdraw (defaults to now). */
  @Prop({ type: Date, required: true, index: true })
  receivedAt: Date;

  @Prop({ maxlength: 500 })
  note?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StripeEuropeCommissionWithdrawalSchema =
  SchemaFactory.createForClass(StripeEuropeCommissionWithdrawal);

StripeEuropeCommissionWithdrawalSchema.index({ receivedAt: -1 });
StripeEuropeCommissionWithdrawalSchema.index({ createdAt: -1 });
