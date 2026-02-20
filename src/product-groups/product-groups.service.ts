import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductGroup, ProductGroupDocument } from './entities/product-group.entity';
import { CreateProductGroupDto, UpdateProductGroupDto } from './dto/product-group.dto';

@Injectable()
export class ProductGroupsService {
    constructor(
        @InjectModel(ProductGroup.name)
        private productGroupModel: Model<ProductGroupDocument>,
    ) { }

    async create(createProductGroupDto: CreateProductGroupDto): Promise<ProductGroup> {
        const createdGroup = new this.productGroupModel(createProductGroupDto);
        return createdGroup.save();
    }

    async findAll(): Promise<ProductGroup[]> {
        return this.productGroupModel.find().populate('products.productId').exec();
    }

    async findOne(id: string): Promise<ProductGroup> {
        const group = await this.productGroupModel.findById(id).populate('products.productId').exec();
        if (!group) {
            throw new NotFoundException(`Product Group with ID ${id} not found`);
        }
        return group;
    }

    async update(id: string, updateProductGroupDto: UpdateProductGroupDto): Promise<ProductGroup> {
        const existingGroup = await this.productGroupModel
            .findByIdAndUpdate(id, updateProductGroupDto, { new: true })
            .exec();
        if (!existingGroup) {
            throw new NotFoundException(`Product Group with ID ${id} not found`);
        }
        return existingGroup;
    }

    async remove(id: string): Promise<any> {
        const result = await this.productGroupModel.findByIdAndDelete(id).exec();
        if (!result) {
            throw new NotFoundException(`Product Group with ID ${id} not found`);
        }
        return result;
    }
}
