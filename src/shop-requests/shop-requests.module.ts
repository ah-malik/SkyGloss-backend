import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShopRequestsService } from './shop-requests.service';
import { ShopRequestsController } from './shop-requests.controller';
import { ShopRequest, ShopRequestSchema } from './entities/shop-request.entity';
import { UsersModule } from '../users/users.module';
import { AccessCodesModule } from '../access-codes/access-codes.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShopRequest.name, schema: ShopRequestSchema },
    ]),
    UsersModule,
    AccessCodesModule,
  ],
  controllers: [ShopRequestsController],
  providers: [ShopRequestsService],
  exports: [ShopRequestsService],
})
export class ShopRequestsModule {}
