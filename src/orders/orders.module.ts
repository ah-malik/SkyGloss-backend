import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersSchedulerService } from './orders-scheduler.service';
import { Order, OrderSchema } from './entities/order.entity';
import {
  DuplicateInvoice,
  DuplicateInvoiceSchema,
} from './entities/duplicate-invoice.entity';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { ProductGroup, ProductGroupSchema } from '../product-groups/entities/product-group.entity';
import { RegistrationFeesModule } from '../registration-fees/registration-fees.module';
import { PdfModule } from '../pdf/pdf.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ProductsModule } from '../products/products.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: DuplicateInvoice.name, schema: DuplicateInvoiceSchema },
      { name: ProductGroup.name, schema: ProductGroupSchema }
    ]),
    ConfigModule,
    UsersModule,
    MailModule,
    RegistrationFeesModule,
    forwardRef(() => PdfModule),
    ExchangeRatesModule,
    CouponsModule,
    PayoutsModule,
    ProductsModule,
    InventoryModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersSchedulerService],
  exports: [OrdersService],
})
export class OrdersModule { }
