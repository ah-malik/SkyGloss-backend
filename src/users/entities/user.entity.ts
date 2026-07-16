import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  MASTER_PARTNER = 'master_partner',
  REGIONAL_PARTNER = 'regional_partner',
  SUB_PROMOTER = 'sub_promoter',
  DISTRIBUTOR = 'distributor',
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

  /** Representative partner codes linked for operational support without re-parenting. */
  @Prop({ type: [String], default: [] })
  operationalRepresentativeCodes?: string[];

  /**
 * Structured operational Rep links (keeps codes array in sync for compatibility).
 * First Order rates apply only to shops created after linkedAt.
 */
  @Prop({
    type: [
      {
        partnerCode: { type: String, required: true },
        linkedAt: { type: Date, required: true },
        /** REP2 Shop Introduction % on eligible shops' first order (default 10). */
        firstOrderShopIntroductionRate: { type: Number, default: 10 },
        /** Parent (REP1) Partner Development % on eligible shops' first order (default 5). */
        firstOrderPartnerDevelopmentRate: { type: Number, default: 5 },
      },
    ],
    default: [],
  })
  operationalRepresentativeLinks?: Array<{
    partnerCode: string;
    linkedAt: Date;
    firstOrderShopIntroductionRate?: number;
    firstOrderPartnerDevelopmentRate?: number;
  }>;

  /** Main Promoter partner codes linked for operational visibility without re-parenting. */
  @Prop({ type: [String], default: [] })
  operationalPromoterCodes?: string[];

  /**
   * Representative who invited/added this Representative (their Partner
   * Development Representative), OR — when set on a shop — the Partner
   * Development Representative for that shop (copied from the shop
   * introduction rep at shop create time). Shared field, role-dependent.
   */
  @Prop({ sparse: true })
  partnerDevelopmentRepresentativeCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  partnerDevelopmentRepresentativeId?: MongooseSchema.Types.ObjectId;

  /** Shop Introduction Representative — assigned once at shop create, immutable. */
  @Prop({ sparse: true })
  shopIntroductionRepresentativeCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  shopIntroductionRepresentativeId?: MongooseSchema.Types.ObjectId;

  /** Operational Support Representative for this shop — assigned once at shop create. */
  @Prop({ sparse: true })
  operationalSupportRepresentativeCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  operationalSupportRepresentativeId?: MongooseSchema.Types.ObjectId;

  /**
   * When true, this shop is eligible for First Order Partner Development split
   * (shop joined the intro Rep AFTER that Rep was Add-to-Network linked).
   * Unset/false until evaluated at assignment time — do not default to false
   * or new shops are incorrectly blocked from FO eligibility checks.
   */
  @Prop()
  partnerDevelopmentEligible?: boolean;

  /**
   * Frozen Partner Development % for this shop's first-order split (parent share).
   * Copied from the operational link at shop assignment time.
   */
  @Prop()
  partnerDevelopmentRatePercent?: number;

  /**
   * Frozen Shop Introduction % for this shop's first-order split (child Rep share).
   * Copied from the operational link at shop assignment time (default 10).
   */
  @Prop()
  shopIntroductionFirstOrderRatePercent?: number;

  /**
   * True once this shop's one-time Partner Development commission has
   * been paid out (on the shop's first successful, non-registration order).
   * Shop-level flag — each eligible shop under a linked Rep pays Partner
   * Development independently.
   */
  @Prop({ default: false })
  partnerDevelopmentCommissionPaid?: boolean;

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

  /** Custom commission % for Representative / Promoter / Sub-Promoter. Omit for role default. */
  @Prop({ min: 0, max: 100 })
  customCommissionRate?: number;
}


export const UserSchema = SchemaFactory.createForClass(User);
