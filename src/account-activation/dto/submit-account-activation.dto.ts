import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class SubmitAccountActivationDto {
  @IsBoolean()
  agreementAccepted: boolean;

  /** Required for Representative / Promoter. Optional for Distributor. */
  @IsOptional()
  @IsString()
  @ValidateIf((o) => !!o.accountHolderName || !!o.country)
  @IsNotEmpty()
  accountHolderName?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

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

  @IsOptional()
  @IsString()
  @ValidateIf((o) => !!o.accountHolderName || !!o.country)
  @IsNotEmpty()
  country?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}
