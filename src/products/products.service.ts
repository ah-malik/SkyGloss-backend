import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
    constructor(
        @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    ) { }

    async create(createProductDto: CreateProductDto): Promise<ProductDocument> {
        const createdProduct = new this.productModel(createProductDto);
        return createdProduct.save();
    }

    async findAll(status?: string, targetAudience?: string): Promise<ProductDocument[]> {
        const filter: any = {};

        if (status) {
            filter.status = status;
        }

        if (targetAudience) {
            filter.targetAudience = { $in: [targetAudience, 'all'] };
        }

        return this.productModel.find(filter).sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string): Promise<ProductDocument> {
        const product = await this.productModel.findById(id).exec();
        if (!product) {
            throw new NotFoundException(`Product with ID ${id} not found`);
        }
        return product;
    }

    async update(
        id: string,
        updateProductDto: UpdateProductDto,
    ): Promise<ProductDocument> {
        const updatedProduct = await this.productModel
            .findByIdAndUpdate(id, updateProductDto, { new: true })
            .exec();
        if (!updatedProduct) {
            throw new NotFoundException(`Product with ID ${id} not found`);
        }
        return updatedProduct;
    }

    async remove(id: string): Promise<ProductDocument> {
        const deletedProduct = await this.productModel.findByIdAndDelete(id).exec();
        if (!deletedProduct) {
            throw new NotFoundException(`Product with ID ${id} not found`);
        }
        return deletedProduct;
    }

    async migrateStatuses(): Promise<void> {
        // Update all products with 'active' or 'inactive' status to 'published'
        await this.productModel.updateMany(
            { status: { $in: ['active', 'inactive'] } },
            { $set: { status: 'published' } }
        ).exec();

        // Also update any products that don't have a status field yet
        await this.productModel.updateMany(
            { status: { $exists: false } },
            { $set: { status: 'published' } }
        ).exec();
    }
}
