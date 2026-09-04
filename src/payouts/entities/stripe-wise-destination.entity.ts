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

  /** Stripe Global Payouts recipient account that holds the Wise bank payout method. */
  @Prop()
  stripeRecipientId?: string;

  /** Stripe payout method id (usba_...) for the Wise receiving bank. */
  @Prop()
  stripePayoutMethodId?: string;

  /** Preferred Financial Account to send from (fa_...). */
  @Prop()
  stripeFinancialAccountId?: string;

  /**
   * Stripe Europe → Wise default bank (Transferwise Europe).
   * Kept separate from Global/USA USD receiving details.
   */
  @Prop({ default: 'Transferwise Europe (Wise)' })
  europeAccountName?: string;

  @Prop({ default: 'USD' })
  europeCurrency?: string;

  @Prop()
  europeCountry?: string;

  @Prop()
  europeAccountHolderName?: string;

  @Prop()
  europeBankName?: string;

  @Prop()
  europeIban?: string;

  @Prop()
  europeAccountNumber?: string;

  @Prop()
  europeRoutingNumber?: string;

  @Prop()
  europeSwiftBic?: string;

  @Prop({ default: true })
  europePayoutToDefaultStripeBank?: boolean;

  @Prop()
  europeStripeExternalAccountId?: string;

  @Prop()
  europeLastVerifiedAt?: Date;

  @Prop()
  europeLastVerifyError?: string;

  @Prop()
  lastVerifiedAt?: Date;

  @Prop()
  lastVerifyError?: string;
}

export const StripeWiseDestinationSchema =
  SchemaFactory.createForClass(StripeWiseDestination);
