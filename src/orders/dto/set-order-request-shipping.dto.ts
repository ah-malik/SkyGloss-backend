import { IsNumber, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SetOrderRequestShippingDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  shippingFee: number;
}
