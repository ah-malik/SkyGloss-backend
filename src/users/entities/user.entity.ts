import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  MASTER_DISTRIBUTOR = 'master_distributor',
  REGIONAL_DISTRIBUTOR = 'regional_distributor',
  CERTIFIED_SHOP = 'certified_shop',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  BLOCKED = 'blocked',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ unique: true, sparse: true })
  email?: string;

  @Prop({ unique: true, sparse: true })
  username?: string;

  @Prop()
  password?: string;

  @Prop({ required: true, enum: UserRole })
  role: UserRole;

  @Prop({ enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  @Prop()
  firstName: string;

  @Prop()
  lastName: string;

  @Prop()
  country: string;

  @Prop()
  phoneNumber: string;

  @Prop()
  companyName?: string;

  // For refresh tokens
  @Prop()
  refreshTokenHash?: string;

  @Prop()
  resetPasswordToken?: string;

  @Prop()
  resetPasswordExpires?: Date;

  @Prop()
  accessCode?: string;

  @Prop()
  address?: string;

  @Prop()
  city?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ProductGroup' })
  productGroup?: MongooseSchema.Types.ObjectId;

  @Prop({ type: [String], default: [] })
  completedCourses: string[];

  @Prop({ type: MongooseSchema.Types.Map, of: [String], default: {} })
  courseProgress: Map<string, string[]>;
}

export const UserSchema = SchemaFactory.createForClass(User);
