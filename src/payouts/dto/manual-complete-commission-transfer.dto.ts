import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ManualCompleteCommissionTransferDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
