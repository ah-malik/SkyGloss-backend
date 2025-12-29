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

    @Prop({ required: true })
    message: string;

    @Prop({ default: false })
    isRead: boolean;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
