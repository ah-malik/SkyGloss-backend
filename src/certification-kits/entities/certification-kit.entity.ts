import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type CertificationKitDocument = CertificationKit & Document;

/** Sent by the Hub/Distributor, waiting for an Admin. */
export const CERTIFICATION_KIT_STATUS_PENDING = 'pending';
export const CERTIFICATION_KIT_STATUS_APPROVED = 'approved';
export const CERTIFICATION_KIT_STATUS_REJECTED = 'rejected';
/** Saved before approvals existed: treated as waiting for approval. */
export const CERTIFICATION_KIT_STATUS_LEGACY_SAVED = 'saved';

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

/** The recipe an Admin approved. Shops only ever see this version. */
@Schema({ _id: false })
export class ApprovedCertificationKit {
  @Prop({ type: [CertificationKitItemSchema], default: [] })
  items: CertificationKitItem[];

  @Prop({ type: Boolean, default: true })
  freeShipping: boolean;

  @Prop({ type: Boolean, default: false })
  trainingIncluded: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  trainingPrice: number;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  discountPercent: number;

  /** Currency of trainingPrice (the owner's catalog currency when approved). */
  @Prop()
  currency?: string;

  @Prop()
  approvedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;
}

export const ApprovedCertificationKitSchema = SchemaFactory.createForClass(
  ApprovedCertificationKit,
);

/**
 * A Hub's or Distributor's Certification Kit for the shops on its Parent Link.
 * Only the recipe is stored — product prices and the certification fee are
 * resolved per viewer (assigned Pricing Group / fee group) every time.
 *
 * The top-level fields are the latest version the owner sent; `live` is the
 * version an Admin approved. A new edit goes back to `pending` while shops keep
 * seeing the last approved `live` version.
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

  /** The owner's catalog currency when sent (the currency of trainingPrice). */
  @Prop()
  currency?: string;

  @Prop({ default: CERTIFICATION_KIT_STATUS_PENDING, index: true })
  status: string;

  /** When the owner last sent the kit to SkyGloss. */
  @Prop()
  savedAt?: Date;

  @Prop({ type: ApprovedCertificationKitSchema })
  live?: ApprovedCertificationKit;

  @Prop()
  reviewedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  /** Admin's reason when the kit is rejected. */
  @Prop()
  reviewNote?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CertificationKitSchema =
  SchemaFactory.createForClass(CertificationKit);
