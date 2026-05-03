import { IsString, IsArray, IsNumber, IsBoolean, IsOptional } from 'class-validator';

export class CreateRegistrationFeeGroupDto {
  @IsString()
  name: string;

  @IsArray()
  @IsString({ each: true })
  countries: string[];

  @IsNumber()
  feeAmount: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateRegistrationFeeGroupDto extends CreateRegistrationFeeGroupDto {}
