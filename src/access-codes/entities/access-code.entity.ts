import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { UserRole } from '../../users/entities/user.entity';

export type AccessCodeDocument = AccessCode & Document;

@Schema({ timestamps: true })
export class AccessCode {
  @Prop({ required: true, unique: true })
  code: string; // 8-digit

  @Prop({ required: true, enum: [UserRole.TECHNICIAN, UserRole.SHOP] })
  targetRole: UserRole;

  @Prop({ default: false })
  isUsed: boolean;

  @Prop()
  expiresAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  generatedBy: Types.ObjectId; // Distributor or Admin who generated it

  @Prop()
  generatedForEmail?: string; // Optional: bind to a specific email?
}

export const AccessCodeSchema = SchemaFactory.createForClass(AccessCode);
