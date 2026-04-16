import { IsString, IsNotEmpty, MinLength, IsOptional } from 'class-validator';

export class LoginAccessCodeDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  accessCode: string;

  @IsString()
  @IsOptional()
  country?: string;
}
