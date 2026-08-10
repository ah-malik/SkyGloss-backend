import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UsersService } from '../../users/users.service';
import {
  readAccessTokenFromCookies,
  resolveAuthCookieScope,
} from '../auth-cookies';

function extractAccessToken(req: Request): string | null {
  const scope = resolveAuthCookieScope(req);
  const fromCookie = readAccessTokenFromCookies(
    (req as any)?.cookies,
    scope,
  );
  if (fromCookie) return fromCookie;
  return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') as string,
    });
  }

  async validate(payload: any) {
    if (!payload.sub) {
      throw new UnauthorizedException();
    }
    // Reject refresh tokens if presented as access credentials
    if (payload.typ === 'refresh') {
      throw new UnauthorizedException('Invalid access token');
    }
    const user = await this.usersService.findOneForAuth(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (user.status === 'blocked') {
      throw new UnauthorizedException('Account is blocked');
    }
    return user;
  }
}
