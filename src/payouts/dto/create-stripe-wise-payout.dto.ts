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
  @IsIn(['global', 'usa', 'europe'])
  stripeAccountKey?: 'global' | 'usa' | 'europe';

  /** payments_balance = classic Stripe payout; financial_account = FA → Wise outbound. */
  @IsOptional()
  @IsIn(['payments_balance', 'financial_account'])
  sourceType?: 'payments_balance' | 'financial_account';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  financialAccountId?: string;

  /** Must be true. Payout is not created until the admin confirms. */
  @IsBoolean()
  confirmed: boolean;

  @IsUUID('4')
  idempotencyKey: string;
}
