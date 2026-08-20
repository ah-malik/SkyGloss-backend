import { IsOptional, IsString } from 'class-validator';

export class ActivationFeeDto {
  @IsOptional()
  @IsString()
  couponCode?: string;
}
