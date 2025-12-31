import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChatRoomDocument = ChatRoom & Document;

@Schema({ timestamps: true })
export class ChatRoom {
    @Prop({ type: Types.ObjectId, ref: 'User' })
    userId: Types.ObjectId;

    @Prop({ required: true })
    userName: string;

    @Prop({ required: true })
    userEmail: string;

    @Prop({ default: 'guest' })
    userType: string; // 'technician', 'shop', 'distributor', 'guest'

    @Prop({ default: 'active' })
    status: string; // 'active', 'closed'

    @Prop()
    lastMessage: string;

    @Prop()
    lastMessageAt: Date;

    @Prop({ type: Date, default: Date.now, index: { expires: '7d' } })
    updatedAt: Date;
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom);
