import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsArray,
  IsOptional,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SpecificationDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}

class SizeDto {
  @IsString()
  @IsNotEmpty()
  size: string;

  @IsNumber()
  @IsNotEmpty()
  price: number;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsNumber()
  @IsOptional()
  stock?: number;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  images: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  shopImages?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @IsString()
  @IsOptional()
  specifications?: string;

  @IsString()
  @IsOptional()
  technicalSpecifications?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  applicationGuide?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeDto)
  @IsOptional()
  sizes?: SizeDto[];

  @IsString()
  @IsOptional()
  technicalSheetUrl?: string;

  @IsString()
  @IsOptional()
  sdsUrl?: string;

  @IsString()
  @IsOptional()
  sdsUrlDutch?: string;

  @IsString()
  @IsOptional()
  applicationGuideUrl?: string;

  @IsString()
  @IsOptional()
  @IsEnum(['published', 'draft'])
  status?: string;

  @IsString()
  @IsOptional()
  @IsEnum(['certified_shop', 'all'])
  targetAudience?: string;

  @IsNumber()
  @IsOptional()
  displayOrder?: number;
}
