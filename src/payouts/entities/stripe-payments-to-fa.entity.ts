import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import {
  StripeAccountKey,
  StripeWisePayoutStatus,
} from '../stripe-wise-payouts.logic';

export type StripePaymentsToFaDocument = StripePaymentsToFa & Document;

@Schema({ timestamps: true, collection: 'stripe_payments_to_fa' })
export class StripePaymentsToFa {
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

  @Prop({ required: true })
  stripeFinancialAccountId: string;

  @Prop()
  financialAccountName?: string;

  @Prop()
  stripePayoutId?: string;

  @Prop({
    type: String,
    required: true,
    default: 'creating',
    index: true,
  })
  status: StripeWisePayoutStatus;

  @Prop()
  failureCode?: string;

  @Prop()
  failureMessage?: string;

  @Prop()
  arrivalDate?: Date;

  @Prop({ type: Date })
  stripePaidAt?: Date;

  @Prop({ type: Date })
  stripeFailedAt?: Date;

  @Prop({ type: Object })
  snapshot?: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const StripePaymentsToFaSchema =
  SchemaFactory.createForClass(StripePaymentsToFa);

StripePaymentsToFaSchema.index({ createdAt: -1 });
StripePaymentsToFaSchema.index({ stripePayoutId: 1 }, { sparse: true });
