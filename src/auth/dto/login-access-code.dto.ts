import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class LoginAccessCodeDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  accessCode: string;

  @IsString()
  @IsNotEmpty()
  country: string;
}
