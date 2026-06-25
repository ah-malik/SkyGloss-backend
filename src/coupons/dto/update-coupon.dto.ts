import { PartialType } from '@nestjs/mapped-types';
import { CreateCouponDto } from './create-coupon.dto';
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateCouponDto extends PartialType(CreateCouponDto) {
  @IsBoolean()
  @IsOptional()
  declare isActive?: boolean;

  @IsDateString()
  @IsOptional()
  declare expiresAt?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  declare maxUses?: number;

  @IsString()
  @IsOptional()
  declare description?: string;
}
