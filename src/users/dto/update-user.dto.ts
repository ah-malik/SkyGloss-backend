import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsString, IsOptional } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsString()
  @IsOptional()
  refreshTokenHash?: string;

  @IsString()
  @IsOptional()
  stripeSessionId?: string;

  @IsString()
  @IsOptional()
  blockedBy?: string;

  @IsString()
  @IsOptional()
  blockedReason?: string;
}
