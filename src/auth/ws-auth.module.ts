import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { WsAuthService } from './ws-auth.service';

/**
 * Lightweight JWT helper for Socket.IO gateways.
 * Kept separate from AuthModule to avoid circular imports with NotificationsModule.
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_ACCESS_EXPIRATION') ||
            configService.get<string>('JWT_EXPIRATION') ||
            '15m') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [WsAuthService],
  exports: [WsAuthService],
})
export class WsAuthModule {}
