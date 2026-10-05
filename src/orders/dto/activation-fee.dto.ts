import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ActivationFeeDto {
  @IsString()
  @IsOptional()
  taxId?: string;

  @IsBoolean()
  @IsOptional()
  noVatId?: boolean;
}
