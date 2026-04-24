import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ProductGroup,
  ProductGroupDocument,
} from './entities/product-group.entity';
import {
  CreateProductGroupDto,
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

        // 2. Dynamic matching for shop users
        if (user.role === UserRole.CERTIFIED_SHOP) {
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
