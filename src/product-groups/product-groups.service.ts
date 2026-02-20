import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductGroup, ProductGroupDocument } from './entities/product-group.entity';
import { CreateProductGroupDto, UpdateProductGroupDto } from './dto/product-group.dto';
import { User, UserDocument } from '../users/entities/user.entity';

@Injectable()
export class ProductGroupsService {
    constructor(
        @InjectModel(ProductGroup.name)
        private productGroupModel: Model<ProductGroupDocument>,
        @InjectModel(User.name)
        private userModel: Model<UserDocument>,
    ) { }

    async create(createProductGroupDto: CreateProductGroupDto): Promise<ProductGroup> {
        const createdGroup = new this.productGroupModel(createProductGroupDto);
        return createdGroup.save();
    }

    async findAll(): Promise<any[]> {
        const groups = await this.productGroupModel.find().populate('products.productId').lean().exec();

        // Add user count to each group
        const groupsWithCounts = await Promise.all(groups.map(async (group) => {
            const userCount = await this.userModel.countDocuments({ productGroup: group._id as any }).exec();
            return {
                ...group,
                userCount
            };
        }));

        return groupsWithCounts;
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
