import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductInventoryService } from './product-inventory.service';
import { Inventory, InventorySchema } from './entities/inventory.entity';
import {
  ProductInventory,
  ProductInventorySchema,
} from './entities/product-inventory.entity';
import { ProductsModule } from '../products/products.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Inventory.name, schema: InventorySchema },
      { name: ProductInventory.name, schema: ProductInventorySchema },
    ]),
    forwardRef(() => ProductsModule),
    UsersModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService, ProductInventoryService],
  exports: [InventoryService, ProductInventoryService],
})
export class InventoryModule {}
