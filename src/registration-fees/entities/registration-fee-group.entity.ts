import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RegistrationFeeGroupDocument = RegistrationFeeGroup & Document;

@Schema({ timestamps: true })
export class RegistrationFeeGroup {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ type: [String], default: [] })
  countries: string[];

  @Prop({ required: true, default: 250 })
  feeAmount: number;

  @Prop({ required: false, default: 0 })
  taxAmount: number;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isDefault: boolean;
}

export const RegistrationFeeGroupSchema = SchemaFactory.createForClass(RegistrationFeeGroup);
