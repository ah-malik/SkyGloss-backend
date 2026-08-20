import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min, NotEquals } from 'class-validator';
import {
  INVENTORY_ITEM_KEYS,
  INVENTORY_MAX_QUANTITY,
  InventoryItemKey,
} from '../inventory.constants';

export class UpdateInventoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INVENTORY_MAX_QUANTITY)
  bottlesAndPackaging?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INVENTORY_MAX_QUANTITY)
  boxes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INVENTORY_MAX_QUANTITY)
  labels?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INVENTORY_MAX_QUANTITY)
  components?: number;
}

export class AdjustInventoryDto {
  @IsIn([...INVENTORY_ITEM_KEYS])
  item: InventoryItemKey;

  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  @Min(-INVENTORY_MAX_QUANTITY)
  @Max(INVENTORY_MAX_QUANTITY)
  delta: number;
}
