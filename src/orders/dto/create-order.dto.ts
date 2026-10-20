import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsString()
  @IsNotEmpty()
  product: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  size: string;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @IsString()
  @IsOptional()
  orderType?: 'unit' | 'case';

  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsString()
  @IsOptional()
  image: string;

  @IsString()
  @IsOptional()
  currency?: string;
}

class ShippingAddressDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  companyName: string;

  /** Required unless the order is a Hub pickup (checked in the service). */
  @IsString()
  @IsOptional()
  address: string;

  @IsString()
  @IsOptional()
  address2?: string;

  /** Required unless the order is a Hub pickup (checked in the service). */
  @IsString()
  @IsOptional()
  city: string;

  /** Required unless the order is a Hub pickup (checked in the service). */
  @IsString()
  @IsOptional()
  state: string;

  /** Required unless the order is a Hub pickup (checked in the service). */
  @IsString()
  @IsOptional()
  zipCode: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsOptional()
  taxId?: string;

  @IsBoolean()
  @IsOptional()
  noVatId?: boolean;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress: ShippingAddressDto;

  @IsString()
  @IsOptional()
  couponCode?: string;

  /** Shop collects the order from its Hub: shipping is free and the Hub address is used. */
  @IsBoolean()
  @IsOptional()
  isPickup?: boolean;
}
