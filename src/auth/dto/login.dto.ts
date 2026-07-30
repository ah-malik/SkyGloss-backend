import { IsString, IsNotEmpty, MinLength, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export type AuthPortal = 'shop' | 'partner';

export class LoginDto {
  /** May be email or username; emails are normalized to lowercase. */
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
  })
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
