import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from '../../users/entities/user.entity';

export type NotificationDocument = Notification & Document;

export enum NotificationType {
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_PAID = 'ORDER_PAID',
  CERT_REQUEST = 'CERT_REQUEST',
  CERT_PAID = 'CERT_PAID',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  NEW_USER = 'NEW_USER',
  SUPPORT_TICKET = 'SUPPORT_TICKET',
  CERT_VIDEO_UPLOADED = 'CERT_VIDEO_UPLOADED',
  TRAINING_COMPLETED = 'TRAINING_COMPLETED',
  COMMISSION_AVAILABLE = 'COMMISSION_AVAILABLE',
  WITHDRAWAL_SUBMITTED = 'WITHDRAWAL_SUBMITTED',
  WITHDRAWAL_HUB_APPROVED = 'WITHDRAWAL_HUB_APPROVED',
  WITHDRAWAL_HUB_REJECTED = 'WITHDRAWAL_HUB_REJECTED',
  WITHDRAWAL_ADMIN_APPROVED = 'WITHDRAWAL_ADMIN_APPROVED',
  WITHDRAWAL_ADMIN_REJECTED = 'WITHDRAWAL_ADMIN_REJECTED',
  WITHDRAWAL_COMPLETED = 'WITHDRAWAL_COMPLETED',
  BANK_DETAILS_VERIFIED = 'BANK_DETAILS_VERIFIED',
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true, enum: NotificationType })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata: any;

  @Prop({ default: false })
  isRead: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  user: User; // The recipient of the notification

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  triggeredBy: User; // The user who triggered the activity

  @Prop()
  link: string; // Optional link to the resource (e.g., /orders/123)
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
