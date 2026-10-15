import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminActivateDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
