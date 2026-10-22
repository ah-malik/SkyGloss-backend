import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const CERTIFICATION_KIT_MAX_ITEMS = 30;
export const CERTIFICATION_KIT_MAX_QUANTITY = 99;

export class CertificationKitItemDto {
  @IsMongoId()
  productId: string;

  @IsString()
  @MaxLength(100)
  size: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CERTIFICATION_KIT_MAX_QUANTITY)
  quantity: number;
}

export class SaveCertificationKitDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'The kit needs at least one product.' })
  @ArrayMaxSize(CERTIFICATION_KIT_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CertificationKitItemDto)
  items: CertificationKitItemDto[];

  @IsBoolean()
  freeShipping: boolean;

  @IsBoolean()
  trainingIncluded: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  trainingPrice?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100, { message: 'The discount can’t be more than 100%.' })
  discountPercent: number;
}

export class ReviewCertificationKitDto {
  /** `savedAt` of the version the Admin reviewed (guards against approving a newer edit). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  savedAt?: string;
}

export class RejectCertificationKitDto extends ReviewCertificationKitDto {
  @IsString()
  @MinLength(3, { message: 'Tell the Hub or Distributor what to change.' })
  @MaxLength(1000)
  note: string;
}
