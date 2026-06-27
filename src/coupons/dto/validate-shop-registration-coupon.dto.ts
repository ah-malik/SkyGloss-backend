import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ValidateShopRegistrationCouponDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  country?: string;
}
