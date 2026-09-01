import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DuplicateInvoiceItemDto {
  @IsString()
  product: string;

  @IsString()
  name: string;

  @IsString()
  size: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  orderType?: 'unit' | 'case';

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  image?: string;
}

export class CreateDuplicateInvoiceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DuplicateInvoiceItemDto)
  items: DuplicateInvoiceItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFee?: number;
}
