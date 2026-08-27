import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateStripeWisePayoutDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @MaxLength(8)
  currency: string;

  @IsOptional()
  @IsIn(['global', 'usa'])
  stripeAccountKey?: 'global' | 'usa';

  /** Must be true. Payout is not created until the admin confirms. */
  @IsBoolean()
  confirmed: boolean;

  @IsUUID('4')
  idempotencyKey: string;
}
