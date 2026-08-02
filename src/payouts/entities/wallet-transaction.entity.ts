import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type WalletTransactionDocument = WalletTransaction & Document;

export enum WalletTransactionType {
  HUB_APPROVAL_CREDIT = 'hub_approval_credit',
  ADMIN_PAYOUT_DEBIT = 'admin_payout_debit',
  ADMIN_REJECT_REVERSAL = 'admin_reject_reversal',
  HUB_REJECT_UNLOCK = 'hub_reject_unlock',
}

@Schema({ timestamps: true })
export class WalletTransaction {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WebsiteWallet', required: true })
  walletId: Types.ObjectId;

  @Prop({ required: true, enum: WalletTransactionType })
  type: WalletTransactionType;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  balanceAfter: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WithdrawalRequest' })
  withdrawalRequestId?: Types.ObjectId;

  @Prop({ required: true })
  description: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  performedBy?: Types.ObjectId;
}

export const WalletTransactionSchema =
  SchemaFactory.createForClass(WalletTransaction);
