import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type OrderActivityLogDocument = OrderActivityLog & Document;

@Schema({ timestamps: true, collection: 'order_activity_logs' })
export class OrderActivityLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({ index: true })
  orderNumber?: string;

  /** status_change | delete */
  @Prop({ required: true })
  action: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  @Prop()
  actorName?: string;

  @Prop()
  actorEmail?: string;

  @Prop()
  actorRole?: string;

  @Prop()
  previousStatus?: string;

  @Prop()
  newStatus?: string;

  @Prop()
  trackingId?: string;

  @Prop()
  shippingCompany?: string;
}

export const OrderActivityLogSchema = SchemaFactory.createForClass(OrderActivityLog);

OrderActivityLogSchema.index({ orderId: 1, createdAt: -1 });
