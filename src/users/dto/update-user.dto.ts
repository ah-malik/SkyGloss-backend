import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  /**
   * Explicit so the update whitelist keeps this field.
   * Null clears the account discount.
   */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  partnerDiscountPercent?: number | null;

  @IsString()
  @IsOptional()
  refreshTokenHash?: string;

  @IsString()
  @IsOptional()
  stripeSessionId?: string;

  @IsString()
  @IsOptional()
  blockedBy?: string;

  @IsString()
  @IsOptional()
  blockedReason?: string;
}
