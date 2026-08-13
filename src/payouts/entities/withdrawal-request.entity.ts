import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type WithdrawalRequestDocument = WithdrawalRequest & Document;

export enum WithdrawalStatus {
  WAITING_BANK_DETAILS = 'waiting_bank_details',
  WAITING_HUB_APPROVAL = 'waiting_hub_approval',
  REJECTED_BY_HUB = 'rejected_by_hub',
  HUB_APPROVED = 'hub_approved',
  SENT_TO_ADMIN = 'sent_to_admin',
  ADMIN_APPROVED = 'admin_approved',
  REJECTED_BY_ADMIN = 'rejected_by_admin',
  PAYMENT_PROCESSING = 'payment_processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export const ACTIVE_WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  WithdrawalStatus.WAITING_BANK_DETAILS,
  WithdrawalStatus.WAITING_HUB_APPROVAL,
  WithdrawalStatus.HUB_APPROVED,
  WithdrawalStatus.SENT_TO_ADMIN,
  WithdrawalStatus.ADMIN_APPROVED,
  WithdrawalStatus.PAYMENT_PROCESSING,
];

@Schema({ timestamps: true })
export class WithdrawalRequest {
  @Prop({ required: true, unique: true })
  requestNumber: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  userPartnerCode: string;

  @Prop({ required: true })
  userRole: string;

  @Prop({ required: true })
  requestedAmount: number;

  @Prop({ default: 'USD' })
  currency: string;

  @Prop({
    type: String,
    enum: WithdrawalStatus,
    default: WithdrawalStatus.WAITING_HUB_APPROVAL,
  })
  status: WithdrawalStatus;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'CommissionRecord' }], default: [] })
  commissionRecordIds: Types.ObjectId[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BankDetails' })
  bankDetailsId?: Types.ObjectId;

  /** Hub whose shop commissions this withdrawal is drawn from. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', index: true })
  sourceHubId?: Types.ObjectId;

  @Prop()
  sourceHubPartnerCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  hubReviewerId?: Types.ObjectId;

  @Prop()
  hubReviewedAt?: Date;

  @Prop()
  hubReviewNote?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  adminReviewerId?: Types.ObjectId;

  @Prop()
  adminReviewedAt?: Date;

  @Prop()
  adminReviewNote?: string;

  @Prop()
  walletCreditedAt?: Date;

  @Prop()
  walletDebitedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  wiseTransferReference?: string;
}

export const WithdrawalRequestSchema =
  SchemaFactory.createForClass(WithdrawalRequest);

WithdrawalRequestSchema.index({ userId: 1, status: 1, createdAt: -1 });
WithdrawalRequestSchema.index({ status: 1, createdAt: -1 });
