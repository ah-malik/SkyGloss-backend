import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateBankDetailsDto {
  @IsString()
  @IsNotEmpty()
  accountHolderName: string;

  @IsString()
  @IsNotEmpty()
  bankName: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  routingNumber?: string;

  @IsOptional()
  @IsString()
  sortCode?: string;

  @IsOptional()
  @IsString()
  swiftBic?: string;

  @IsOptional()
  @IsObject()
  extraDetails?: Record<string, string>;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsOptional()
  @IsString()
  currency?: string;
}
