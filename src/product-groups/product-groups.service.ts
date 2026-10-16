import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ProductGroup,
  ProductGroupDocument,
} from './entities/product-group.entity';
import {
  CreateProductGroupDto,
  UpdateDValuePricesDto,
  UpdateProductGroupDto,
} from './dto/product-group.dto';
import { User, UserDocument, UserRole } from '../users/entities/user.entity';

@Injectable()
export class ProductGroupsService {
  constructor(
    @InjectModel(ProductGroup.name)
    private productGroupModel: Model<ProductGroupDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  async create(
    createProductGroupDto: CreateProductGroupDto,
  ): Promise<ProductGroup> {
    // Check for duplicate countries
    if (createProductGroupDto.countries && createProductGroupDto.countries.length > 0) {
      const existingGroups = await this.productGroupModel.find({
        countries: { $in: createProductGroupDto.countries }
      }).exec();

      if (existingGroups.length > 0) {
        const dupCountries = existingGroups.flatMap(g => g.countries)
          .filter(c => createProductGroupDto.countries?.includes(c));
        throw new Error(`The following countries are already assigned to another group: ${dupCountries.join(', ')}. Please remove them from the existing group first.`);
      }
    }

    if (createProductGroupDto.isDefault) {
      await this.productGroupModel.updateMany({}, { isDefault: false }).exec();
    }
    const createdGroup = new this.productGroupModel(createProductGroupDto);
    return createdGroup.save();
  }

  async findAll(): Promise<any[]> {
    const groups = await this.productGroupModel
      .find()
      .populate('products.productId')
      .lean()
      .exec();

    // Fetch relevant user data for in-memory counting
    const users = await this.userModel
      .find({}, 'role country productGroup')
      .lean()
      .exec();

    // Fetch all active countries with groups (flattened array)
    // Handle both new 'countries' array and old 'country' string field for compatibility
    const activeCountries = groups.flatMap((g) => {
      const list = g.countries || [];
      if (g.country && !list.includes(g.country)) {
        list.push(g.country);
      }
      return list;
    }).filter((c) => c);

    // Map counts to each group
    const groupsWithCounts = groups.map((group) => {
      let count = 0;
      
      const groupCountries = group.countries || (group.country ? [group.country] : []);

      users.forEach((user) => {
        // 1. Explicitly assigned this group (Priority)
        if (
          user.productGroup &&
          user.productGroup.toString() === group._id.toString()
        ) {
          count++;
          return;
        }

        // 2. Dynamic matching for shops and partners
        if (
          [
            UserRole.CERTIFIED_SHOP,
            UserRole.MASTER_PARTNER,
            UserRole.REGIONAL_PARTNER,
            UserRole.PARTNER,
          ].includes(user.role)
        ) {
          // Does the user match any of the countries in this group?
          const userInThisGroup = groupCountries.includes(user.country);

          if (userInThisGroup) {
            count++;
          }
          // Or if no country match, do they fall back to this default group?
          else if (group.isDefault) {
            const hasSpecificCountryGroup = activeCountries.includes(
              user.country,
            );
            if (!hasSpecificCountryGroup) {
              count++;
            }
          }
        }
      });

      return {
        ...group,
        products: group.products.filter(item => item.productId !== null),
        userCount: count,
      };

    });

    return groupsWithCounts;


  }

  async findOne(id: string): Promise<ProductGroup> {
    const group = await this.productGroupModel
      .findById(id)
      .populate('products.productId')
      .exec();
    if (!group) {
      throw new NotFoundException(`Product Group with ID ${id} not found`);
    }

    // Filter out items where the product has been deleted (productId is null)
    const filteredProducts = group.products.filter(item => item.productId !== null);
    if (filteredProducts.length !== group.products.length) {
      console.log(`[ProductGroupsService] Filtered out ${group.products.length - filteredProducts.length} deleted products from group ${group.name}`);
      group.products = filteredProducts;
    }

    return group;
  }

  async update(
    id: string,
    updateProductGroupDto: UpdateProductGroupDto,
  ): Promise<ProductGroup> {
    // Check for duplicate countries (excluding this group itself)
    if (updateProductGroupDto.countries && updateProductGroupDto.countries.length > 0) {
      const existingGroups = await this.productGroupModel.find({
        _id: { $ne: id },
        countries: { $in: updateProductGroupDto.countries }
      }).exec();

      if (existingGroups.length > 0) {
        const dupCountries = existingGroups.flatMap(g => g.countries)
          .filter(c => updateProductGroupDto.countries?.includes(c));
        throw new Error(`The following countries are already assigned to another group: ${dupCountries.join(', ')}. Please remove them from the existing group first.`);
      }
    }

    if (updateProductGroupDto.isDefault) {
      await this.productGroupModel.updateMany({ _id: { $ne: id } }, { isDefault: false }).exec();
    }

    const existingGroup = await this.productGroupModel
      .findByIdAndUpdate(id, updateProductGroupDto, { new: true })
      .exec();
    if (!existingGroup) {
      throw new NotFoundException(`Product Group with ID ${id} not found`);
    }

    // Drop D-Value prices for products / sizes no longer assigned to this group.
    if (updateProductGroupDto.products && existingGroup.dValuePrices?.length) {
      const assigned = this.assignedSizeKeys(existingGroup);
      const kept = existingGroup.dValuePrices.filter((entry) =>
        assigned.has(this.dValueKey(entry.productId, entry.size)),
      );
      if (kept.length !== existingGroup.dValuePrices.length) {
        existingGroup.dValuePrices = kept;
        await existingGroup.save();
      }
    }
    return existingGroup;
  }

  private dValueKey(productId: unknown, size: unknown): string {
    const id =
      productId && typeof productId === 'object' && '_id' in productId
        ? (productId as { _id: unknown })._id
        : productId;
    return `${String(id)}|${String(size)}`;
  }

  private assignedSizeKeys(group: ProductGroup): Set<string> {
    const keys = new Set<string>();
    for (const item of group.products || []) {
      for (const s of item.sizes || []) {
        keys.add(this.dValueKey(item.productId, s.size));
      }
    }
    return keys;
  }

  /**
   * Replace the group's D-Value prices. Every entry must reference a product
   * size assigned to this group.
   */
  async updateDValuePrices(
    id: string,
    prices: UpdateDValuePricesDto['prices'],
  ): Promise<ProductGroup> {
    const group = await this.productGroupModel.findById(id).exec();
    if (!group) {
      throw new NotFoundException(`Product Group with ID ${id} not found`);
    }

    const assigned = this.assignedSizeKeys(group);
    const byKey = new Map<string, { productId: any; size: string; price: number }>();
    for (const entry of prices || []) {
      const key = this.dValueKey(entry.productId, entry.size);
      if (!assigned.has(key)) {
        throw new BadRequestException(
          'D-Value prices can only be set for products assigned to this group',
        );
      }
      const price = Math.round(Number(entry.price) * 100) / 100;
      if (!Number.isFinite(price) || price < 0) {
        throw new BadRequestException('Enter a valid D-Value price');
      }
      byKey.set(key, { productId: entry.productId, size: entry.size, price });
    }

    group.dValuePrices = Array.from(byKey.values());
    await group.save();
    return this.findOne(id);
  }

  /**
   * Atomically move a country into one pricing group (or clear assignment).
   * Uses the same ProductGroup.countries[] source of truth as Pricing Groups UI.
   */
  async assignCountry(
    country: string,
    productGroupId?: string | null,
  ): Promise<{
    country: string;
    pricingGroup: ProductGroup | null;
  }> {
    const trimmed = String(country || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Country is required');
    }

    await this.productGroupModel.updateMany(
      { countries: trimmed },
      { $pull: { countries: trimmed } },
    ).exec();

    await this.productGroupModel.updateMany(
      { country: trimmed },
      { $unset: { country: '' } },
    ).exec();

    if (!productGroupId) {
      return { country: trimmed, pricingGroup: null };
    }

    const group = await this.productGroupModel
      .findByIdAndUpdate(
        productGroupId,
        { $addToSet: { countries: trimmed } },
        { new: true },
      )
      .exec();

    if (!group) {
      throw new NotFoundException(`Product Group with ID ${productGroupId} not found`);
    }

    return { country: trimmed, pricingGroup: group };
  }

  async remove(id: string): Promise<any> {
    const result = await this.productGroupModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Product Group with ID ${id} not found`);
    }
    return result;
  }
}
