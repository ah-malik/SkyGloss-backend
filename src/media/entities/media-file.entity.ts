import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { MEDIA_CATEGORIES, MediaCategory } from '../media-types';

export type MediaFileDocument = MediaFile & Document;

/** A file stored in Backblaze B2 and shown in the admin media library. */
@Schema({ timestamps: true, collection: 'media_files' })
export class MediaFile {
  @Prop({ required: true })
  originalName: string;

  /** Object key in the B2 bucket. */
  @Prop({ required: true, unique: true })
  fileName: string;

  @Prop({ required: true, unique: true })
  fileId: string;

  @Prop({ type: String, required: true, enum: MEDIA_CATEGORIES, index: true })
  category: MediaCategory;

  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  uploadedBy?: Types.ObjectId;
}

export const MediaFileSchema = SchemaFactory.createForClass(MediaFile);
MediaFileSchema.index({ category: 1, createdAt: -1 });
