import { IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @IsPositive()
  @Min(1)
  amount: number;
}

export class ReviewWithdrawalDto {
  action: 'approve' | 'reject';

  @IsOptional()
  note?: string;
}
