import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) { }

  async onModuleInit() {
    // One-time cleanup to remove null emails that cause duplicate key errors with sparse index
    try {
      // Sync indexes to ensure unique: true, sparse: true is correctly applied
      await this.userModel.syncIndexes();
      console.log('[UsersService] Indexes synchronized.');

      const result = await this.userModel.updateMany(
        { email: null },
        { $unset: { email: '' } },
      );
      if (result.modifiedCount > 0) {
        console.log(
          `[UsersService] Cleaned up ${result.modifiedCount} users with null emails.`,
        );
      }
    } catch (err) {
      console.error('[UsersService] Database initialization failed:', err);
    }
  }

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    if (createUserDto.email) {
      const existingUser = await this.userModel.findOne({
        email: createUserDto.email,
      });
      if (existingUser) {
        throw new BadRequestException('User already exists');
      }
    }

    const hashedPassword = createUserDto.password
      ? await bcrypt.hash(createUserDto.password, 10)
      : undefined;

    const userData: any = {
      ...createUserDto,
      password: hashedPassword,
    };

    // Remove email if it's null/undefined to avoid duplicate key errors with sparse index
    if (!userData.email) {
      delete userData.email;
    }

    const createdUser = new this.userModel(userData);
    return createdUser.save();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async findOne(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findByAccessCode(accessCode: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ accessCode }).exec();
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserDocument | null> {
    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }
    return this.userModel
      .findByIdAndUpdate(id, updateUserDto, { new: true })
      .exec();
  }

  async remove(id: string): Promise<UserDocument | null> {
    return this.userModel.findByIdAndDelete(id).exec();
  }

  async getStats() {
    const total = await this.userModel.countDocuments();
    const admin = await this.userModel.countDocuments({ role: UserRole.ADMIN });
    const distributor = await this.userModel.countDocuments({
      role: UserRole.DISTRIBUTOR,
    });
    const shop = await this.userModel.countDocuments({ role: UserRole.SHOP });
    const technician = await this.userModel.countDocuments({
      role: UserRole.TECHNICIAN,
    });

    return { total, admin, distributor, shop, technician };
  }
}
