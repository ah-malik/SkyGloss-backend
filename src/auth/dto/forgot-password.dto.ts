import { IsEmail, IsNotEmpty, IsString, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AuthPortal } from './login.dto';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'shop', enum: ['shop', 'partner'] })
  @IsString()
  @IsIn(['shop', 'partner'])
  portal: AuthPortal;
}
