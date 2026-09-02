import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class DuplicateInvoiceItemDto {
  @IsString()
  product: string;

  @IsString()
  name: string;

  @IsString()
  size: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  orderType?: 'unit' | 'case';

  @Type(() => Number)
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? value
      : Number(value),
  )
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
  @Type(() => Number)
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined
      ? undefined
      : Number(value),
  )
  @IsNumber()
  @Min(0)
  shippingFee?: number;
}
