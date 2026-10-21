import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err, user) {
    if (err || !user) {
      return null;
    }
    return user;
  }
}

/**
 * Like OptionalJwtAuthGuard, but a presented token that is expired/invalid
 * returns 401 (so the client refreshes) instead of silently treating the
 * viewer as anonymous. Used where anonymous means different data, e.g.
 * catalog prices instead of the viewer's Pricing Group.
 */
@Injectable()
export class StrictOptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err, user, info) {
    if (user && !err) return user;
    const tokenRejected =
      !!err ||
      ['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'].includes(
        info?.name,
      );
    if (tokenRejected) {
      throw new UnauthorizedException('Session expired');
    }
    return null;
  }
}
