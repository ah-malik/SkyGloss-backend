import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  CouponDiscountType,
  CouponUsageType,
} from '../entities/coupon.entity';

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsEnum(CouponUsageType)
  usageType: CouponUsageType;

  @IsEnum(CouponDiscountType)
  discountType: CouponDiscountType;

  @IsNumber()
  @Min(0)
  discountValue: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsString()
  @IsOptional()
  description?: string;
}
