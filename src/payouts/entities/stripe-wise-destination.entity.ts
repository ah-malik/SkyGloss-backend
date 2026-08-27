import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { StripeAccountKey } from '../stripe-wise-payouts.logic';

export type StripeWiseDestinationDocument = StripeWiseDestination & Document;

@Schema({ timestamps: true, collection: 'stripe_wise_destinations' })
export class StripeWiseDestination {
  @Prop({ required: true, unique: true, default: 'default' })
  key: string;

  @Prop({ default: 'Wise receiving account' })
  accountName: string;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop()
  country?: string;

  @Prop()
  accountHolderName?: string;

  @Prop()
  bankName?: string;

  @Prop()
  iban?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  routingNumber?: string;

  @Prop()
  sortCode?: string;

  @Prop()
  swiftBic?: string;

  /** Which Stripe platform account funds this payout. */
  @Prop({ type: String, required: true, default: 'global' })
  stripeAccountKey: StripeAccountKey;

  /**
   * When true, Stripe payouts use the account's default bank for this currency.
   * Only enable if that default bank is already the Wise receiving account.
   */
  @Prop({ default: false })
  payoutToDefaultStripeBank: boolean;

  @Prop()
  stripeExternalAccountId?: string;

  @Prop()
  stripeDestinationFingerprint?: string;

  @Prop()
  lastVerifiedAt?: Date;

  @Prop()
  lastVerifyError?: string;
}

export const StripeWiseDestinationSchema =
  SchemaFactory.createForClass(StripeWiseDestination);
