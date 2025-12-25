import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { UserRole } from '../../users/entities/user.entity';

export class CreateAccessCodeDto {
  @IsEnum([UserRole.TECHNICIAN, UserRole.SHOP])
  targetRole: UserRole;

  @IsNumber()
  @IsOptional()
  expiresInDays?: number;
}
