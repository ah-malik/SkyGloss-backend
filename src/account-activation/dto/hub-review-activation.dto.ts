import { IsIn, IsOptional, IsString } from 'class-validator';

export class HubReviewActivationDto {
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  note?: string;
}
