import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from '../../users/entities/user.entity';

export type CertificationDocument = Certification & Document;

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
}

export enum RequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Schema({ timestamps: true })
export class Certification {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  distributor: User;

  @Prop({ required: true })
  country: string;

  @Prop({ required: true })
  requesterName: string;

  @Prop({ required: true })
  shopName: string;

  @Prop({ required: true })
  shopEmail: string;

  @Prop({ required: true })
  shopPhone: string;

  @Prop({ required: true })
  shopCity: string;

  @Prop({ enum: PaymentStatus, default: PaymentStatus.PENDING })
  paymentStatus: PaymentStatus;

  @Prop({ enum: RequestStatus, default: RequestStatus.PENDING })
  requestStatus: RequestStatus;

  @Prop()
  stripeSessionId?: string;

  @Prop({ default: 25.0 })
  amount: number;
}

export const CertificationSchema = SchemaFactory.createForClass(Certification);
