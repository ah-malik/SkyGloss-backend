import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { AccessCodesModule } from '../access-codes/access-codes.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../mail/mail.module';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductGroupsModule } from '../product-groups/product-groups.module';
import { CouponsModule } from '../coupons/coupons.module';
import { RegistrationFeesModule } from '../registration-fees/registration-fees.module';

@Module({
  imports: [
    UsersModule,
    AccessCodesModule,
    OrdersModule,
    NotificationsModule,
    ProductGroupsModule,
    CouponsModule,
    RegistrationFeesModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRATION') ||
            '1d') as any,
        },
      }),
      inject: [ConfigService],
    }),
    MailModule,
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule { }
