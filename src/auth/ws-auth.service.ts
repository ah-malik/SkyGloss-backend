import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { UserDocument, UserRole } from '../users/entities/user.entity';
import {
  AuthCookieScope,
  readAccessTokenFromCookies,
  resolveCookieNames,
} from './auth-cookies';
import { isPartnerNetworkRole } from '../common/role-labels';

export type WsAuthedUser = {
  id: string;
  email?: string;
  role: UserRole | string;
  firstName?: string;
  lastName?: string;
  status?: string;
};

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  parseCookies(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) return {};
    return cookieHeader.split(';').reduce(
      (acc, part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return acc;
        const key = part.slice(0, idx).trim();
        const value = decodeURIComponent(part.slice(idx + 1).trim());
        if (key) acc[key] = value;
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  extractToken(client: Socket): string | null {
    const auth = (client.handshake.auth as any) || {};
    const authToken = auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7).trim();
    }

    const cookies = this.parseCookies(client.handshake.headers?.cookie);
    const clientApp = String(auth?.clientApp || '').toLowerCase();
    const preferredScope: AuthCookieScope =
      clientApp === 'admin' ? 'admin' : 'portal';
    const preferred = readAccessTokenFromCookies(cookies, preferredScope);
    if (preferred) return preferred;

    // Fallback: other scoped cookie, then legacy (migration).
    const otherScope: AuthCookieScope =
      preferredScope === 'admin' ? 'portal' : 'admin';
    const other = cookies[resolveCookieNames(otherScope).access];
    if (typeof other === 'string' && other.length > 0) return other;

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }

    return null;
  }

  async authenticateSocket(client: Socket): Promise<WsAuthedUser | null> {
    const token = this.extractToken(client);
    if (!token) return null;

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as { sub?: string; typ?: string };

      if (!payload?.sub || payload.typ === 'refresh') {
        return null;
      }

      const user = await this.usersService.findOneForAuth(payload.sub);
      if (!user || user.status === 'blocked') {
        return null;
      }

      return this.toWsUser(user);
    } catch (err) {
      this.logger.debug(`Socket auth failed for ${client.id}: ${String(err)}`);
      return null;
    }
  }

  toWsUser(user: UserDocument | any): WsAuthedUser {
    const id = (user._id || user.id).toString();
    return {
      id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
    };
  }

  displayName(user: WsAuthedUser): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name || user.email || 'User';
  }

  /** Admin may view any chat room for monitoring; partners cannot. */
  canAccessOtherUserRooms(role: string): boolean {
    return role === UserRole.ADMIN;
  }

  isAdmin(role: string): boolean {
    return role === UserRole.ADMIN;
  }

  /** Chat "support side" sender (admin panel + partners). */
  resolveSenderType(role: string): 'admin' | 'user' {
    if (role === UserRole.ADMIN || isPartnerNetworkRole(role)) {
      return 'admin';
    }
    return 'user';
  }
}
