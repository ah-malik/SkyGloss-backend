import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type BankDetailsDocument = BankDetails & Document;

export enum BankVerificationStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

@Schema({ timestamps: true })
export class BankDetails {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  accountHolderName: string;

  @Prop({ required: true })
  bankName: string;

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

  @Prop({ type: Object })
  extraDetails?: Record<string, string>;

  @Prop({ required: true })
  country: string;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop()
  wiseRecipientId?: string;

  @Prop()
  wiseRecipientType?: string;

  @Prop()
  wiseRecipientStatus?: string;

  @Prop()
  detailsFingerprint?: string;

  @Prop({
    type: String,
    enum: BankVerificationStatus,
    default: BankVerificationStatus.PENDING,
  })
  verificationStatus: BankVerificationStatus;

  @Prop()
  verifiedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  verifiedBy?: Types.ObjectId;

  @Prop({ default: true })
  isPrimary: boolean;

  @Prop({ default: false })
  isDeleted: boolean;
}

export const BankDetailsSchema = SchemaFactory.createForClass(BankDetails);

BankDetailsSchema.index({ userId: 1, isPrimary: 1, isDeleted: 1 });
