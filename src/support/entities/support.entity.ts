import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SupportTicketDocument = SupportTicket & Document;

export enum TicketStatus {
    OPEN = 'open',
    IN_PROGRESS = 'in_progress',
    RESOLVED = 'resolved',
    CLOSED = 'closed'
}

@Schema({ timestamps: true })
export class SupportTicket {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true })
    email: string;

    @Prop({ required: true })
    userType: string; // 'technician', 'shop', 'distributor', 'other'

    @Prop({ required: true })
    issueCategory: string; // 'login', 'product', 'training', 'order', 'other'

    @Prop({ required: true })
    message: string;

    @Prop({ type: String, enum: TicketStatus, default: TicketStatus.OPEN })
    status: TicketStatus;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
