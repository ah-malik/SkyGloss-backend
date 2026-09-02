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

export class CreatePaymentsToFaDto {
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

  @IsString()
  @MaxLength(120)
  financialAccountId: string;

  @IsBoolean()
  confirmed: boolean;

  @IsUUID('4')
  idempotencyKey: string;
}
