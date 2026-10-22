import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { UserRole } from '../../users/entities/user.entity';

export type AccountActivationRequestDocument = AccountActivationRequest &
  Document;

export enum AccountActivationStatus {
  WAITING_HUB_APPROVAL = 'waiting_hub_approval',
  APPROVED_BY_HUB = 'approved_by_hub',
  REJECTED_BY_HUB = 'rejected_by_hub',
  /** Activated directly by an Admin from the admin panel (bypasses Hub). */
  APPROVED_BY_ADMIN = 'approved_by_admin',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: true, collection: 'accountactivationrequests' })
export class AccountActivationRequest {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop()
  userPartnerCode?: string;

  @Prop({
    enum: [
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      UserRole.DISTRIBUTOR,
    ],
    required: true,
  })
  userRole: UserRole;

  @Prop({
    enum: AccountActivationStatus,
    default: AccountActivationStatus.WAITING_HUB_APPROVAL,
    index: true,
  })
  status: AccountActivationStatus;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  assignedHubId: Types.ObjectId;

  @Prop()
  assignedHubPartnerCode?: string;

  @Prop()
  assignedHubName?: string;

  @Prop({ default: false })
  agreementAccepted: boolean;

  @Prop()
  agreementAcceptedAt?: Date;

  /** Snapshot of signed agreement form fields from the activation wizard. */
  @Prop({ type: Object })
  agreementDetails?: Record<string, string>;

  /** Admin-uploaded agreement (B2 key) used instead of the sign step. */
  @Prop()
  adminAgreementKey?: string;

  @Prop()
  adminAgreementFileName?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BankDetails' })
  bankDetailsId?: Types.ObjectId;

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
  submittedAt?: Date;
}

export const AccountActivationRequestSchema = SchemaFactory.createForClass(
  AccountActivationRequest,
);

AccountActivationRequestSchema.index({ assignedHubId: 1, status: 1 });
AccountActivationRequestSchema.index({ userId: 1, status: 1 });
AccountActivationRequestSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: AccountActivationStatus.WAITING_HUB_APPROVAL,
    },
    name: 'one_pending_activation_per_user',
  },
);
