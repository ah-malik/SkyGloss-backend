import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderItemDto } from './create-order.dto';

/** Address fields that drive the rate; the rest of checkout may still be blank. */
class ShippingQuoteAddressDto {
  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  address2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  zipCode?: string;

  @IsString()
  @IsOptional()
  country?: string;
}

export class ShippingQuoteDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ValidateNested()
  @Type(() => ShippingQuoteAddressDto)
  @IsOptional()
  shippingAddress?: ShippingQuoteAddressDto;

  @IsBoolean()
  @IsOptional()
  isPickup?: boolean;
}
