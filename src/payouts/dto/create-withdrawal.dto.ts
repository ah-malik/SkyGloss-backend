import { IsMongoId, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @IsPositive()
  @Min(1)
  amount: number;

  /** Hub whose shop commissions should be withdrawn (required when earnings span multiple hubs). */
  @IsOptional()
  @IsMongoId()
  hubId?: string;
}

export class ReviewWithdrawalDto {
  action: 'approve' | 'reject';

  @IsOptional()
  note?: string;
}
