import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { OrderItem, ShippingAddress } from './order.entity';

export type DuplicateInvoiceDocument = DuplicateInvoice & Document;

@Schema({ timestamps: true })
export class DuplicateInvoice {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true,
  })
  orderId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  invoiceNumber: string;

  @Prop({ required: true, default: 1 })
  sequence: number;

  @Prop({ type: [OrderItem], required: true })
  items: OrderItem[];

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ default: 0 })
  shippingFee?: number;

  @Prop({ default: 0 })
  discount?: number;

  @Prop({ default: 'USD' })
  currency?: string;

  @Prop({ type: ShippingAddress })
  shippingAddress?: ShippingAddress;

  @Prop()
  sentAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const DuplicateInvoiceSchema =
  SchemaFactory.createForClass(DuplicateInvoice);

DuplicateInvoiceSchema.index({ orderId: 1, sequence: 1 });
