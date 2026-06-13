import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ExchangeRateDocument = ExchangeRate & Document;

@Schema({ timestamps: true })
export class ExchangeRate {
  /** ISO currency code, e.g. USD, EUR */
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  currency: string;

  /** 1 unit of this currency = rateToBase USD */
  @Prop({ required: true })
  rateToBase: number;
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
