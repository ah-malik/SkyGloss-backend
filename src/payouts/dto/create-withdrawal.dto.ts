import { IsMongoId, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @IsPositive()
  @Min(1)
  amount: number;

  /** Parent Hub that will review this withdrawal (usually auto-selected). */
  @IsOptional()
  @IsMongoId()
  hubId?: string;
}

export class ReviewWithdrawalDto {
  action: 'approve' | 'reject';

  @IsOptional()
  note?: string;
}
