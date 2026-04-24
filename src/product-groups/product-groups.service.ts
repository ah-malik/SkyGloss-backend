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

    const activeCountries = groups.map((g) => g.country).filter((c) => c);

    // Map counts to each group
    const groupsWithCounts = groups.map((group) => {
      let count = 0;

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
          // Does the user match this specific country group?
          if (group.country && user.country === group.country) {
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
