import {
  IsString,
  IsArray,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

class ProductSizeDto {
  @IsString()
  size: string;

  @IsNumber()
  price: number;
}

class ProductItemDto {
  @IsString()
  productId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSizeDto)
  sizes: ProductSizeDto[];
}

export class CreateProductGroupDto {
  @IsString()
  name: string;

  @IsString()
  currency: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductItemDto)
  products: ProductItemDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[];

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateProductGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductItemDto)
  products?: ProductItemDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[];

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** Move a country into a pricing group (or clear explicit assignment). */
export class AssignCountryDto {
  @IsString()
  country: string;

  /** Target product group id. Omit / null to remove explicit country assignment. */
  @IsOptional()
  @IsString()
  productGroupId?: string | null;
}
