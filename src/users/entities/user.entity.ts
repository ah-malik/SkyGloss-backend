import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  MASTER_PARTNER = 'master_partner',
  REGIONAL_PARTNER = 'regional_partner',
  PARTNER = 'partner',
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
  shopName?: string;

  @Prop()
  hearAboutUs?: string;

  @Prop({ required: true })
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
  address: string;

  @Prop()
  streetAddress?: string;

  @Prop({ required: true })
  city: string;

  @Prop()
  zipCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ProductGroup' })
  productGroup?: MongooseSchema.Types.ObjectId;

  @Prop({ type: [String], default: [] })
  completedCourses: string[];

  @Prop({ type: MongooseSchema.Types.Map, of: [String], default: {} })
  courseProgress: Map<string, string[]>;

  @Prop()
  latitude?: number;

  @Prop()
  longitude?: number;

  @Prop({ default: false })
  isSelfRegistered: boolean;

  @Prop({ default: false, name: 'isDistributorPaid' })
  isPartnerPaid: boolean;

  @Prop({ unique: true, sparse: true })
  partnerCode?: string;

  @Prop({ sparse: true })
  referredByPartnerCode?: string;

<<<<<<< Updated upstream
=======
  /** Representative partner codes linked for operational support without re-parenting. */
  @Prop({ type: [String], default: [] })
  operationalRepresentativeCodes?: string[];

  /** Representative who invited/added this Representative, or Partner Development Rep for a shop (role-dependent). */
  @Prop({ sparse: true })
  partnerDevelopmentRepresentativeCode?: string;

  /** Shop Introduction Representative — assigned once at shop create. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  shopIntroductionRepresentativeId?: MongooseSchema.Types.ObjectId;

  @Prop({ sparse: true })
  shopIntroductionRepresentativeCode?: string;

  /** Partner Development Representative for this shop — assigned once at shop create. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  partnerDevelopmentRepresentativeId?: MongooseSchema.Types.ObjectId;

  /** Operational Support Representative for this shop — assigned once at shop create. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  operationalSupportRepresentativeId?: MongooseSchema.Types.ObjectId;

  @Prop({ sparse: true })
  operationalSupportRepresentativeCode?: string;

  /** True after Partner Development commission was paid on first successful order. */
  @Prop({ default: false })
  partnerDevelopmentCommissionPaid?: boolean;

>>>>>>> Stashed changes
  @Prop()
  couponCode?: string;

  @Prop()
  certificationVideoUrl?: string;

  @Prop({ default: false })
  isTrainingComplete: boolean;

  @Prop({ default: false })
  isCertified: boolean;

  @Prop({ default: false })
  isVisibleOnMap: boolean;

  @Prop()
  stripeSessionId?: string;

  @Prop()
  website?: string;

  @Prop()
  facebook?: string;

  @Prop()
  instagram?: string;

  @Prop()
  youtube?: string;

  @Prop()
  tiktok?: string;

  @Prop()
  linkedin?: string;

  @Prop({ default: false })
  hasSeenWelcomePopup: boolean;

  @Prop()
  profileImage?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  blockedBy?: MongooseSchema.Types.ObjectId;

  @Prop()
  blockedReason?: string;

  @Prop({ unique: true, sparse: true })
  certificateNumber?: number;
}


export const UserSchema = SchemaFactory.createForClass(User);
