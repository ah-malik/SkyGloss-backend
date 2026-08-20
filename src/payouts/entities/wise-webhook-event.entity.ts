import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type WiseWebhookEventDocument = WiseWebhookEvent & Document;

@Schema({ timestamps: true })
export class WiseWebhookEvent {
  @Prop({ required: true, unique: true, index: true })
  eventId: string;

  @Prop()
  eventType?: string;

  @Prop()
  wiseTransferId?: string;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;

  @Prop()
  processedAt?: Date;
}

export const WiseWebhookEventSchema =
  SchemaFactory.createForClass(WiseWebhookEvent);
