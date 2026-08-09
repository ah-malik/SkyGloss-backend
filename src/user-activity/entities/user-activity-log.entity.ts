import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type UserActivityLogDocument = UserActivityLog & Document;

export enum UserActivityAction {
  LOGIN = 'login',
  LOGIN_ACCESS_CODE = 'login_access_code',
  IMPERSONATE = 'impersonate',
  USER_BLOCKED = 'user_blocked',
  USER_UNBLOCKED = 'user_unblocked',
  STATUS_CHANGE = 'status_change',
  REGISTER = 'register',
}

@Schema({ timestamps: true, collection: 'user_activity_logs' })
export class UserActivityLog {
  /** User the activity is about (who logged in / whose status changed). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(UserActivityAction), index: true })
  action: UserActivityAction;

  /** Admin / actor who performed the action (impersonation, block, etc.). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  actor?: Types.ObjectId;

  @Prop()
  portal?: string;

  /** Denormalized user country for filtering (e.g. India). */
  @Prop({ index: true })
  country?: string;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, any>;
}

export const UserActivityLogSchema =
  SchemaFactory.createForClass(UserActivityLog);

UserActivityLogSchema.index({ createdAt: -1 });
UserActivityLogSchema.index({ action: 1, createdAt: -1 });
UserActivityLogSchema.index({ user: 1, createdAt: -1 });
UserActivityLogSchema.index({ country: 1, createdAt: -1 });
