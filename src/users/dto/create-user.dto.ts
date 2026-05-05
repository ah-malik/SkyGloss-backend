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
} from 'class-validator';
import { UserRole, UserStatus } from '../entities/user.entity';

export class CreateUserDto {
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
}
