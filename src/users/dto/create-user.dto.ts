import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole, UserStatus } from '../entities/user.entity';

export class CreateUserDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsEnum(UserRole)
  @IsNotEmpty()
  role: UserRole;

  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  /** Hub territory countries (unique across Hubs). Required when creating a Hub. */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  countries?: string[];

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  shopName?: string;

  @IsString()
  @IsOptional()
  hearAboutUs?: string;

  @IsString()
  @IsOptional()
  hearAboutUsOther?: string;

  @IsString()
  @IsOptional()
  accessCode?: string;

  @IsString()
  @IsOptional()
  address: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsOptional()
  zipCode?: string;

  @IsString()
  @IsOptional()
  productGroup?: string;
  @IsString({ each: true })
  @IsOptional()
  completedCourses?: string[];

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsString()
  @IsOptional()
  partnerCode?: string;

  /** Shop Parent Link (Hub). Admin may set; otherwise resolved from country. */
  @IsString()
  @IsOptional()
  hubPartnerCode?: string;

  @IsString()
  @IsOptional()
  referredByPartnerCode?: string;

  @IsString()
  @IsOptional()
  couponCode?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  facebook?: string;

  @IsString()
  @IsOptional()
  instagram?: string;

  @IsString()
  @IsOptional()
  youtube?: string;

  @IsString()
  @IsOptional()
  tiktok?: string;

  @IsString()
  @IsOptional()
  linkedin?: string;

  @IsBoolean()
  @IsOptional()
  isPartnerPaid?: boolean;

  @IsBoolean()
  @IsOptional()
  isSelfRegistered?: boolean;

  @IsBoolean()
  @IsOptional()
  isPartnerCertified?: boolean;

  @IsBoolean()
  @IsOptional()
  isCertified?: boolean;

  @IsBoolean()
  @IsOptional()
  isVisibleOnMap?: boolean;

  @IsBoolean()
  @IsOptional()
  hasSeenWelcomePopup?: boolean;

  @IsString()
  @IsOptional()
  profileImage?: string;

  /** UI language preference (e.g. "es", "en"). */
  @IsString()
  @IsOptional()
  preferredLanguage?: string;

  /** Shop Intro % override for Representative or Promoter (default 10). */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  customCommissionRate?: number | null;

  /** Partner Intro % for this user's Partner Intro (default 5). */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  partnerIntroRatePercent?: number | null;

  /**
   * Legacy FO rate field aliases (still accepted).
   * Prefer customCommissionRate / partnerIntroRatePercent.
   */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  firstOrderShopIntroductionRate?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  firstOrderPartnerDevelopmentRate?: number;

  /**
   * Optional Partner Intro network ID.
   * REP create: another Representative.
   * Promoter create (Hub parent): another Promoter under the same Hub.
   * When Promoter parent is REP/Promoter, that parent becomes Partner Intro automatically.
   */
  @IsString()
  @IsOptional()
  partnerIntroCode?: string;

  /**
   * Operational Support Representative for a shop (Admin assign — REP only).
   * Empty / null clears the assignment (Unassigned).
   */
  @IsString()
  @IsOptional()
  operationalSupportRepresentativeCode?: string | null;

  /** Per-shop Shop Intro % override (default 10). */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  shopIntroductionFirstOrderRatePercent?: number | null;

  /** Per-shop Partner Intro % override (default 5). */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  partnerDevelopmentRatePercent?: number | null;

  /** Per-shop Operational Support % override (default 10). */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  operationalSupportRatePercent?: number | null;
}
