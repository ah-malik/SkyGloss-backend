import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsMongoId,
} from 'class-validator';

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

  /**
   * Admin-only: when newly assigning Operational Support, only these order IDs
   * receive the OSP commission line. Presence of this array (including empty)
   * suppresses automatic stamp-all-empty-orders recalculation for this update.
   */
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  linkOperationalSupportOrderIds?: string[];

  /**
   * Admin-only: when newly assigning Shop Introduction Partner, only these
   * order IDs receive the Shop Introduction commission line. Presence of this
   * array (including empty) suppresses automatic stamp-all-empty-orders.
   */
  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  linkShopIntroductionOrderIds?: string[];
}
