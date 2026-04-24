import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SupportTicketDocument = SupportTicket & Document;

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

@Schema({ _id: false, timestamps: false })
export class TicketMessage {
  @Prop({ required: true, enum: ['user', 'admin'] })
  sender: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: () => new Date() })
  timestamp: Date;
}

export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);

@Schema({ timestamps: true })
export class SupportTicket {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  userType: string; // 'certified_shop', 'MASTER_PARTNER', 'REGIONAL_PARTNER', 'other'

  @Prop({ required: true })
  issueCategory: string; // 'login', 'product', 'training', 'order', 'other'

  @Prop({ required: true })
  message: string;

  @Prop({ type: String, enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Prop()
  adminReply?: string;

  @Prop()
  adminReplyDate?: Date;

  @Prop({ type: [TicketMessageSchema], default: [] })
  messages: TicketMessage[];
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
