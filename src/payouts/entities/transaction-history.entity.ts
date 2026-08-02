import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type TransactionHistoryDocument = TransactionHistory & Document;

@Schema({ timestamps: true })
export class TransactionHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['commission', 'withdrawal', 'wallet', 'payout'] })
  category: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, enum: ['credit', 'debit'] })
  direction: 'credit' | 'debit';

  @Prop()
  referenceId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  sourceDocumentId?: Types.ObjectId;

  @Prop({ required: true })
  sourceCollection: string;

  @Prop({ type: Object })
  snapshot?: Record<string, unknown>;
}

export const TransactionHistorySchema =
  SchemaFactory.createForClass(TransactionHistory);

TransactionHistorySchema.index({ userId: 1, createdAt: -1 });
