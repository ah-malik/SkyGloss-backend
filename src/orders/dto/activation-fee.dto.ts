import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ActivationFeeDto {
  @IsString()
  @IsOptional()
  taxId?: string;

  @IsBoolean()
  @IsOptional()
  noVatId?: boolean;

  /** Shop registration coupon entered in the payment modal (not on Stripe Checkout). */
  @IsString()
  @IsOptional()
  couponCode?: string;
}
