import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ProductGroupDocument = ProductGroup & Document;

@Schema({ timestamps: true })
export class ProductGroup {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({
    type: [
      {
        productId: {
          type: MongooseSchema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        sizes: [
          {
            size: { type: String, required: true },
            price: { type: Number, required: true },
          },
        ],
      },
    ],
    default: [],
  })
  products: {
    productId: MongooseSchema.Types.ObjectId;
    sizes: { size: string; price: number }[];
  }[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  country?: string;

  @Prop({ default: false })
  isDefault: boolean;
}

export const ProductGroupSchema = SchemaFactory.createForClass(ProductGroup);
