import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ApprovalHistoryDocument = ApprovalHistory & Document;

export enum ApprovalAction {
  COMMISSION_CREATED = 'commission_created',
  COMMISSION_AVAILABLE = 'commission_available',
  WITHDRAWAL_SUBMIT = 'withdrawal_submit',
  BANK_DETAILS_ADDED = 'bank_details_added',
  HUB_APPROVE = 'hub_approve',
  HUB_REJECT = 'hub_reject',
  ADMIN_APPROVE = 'admin_approve',
  ADMIN_REJECT = 'admin_reject',
  PAYMENT_COMPLETED = 'payment_completed',
  COMMISSION_CANCELLED = 'commission_cancelled',
}

@Schema({ timestamps: true })
export class ApprovalHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WithdrawalRequest', index: true })
  withdrawalRequestId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'CommissionRecord', index: true })
  commissionRecordId?: Types.ObjectId;

  @Prop({ required: true, enum: ApprovalAction })
  action: ApprovalAction;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  actorUserId?: Types.ObjectId;

  @Prop()
  actorRole?: string;

  @Prop()
  previousStatus?: string;

  @Prop()
  newStatus?: string;

  @Prop()
  note?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const ApprovalHistorySchema =
  SchemaFactory.createForClass(ApprovalHistory);
