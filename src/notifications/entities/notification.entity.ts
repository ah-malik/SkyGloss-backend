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
  user: User; // The user associated with the notification (e.g., who placed the order)

  @Prop()
  link: string; // Optional link to the resource (e.g., /orders/123)
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
