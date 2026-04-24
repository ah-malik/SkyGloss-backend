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
import { User, UserDocument } from '../users/entities/user.entity';

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

    // Fetch all active countries with groups
    const activeCountries = groups.map(g => g.country).filter(c => c);

    // Add user count to each group
    const groupsWithCounts = await Promise.all(
      groups.map(async (group) => {
        // 1. Users explicitly assigned this group
        const explicitCount = await this.userModel
          .countDocuments({ productGroup: group._id as any })
          .exec();

        // 2. Shop users matching by country
        let countryCount = 0;
        if (group.country) {
          countryCount = await this.userModel
            .countDocuments({ role: 'certified_shop', country: group.country })
            .exec();
        }

        // 3. Shop users falling back to default
        let defaultCount = 0;
        if (group.isDefault) {
           defaultCount = await this.userModel
             .countDocuments({ 
                role: 'certified_shop', 
                country: { $nin: activeCountries } 
             })
             .exec();
        }

        return {
          ...group,
          userCount: explicitCount + countryCount + defaultCount,
        };
      }),
    );

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
