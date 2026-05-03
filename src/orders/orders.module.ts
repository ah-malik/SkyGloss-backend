import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order, OrderSchema } from './entities/order.entity';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { ProductGroup, ProductGroupSchema } from '../product-groups/entities/product-group.entity';
import { RegistrationFeesModule } from '../registration-fees/registration-fees.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: ProductGroup.name, schema: ProductGroupSchema }
    ]),
    ConfigModule,
    UsersModule,
    MailModule,
    RegistrationFeesModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule { }
