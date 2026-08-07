import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AccessCodesModule } from './access-codes/access-codes.module';
import { ShopRequestsModule } from './shop-requests/shop-requests.module';
import { AuthModule } from './auth/auth.module';
import { CertificationsModule } from './certifications/certifications.module';
import { ProductsModule } from './products/products.module';
import { SeedService } from './seed.service';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { OrdersModule } from './orders/orders.module';
import { SupportModule } from './support/support.module';
import { ChatModule } from './chat/chat.module';
import { ProductGroupsModule } from './product-groups/product-groups.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PdfModule } from './pdf/pdf.module';
import { RegistrationFeesModule } from './registration-fees/registration-fees.module';
import { CouponsModule } from './coupons/coupons.module';
import { EmailSettingsModule } from './email-settings/email-settings.module';
import { PayoutsModule } from './payouts/payouts.module';
import { ApiControlModule } from './api-control/api-control.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    HealthModule,
    UsersModule,
    AccessCodesModule,
    ShopRequestsModule,
    AuthModule,
    CertificationsModule,
    ProductsModule,
    CloudinaryModule,
    OrdersModule,
    SupportModule,
    ChatModule,
    ProductGroupsModule,
    NotificationsModule,
    PdfModule,
    RegistrationFeesModule,
    CouponsModule,
    EmailSettingsModule,
    PayoutsModule,
    ApiControlModule,
  ],
  controllers: [AppController],
  providers: [AppService, SeedService],
})
export class AppModule {}
