import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  // Explicit so whitelist never drops these if PartialType metadata lags
  @IsString()
  @IsOptional()
  sdsAetherUrl?: string;

  @IsString()
  @IsOptional()
  sdsAetherUrlDutch?: string;
}
