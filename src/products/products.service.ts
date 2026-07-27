import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './entities/product.entity';
import {
  ProductGroup,
  ProductGroupDocument,
} from '../product-groups/entities/product-group.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { User, UserRole } from '../users/entities/user.entity';
import { Schema as MongooseSchema } from 'mongoose';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(ProductGroup.name)
    private productGroupModel: Model<ProductGroupDocument>,
  ) { }

  async create(createProductDto: CreateProductDto): Promise<ProductDocument> {
    console.log(
      '[ProductsService] Creating product with data:',
      JSON.stringify(createProductDto),
    );
    const createdProduct = new this.productModel(createProductDto);
    return createdProduct.save();
  }

  async findAll(
    status?: string,
    targetAudience?: string,
    user?: User,
  ): Promise<any[]> {
    let groupToUse: any = null;

    if (user) {
      // Priority 1: Explicitly assigned product group by Admin or Registration
      if (user.productGroup) {
        groupToUse = await this.productGroupModel
          .findById(user.productGroup)
          .populate('products.productId')
          .exec();
      }
      // Priority 2: Dynamic matching by country (only if no explicit group)
      else if (
        [
          UserRole.CERTIFIED_SHOP,
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.PARTNER,
        ].includes(user.role)
      ) {
        if (user.country) {
          groupToUse = await this.productGroupModel
            .findOne({
              $or: [
                { countries: user.country },
                { country: user.country }
              ],
              isActive: true
            })
            .populate('products.productId')
            .exec();
        }

        if (!groupToUse) {
          groupToUse = await this.productGroupModel
            .findOne({ isDefault: true, isActive: true })
            .populate('products.productId')
            .exec();
        }
      }
    }

    // 1. If user has an applicable product group, STRICTLY restrict visibility and override prices
    if (groupToUse) {
      // Return only products in the group with group-specific prices
      return groupToUse.products
        .map((item) => {
          const product = item.productId as any;
          if (!product) return null;

          // Deep clone and override
          const productObj = product.toObject ? product.toObject() : product;

          return {
            ...productObj,
            sizes: item.sizes.map((s) => ({
              size: s.size,
              price: s.price,
            })),
            currency: groupToUse.currency || 'USD',
            groupName: groupToUse.name,
          };
        })
        .filter((p) => p !== null);
    }

    // 2. Fallback to standard fetching ONLY for users WITHOUT a product group or anonymous users
    const filter: any = {};
    if (status) filter.status = status;
    if (targetAudience)
      filter.targetAudience = { $in: [targetAudience, 'all'] };

    return this.productModel
      .find(filter)
      .sort({ displayOrder: 1, createdAt: -1 })
      .exec();
  }

  async findOne(id: string, user?: User): Promise<any> {
    console.log(
      `[ProductsService] findOne called for ID: ${id}. User:`,
      user ? (user as any)._id : 'Anonymous',
    );

    let groupToUse: any = null;

    if (user) {
      if (user.productGroup) {
        groupToUse = await this.productGroupModel
          .findById(user.productGroup)
          .populate('products.productId')
          .exec();
      } else if (
        [
          UserRole.CERTIFIED_SHOP,
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.PARTNER,
        ].includes(user.role)
      ) {
        if (user.country) {
          groupToUse = await this.productGroupModel
            .findOne({
              $or: [
                { countries: user.country },
                { country: user.country }
              ],
              isActive: true
            })
            .populate('products.productId')
            .exec();
        }
        if (!groupToUse) {
          groupToUse = await this.productGroupModel
            .findOne({ isDefault: true, isActive: true })
            .populate('products.productId')
            .exec();
        }
      }
    }

    // 1. Check if user has an applicable product group and if this product is in it
    if (groupToUse) {
      const groupItem = groupToUse.products.find(
        (item) =>
          (item.productId as any)?._id?.toString() === id ||
          (item.productId as any)?.id?.toString() === id,
      );

      if (groupItem) {
        const product = groupItem.productId as any;
        const productObj = product.toObject ? product.toObject() : product;
        return {
          ...productObj,
          sizes: groupItem.sizes.map((s) => ({
            size: s.size,
            price: s.price,
          })),
          currency: groupToUse.currency || 'USD',
          groupName: groupToUse.name,
        };
      } else {
        console.warn(
          `[ProductsService] Product ${id} NOT found in group ${groupToUse.name}`,
        );
        throw new NotFoundException(
          `Product with ID ${id} not found in your assigned group`,
        );
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
    console.log(
      `[ProductsService] Updating product ${id} with data:`,
      JSON.stringify(updateProductDto),
    );
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
    await this.productModel
      .updateMany(
        { status: { $in: ['active', 'inactive'] } },
        { $set: { status: 'published' } },
      )
      .exec();

    // Also update any products that don't have a status field yet
    await this.productModel
      .updateMany(
        { status: { $exists: false } },
        { $set: { status: 'published' } },
      )
      .exec();
  }

  async migrateImagePaths(): Promise<void> {
    const products = await this.productModel.find().exec();
    for (const product of products) {
      let updated = false;

      // Update images
      const newImages = product.images.map((img) => {
        if (img.includes('Master_Distributor_Dashboard')) {
          updated = true;
          return img.replace(
            'Master_Distributor_Dashboard',
            'Master_Partner_Dashboard',
          );
        }
        return img;
      });

      // Update shopImages
      const newShopImages = product.shopImages.map((img) => {
        if (img.includes('Master_Distributor_Dashboard')) {
          updated = true;
          return img.replace(
            'Master_Distributor_Dashboard',
            'Master_Partner_Dashboard',
          );
        }
        return img;
      });

      if (updated) {
        product.images = newImages;
        product.shopImages = newShopImages;
        await product.save();
        console.log(`[ProductsService] Migrated image paths for product: ${product.name}`);
      }
    }
  }
}
