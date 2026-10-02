import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetupPasswordDto {
  @ApiProperty({ example: 'your-setup-token' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'newpassword123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
