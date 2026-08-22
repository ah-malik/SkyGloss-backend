import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type ProductInventoryDocument = ProductInventory & Document;

@Schema({ timestamps: true })
export class ProductInventory {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true,
  })
  productId: Types.ObjectId;

  /** Shared stock for Unit and Case orders (same pool). */
  @Prop({ type: Number, default: 0, min: 0 })
  stock: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ProductInventorySchema =
  SchemaFactory.createForClass(ProductInventory);

ProductInventorySchema.index({ userId: 1, productId: 1 }, { unique: true });
