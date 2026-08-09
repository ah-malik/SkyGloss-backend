import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  MASTER_PARTNER = 'master_partner',
  REGIONAL_PARTNER = 'regional_partner',
  /** @deprecated Sub-Promoter role removed — migrated to REGIONAL_PARTNER (Promoter Network). Kept for legacy DB reads only. */
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
  /**
   * Email is unique per role (compound index below), not globally.
   * Same email may exist once as a shop and once as a partner-network role
   * (different passwords / documents).
   */
  @Prop()
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
        /** Shop Introduction % of order $ (default 10). */
        firstOrderShopIntroductionRate: { type: Number, default: 10 },
        /** Partner Intro % of order $ (default 5). */
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
   * Structured operational Promoter links (keeps codes array in sync).
   */
  @Prop({
    type: [
      {
        partnerCode: { type: String, required: true },
        linkedAt: { type: Date, required: true },
        /** Shop Introduction % of order $ (default 10). */
        firstOrderShopIntroductionRate: { type: Number, default: 10 },
        /** Partner Intro % of order $ (default 5). */
        firstOrderPartnerDevelopmentRate: { type: Number, default: 5 },
      },
    ],
    default: [],
  })
  operationalPromoterLinks?: Array<{
    partnerCode: string;
    linkedAt: Date;
    firstOrderShopIntroductionRate?: number;
    firstOrderPartnerDevelopmentRate?: number;
  }>;

  /**
   * Promoter who invited/added this Promoter (Partner Development parent), OR —
   * when set on a shop — the Partner Development Promoter for Promoter-Network FO.
   */
  @Prop({ sparse: true })
  partnerDevelopmentPromoterCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  partnerDevelopmentPromoterId?: MongooseSchema.Types.ObjectId;

  /** Shop Introduction Promoter — assigned for Promoter-Network FO shops. */
  @Prop({ sparse: true })
  shopIntroductionPromoterCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  shopIntroductionPromoterId?: MongooseSchema.Types.ObjectId;

  /** True when shop joined child Promoter AFTER Promoter Add-to-Network link. */
  @Prop()
  partnerDevelopmentPromoterEligible?: boolean;

  @Prop()
  partnerDevelopmentPromoterRatePercent?: number;

  @Prop()
  shopIntroductionPromoterFirstOrderRatePercent?: number;

  @Prop({ default: false })
  partnerDevelopmentPromoterCommissionPaid?: boolean;

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

  /**
   * Operational Support Representative for this shop.
   * Starts Unassigned; Admin later assigns a REP only.
   */
  @Prop({ sparse: true })
  operationalSupportRepresentativeCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  operationalSupportRepresentativeId?: MongooseSchema.Types.ObjectId;

  /**
   * When true, Partner Intro (Partner Development) is paid on every order
   * for this shop (5% of order $ by default).
   */
  @Prop()
  partnerDevelopmentEligible?: boolean;

  /** Partner Intro % of order $ (default 5). */
  @Prop()
  partnerDevelopmentRatePercent?: number;

  /** Shop Introduction % of order $ (default 10). Admin may override per shop. */
  @Prop()
  shopIntroductionFirstOrderRatePercent?: number;

  /** Operational Support % of order $ (default 10). Admin may override per shop. */
  @Prop({ min: 0, max: 100 })
  operationalSupportRatePercent?: number;

  /**
   * Legacy FO lock flag — no longer gates Partner Intro (paid every order).
   * Kept for historical data compatibility.
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

  /** UI language preference (Google Translate code, e.g. "es", "en"). */
  @Prop()
  preferredLanguage?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  blockedBy?: MongooseSchema.Types.ObjectId;

  @Prop()
  blockedReason?: string;

  @Prop({ unique: true, sparse: true })
  certificateNumber?: number;

  /**
   * Shop Intro % override for Representative / Promoter (default 10).
   * Omit / null → role default.
   */
  @Prop({ min: 0, max: 100 })
  customCommissionRate?: number;

  /**
   * Partner Intro % paid to this user's Partner Intro on their shops (default 5).
   * Omit / null → default 5%.
   */
  @Prop({ min: 0, max: 100 })
  partnerIntroRatePercent?: number;
}


export const UserSchema = SchemaFactory.createForClass(User);

// One email may map to multiple portal accounts (shop vs partner), but not
// two users with the same email AND the same role.
UserSchema.index(
  { email: 1, role: 1 },
  {
    unique: true,
    sparse: true,
    name: 'email_1_role_1',
  },
);

// Hot-path compound indexes (network tree, maps, admin lists).
// Do NOT re-declare single-field indexes already created via @Prop({ sparse/unique }).
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ role: 1, createdAt: -1 });
UserSchema.index({ role: 1, country: 1 });
UserSchema.index({ operationalRepresentativeCodes: 1 });
UserSchema.index({ operationalPromoterCodes: 1 });
UserSchema.index({ isVisibleOnMap: 1, role: 1, status: 1 });
UserSchema.index({ productGroup: 1 });
