import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Max, Min, NotEquals } from 'class-validator';
import { INVENTORY_MAX_QUANTITY } from '../inventory.constants';

export class UpdateProductInventoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INVENTORY_MAX_QUANTITY)
  stock?: number;
}

export class AdjustProductInventoryDto {
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  @Min(-INVENTORY_MAX_QUANTITY)
  @Max(INVENTORY_MAX_QUANTITY)
  delta: number;
}

export class ProductInventoryProductParamDto {
  @IsMongoId()
  productId: string;
}
