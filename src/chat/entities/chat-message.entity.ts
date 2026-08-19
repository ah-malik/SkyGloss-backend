import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChatMessageDocument = ChatMessage & Document;

@Schema({ timestamps: true })
export class ChatMessage {
  @Prop({ type: Types.ObjectId, ref: 'ChatRoom', required: true })
  roomId: Types.ObjectId;

  @Prop({ required: true })
  senderName: string;

  @Prop({ required: true })
  senderType: string; // 'user' or 'admin'

  @Prop({ default: '' })
  message: string;

  @Prop()
  imageUrl?: string;

  @Prop()
  imagePublicId?: string;

  @Prop({ default: false })
  isRead: boolean;

  @Prop({ type: Date, default: Date.now, index: { expires: '7d' } })
  createdAt: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

ChatMessageSchema.index({ roomId: 1, createdAt: -1 });
ChatMessageSchema.index({ roomId: 1, isRead: 1 });
