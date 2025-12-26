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
    features: string[];

    @Prop({
        type: [
            {
                label: { type: String, required: true },
                value: { type: String, required: true },
            },
        ],
        default: [],
    })
    specifications: { label: string; value: string }[];

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

    @Prop({ default: 'published', enum: ['published', 'draft'] })
    status: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
