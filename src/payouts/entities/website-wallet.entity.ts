import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type WebsiteWalletDocument = WebsiteWallet & Document;

@Schema({ timestamps: true })
export class WebsiteWallet {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ default: 0 })
  availableBalance: number;

  @Prop({ default: 0 })
  pendingWithdrawalBalance: number;

  @Prop({ default: 0 })
  lifetimeWithdrawn: number;

  @Prop({ default: 'USD' })
  currency: string;

  @Prop({ default: 0 })
  version: number;
}

export const WebsiteWalletSchema = SchemaFactory.createForClass(WebsiteWallet);
