import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type CertificationKitDocument = CertificationKit & Document;

export const CERTIFICATION_KIT_STATUS_SAVED = 'saved';

@Schema({ _id: false })
export class CertificationKitItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  /** Product name at save time (display only; prices always re-resolve). */
  @Prop({ default: '' })
  name: string;

  @Prop({ required: true })
  size: string;

  @Prop({ type: Number, required: true, min: 1, max: 99 })
  quantity: number;
}

export const CertificationKitItemSchema =
  SchemaFactory.createForClass(CertificationKitItem);

/**
 * A Hub's or Distributor's Certification Kit for the shops on its Parent Link.
 * Only the recipe is stored — product prices and the certification fee are
 * resolved per viewer (assigned Pricing Group / fee group) every time.
 */
@Schema({ timestamps: true })
export class CertificationKit {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  owner: Types.ObjectId;

  @Prop({ required: true, index: true })
  ownerPartnerCode: string;

  @Prop({ type: [CertificationKitItemSchema], default: [] })
  items: CertificationKitItem[];

  @Prop({ type: Boolean, default: true })
  freeShipping: boolean;

  @Prop({ type: Boolean, default: false })
  trainingIncluded: boolean;

  /** In the owner's catalog currency. 0 = training included for free. */
  @Prop({ type: Number, default: 0, min: 0 })
  trainingPrice: number;

  /** Percent off the products (0–100). */
  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  discountPercent: number;

  @Prop({ default: CERTIFICATION_KIT_STATUS_SAVED })
  status: string;

  @Prop()
  savedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CertificationKitSchema =
  SchemaFactory.createForClass(CertificationKit);
