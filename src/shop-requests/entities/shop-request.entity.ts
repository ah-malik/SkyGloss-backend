import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ShopRequestDocument = ShopRequest & Document;

export enum RequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Schema({ timestamps: true })
export class ShopRequest {
  @Prop({ required: true })
  shopName: string;

  @Prop({ required: true })
  email: string; // If approved, this becomes the user email

  @Prop({ required: true })
  country: string;

  @Prop()
  phoneNumber: string;

  @Prop()
  contactName: string;

  @Prop()
  website: string;

  @Prop()
  address: string;

  @Prop()
  accessCodeUsed: string; // The code they used to verify initially (if non-USA)

  @Prop({ enum: RequestStatus, default: RequestStatus.PENDING })
  status: RequestStatus;

  @Prop()
  adminComments?: string;
}

export const ShopRequestSchema = SchemaFactory.createForClass(ShopRequest);
