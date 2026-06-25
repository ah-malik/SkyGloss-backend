import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsString()
  @IsOptional()
  currency?: string;
}
