import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
      inject: [ConfigService],
    }),
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
  ],
  controllers: [AppController],
  providers: [AppService, SeedService],
})
export class AppModule { }
