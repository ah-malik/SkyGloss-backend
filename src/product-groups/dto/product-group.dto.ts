import {
  IsString,
  IsArray,
  IsOptional,
  IsBoolean,
  ValidateNested,
  IsNumber,
  Min,
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

class DValuePriceDto {
  @IsString()
  productId: string;

  @IsString()
  size: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;
}

/** Replace a group's D-Value prices. Omitted product sizes have no D-Value price. */
export class UpdateDValuePricesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DValuePriceDto)
  prices: DValuePriceDto[];
}
