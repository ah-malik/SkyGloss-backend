import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductGroupsController } from './product-groups.controller';
import { ProductGroupsService } from './product-groups.service';
import { ProductGroup, ProductGroupSchema } from './entities/product-group.entity';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: ProductGroup.name, schema: ProductGroupSchema }]),
    ],
    controllers: [ProductGroupsController],
    providers: [ProductGroupsService],
    exports: [ProductGroupsService],
})
export class ProductGroupsModule { }
