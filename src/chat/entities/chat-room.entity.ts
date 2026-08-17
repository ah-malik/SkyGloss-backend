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
  userType: string; // 'certified_shop', 'MASTER_PARTNER', 'REGIONAL_PARTNER', 'guest'

  /** The other participant in this private 1-to-1 room. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  peerUserId?: Types.ObjectId;

  @Prop()
  peerUserName?: string;

  @Prop()
  peerUserEmail?: string;

  @Prop()
  peerUserType?: string;

  /** Sorted pair of the two participant user ids. */
  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  participantIds?: Types.ObjectId[];

  /** Deterministic `${minId}_${maxId}` key for unique 1-to-1 lookup. */
  @Prop()
  pairKey?: string;

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

ChatRoomSchema.index({ userId: 1, status: 1 });
ChatRoomSchema.index({ status: 1, lastMessageAt: -1 });
ChatRoomSchema.index({ userEmail: 1 });
ChatRoomSchema.index({ pairKey: 1 }, { unique: true, sparse: true });
ChatRoomSchema.index({ participantIds: 1, status: 1 });
ChatRoomSchema.index({ peerUserId: 1, status: 1 });
