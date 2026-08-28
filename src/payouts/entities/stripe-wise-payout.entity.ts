import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  StripeAccountKey,
  StripeWisePayoutStatus,
  WiseReceiptStatus,
} from '../stripe-wise-payouts.logic';

export type StripeWisePayoutDocument = StripeWisePayout & Document;

@Schema({ timestamps: true, collection: 'stripe_wise_payouts' })
export class StripeWisePayout {
  @Prop({ required: true, unique: true, index: true })
  idempotencyKey: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  currency: string;

  @Prop({ type: String, required: true, default: 'global' })
  stripeAccountKey: StripeAccountKey;

  @Prop()
  stripePayoutId?: string;

  /** Present when funds were sent from a Financial Account via outbound payment. */
  @Prop()
  stripeOutboundPaymentId?: string;

  @Prop({ type: String, default: 'payments_balance' })
  sourceType?: 'payments_balance' | 'financial_account';

  @Prop()
  stripeFinancialAccountId?: string;

  @Prop()
  stripeDestinationId?: string;

  @Prop()
  stripeBalanceTransactionId?: string;

  @Prop({
    type: String,
    required: true,
    default: 'creating',
    index: true,
  })
  status: StripeWisePayoutStatus;

  @Prop({ type: String, required: true, default: 'not_started' })
  wiseStatus: WiseReceiptStatus;

  @Prop()
  arrivalDate?: Date;

  @Prop()
  failureCode?: string;

  @Prop()
  failureMessage?: string;

  @Prop()
  destinationName?: string;

  @Prop()
  destinationSummary?: string;

  /** Estimated amount sent from Stripe (before receiving fees / FX). */
  @Prop()
  estimatedAmount?: number;

  /** Actual amount credited on Wise after settlement. */
  @Prop()
  actualReceivedAmount?: number;

  @Prop()
  wisePreviousBalance?: number;

  @Prop()
  wiseNewBalance?: number;

  @Prop()
  wiseTransactionId?: string;

  @Prop()
  wiseMatchedAt?: Date;

  @Prop({ type: Date })
  stripePaidAt?: Date;

  @Prop({ type: Date })
  stripeFailedAt?: Date;

  @Prop({ type: Object })
  snapshot?: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StripeWisePayoutSchema =
  SchemaFactory.createForClass(StripeWisePayout);

StripeWisePayoutSchema.index({ createdAt: -1 });
StripeWisePayoutSchema.index({ stripePayoutId: 1 }, { sparse: true });
StripeWisePayoutSchema.index({
  createdBy: 1,
  amount: 1,
  currency: 1,
  status: 1,
  createdAt: -1,
});
