import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './entities/product.entity';
import { ProductGroup, ProductGroupDocument } from '../product-groups/entities/product-group.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { User } from '../users/entities/user.entity';
import { Schema as MongooseSchema } from 'mongoose';

@Injectable()
export class ProductsService {
    constructor(
        @InjectModel(Product.name) private productModel: Model<ProductDocument>,
        @InjectModel(ProductGroup.name) private productGroupModel: Model<ProductGroupDocument>,
    ) { }

    async create(createProductDto: CreateProductDto): Promise<ProductDocument> {
        console.log('[ProductsService] Creating product with data:', JSON.stringify(createProductDto));
        const createdProduct = new this.productModel(createProductDto);
        return createdProduct.save();
    }

    async findAll(status?: string, targetAudience?: string, user?: User): Promise<any[]> {
        console.log('[ProductsService] findAll called. User:', user ? `${(user as any)._id} (${user.username})` : 'Anonymous');

        // 1. If user has a product group, STRICTLY restrict visibility and override prices
        if (user && user.productGroup) {
            console.log('[ProductsService] User has productGroup:', user.productGroup);
            const group = await this.productGroupModel.findById(user.productGroup).populate('products.productId').exec();

            if (!group) {
                console.warn(`[ProductsService] Group ${user.productGroup} assigned to user but NOT FOUND in database.`);
                return []; // Strict: If group assigned but not found, return NO products
            }

            console.log(`[ProductsService] Filtering for group: ${group.name} (${group.products?.length} items)`);

            // Return only products in the group with group-specific prices
            return group.products.map(item => {
                const product = item.productId as any;
                if (!product) return null;

                // Deep clone and override
                const productObj = product.toObject();

                return {
                    ...productObj,
                    sizes: item.sizes.map(s => ({
                        size: s.size,
                        price: s.price
                    })),
                    currency: group.currency || 'USD',
                    groupName: group.name
                };
            }).filter(p => p !== null);
        }

        // 2. Fallback to standard fetching ONLY for users WITHOUT a product group or anonymous users
        console.log('[ProductsService] Falling back to standard product fetching.');
        const filter: any = {};
        if (status) filter.status = status;
        if (targetAudience) filter.targetAudience = { $in: [targetAudience, 'all'] };

        return this.productModel.find(filter).sort({ displayOrder: 1, createdAt: -1 }).exec();
    }

    async findOne(id: string, user?: User): Promise<any> {
        console.log(`[ProductsService] findOne called for ID: ${id}. User:`, user ? (user as any)._id : 'Anonymous');

        // 1. Check if user has a product group and if this product is in it
        if (user && user.productGroup) {
            const group = await this.productGroupModel.findById(user.productGroup).populate('products.productId').exec();

            if (!group) {
                console.warn(`[ProductsService] Group ${user.productGroup} assigned to user but NOT FOUND.`);
                throw new NotFoundException(`Product with ID ${id} not found for your group`);
            }

            const groupItem = group.products.find(item =>
                (item.productId as any)?._id?.toString() === id ||
                (item.productId as any)?.id?.toString() === id
            );

            if (groupItem) {
                const product = groupItem.productId as any;
                const productObj = product.toObject();
                return {
                    ...productObj,
                    sizes: groupItem.sizes.map(s => ({
                        size: s.size,
                        price: s.price
                    })),
                    currency: group.currency || 'USD',
                    groupName: group.name
                };
            } else {
                console.warn(`[ProductsService] Product ${id} NOT found in user's group ${group.name}`);
                throw new NotFoundException(`Product with ID ${id} not found in your assigned group`);
            }
        }

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
        console.log(`[ProductsService] Updating product ${id} with data:`, JSON.stringify(updateProductDto));
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
