import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateStripeWiseDestinationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountHolderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  iban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  routingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  sortCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  swiftBic?: string;

  @IsOptional()
  @IsIn(['global', 'usa', 'europe'])
  stripeAccountKey?: 'global' | 'usa' | 'europe';

  @IsOptional()
  @IsBoolean()
  payoutToDefaultStripeBank?: boolean;
}
