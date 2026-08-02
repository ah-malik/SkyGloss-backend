import { IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '../entities/order.entity';

export class AdminTestOrderItemDto {
  @IsMongoId()
  productId: string;

  @IsString()
  @IsNotEmpty()
  size: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsIn(['unit', 'case'])
  orderType?: 'unit' | 'case';
}

export class CreateAdminTestOrderDto {
  @IsMongoId()
  shopUserId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminTestOrderItemDto)
  items: AdminTestOrderItemDto[];

  @IsOptional()
  @IsIn([OrderStatus.PENDING, OrderStatus.PAID])
  initialStatus?: OrderStatus.PENDING | OrderStatus.PAID;

  @IsOptional()
  @IsBoolean()
  markShippedImmediately?: boolean;

  @IsOptional()
  @IsString()
  trackingId?: string;

  @IsOptional()
  @IsString()
  shippingCompany?: string;
}
