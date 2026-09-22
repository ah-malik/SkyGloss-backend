import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CalculateFedexRatesDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(150)
  weight: number;

  @IsOptional()
  @IsIn(['LB', 'KG'])
  weightUnits?: 'LB' | 'KG';

  /** Optional Hub origin ZIP override when Hub profile has no zipCode. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  originZipCode?: string;

  /** Optional destination ZIP override when shipping address has no zipCode. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  destinationZipCode?: string;
}
