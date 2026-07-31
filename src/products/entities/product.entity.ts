import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProductDocument = Product & Document;

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  category: string;

  @Prop({ default: 0 })
  stock: number;

  @Prop({ type: [String], required: true })
  images: string[];

  @Prop({ type: [String], default: [] })
  shopImages: string[];

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ required: false })
  specifications: string;

  @Prop({ required: false })
  technicalSpecifications: string;

  @Prop({ type: [String], default: [] })
  applicationGuide: string[];

  @Prop({
    type: [
      {
        size: { type: String, required: true },
        price: { type: Number, required: true },
      },
    ],
    default: [],
  })
  sizes: { size: string; price: number }[];

  @Prop()
  technicalSheetUrl?: string;

  @Prop()
  sdsUrl?: string;

  @Prop()
  sdsUrlDutch?: string;

  @Prop()
  sdsAetherUrl?: string;

  @Prop()
  sdsAetherUrlDutch?: string;

  @Prop()
  applicationGuideUrl?: string;

  @Prop({ default: 'published', enum: ['published', 'draft'] })
  status: string;

  @Prop({ default: 'all', enum: ['certified_shop', 'all'] })
  targetAudience: string;

  @Prop({ default: 0 })
  displayOrder: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
