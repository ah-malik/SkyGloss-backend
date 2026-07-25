import { IsString, IsNotEmpty, MinLength, IsIn } from 'class-validator';

export type AuthPortal = 'shop' | 'partner';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  /** Which login page the request came from — scopes role lookup. */
  @IsString()
  @IsIn(['shop', 'partner'])
  portal: AuthPortal;
}
