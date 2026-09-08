import { IsOptional, IsString } from 'class-validator';

export class ValidateVatDto {
  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  taxId?: string;
}
