import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ShopRequest,
  ShopRequestDocument,
  RequestStatus,
} from './entities/shop-request.entity';
import { CreateShopRequestDto } from './dto/create-shop-request.dto';
import { UsersService } from '../users/users.service';
import { AccessCodesService } from '../access-codes/access-codes.service';
import { UserRole, UserStatus } from '../users/entities/user.entity';

@Injectable()
export class ShopRequestsService {
  constructor(
    @InjectModel(ShopRequest.name)
    private shopRequestModel: Model<ShopRequestDocument>,
    private usersService: UsersService,
    private accessCodesService: AccessCodesService,
  ) { }

  async create(
    createShopRequestDto: CreateShopRequestDto,
  ): Promise<ShopRequestDocument> {
    const existing = await this.shopRequestModel.findOne({
      email: createShopRequestDto.email,
      status: RequestStatus.PENDING,
    });
    if (existing) {
      throw new BadRequestException(
        'A pending request with this email already exists.',
      );
    }
    const createdRequest = new this.shopRequestModel(createShopRequestDto);
    return createdRequest.save();
  }

  async findAll(status?: RequestStatus): Promise<ShopRequestDocument[]> {
    const filter = status ? { status } : {};
    return this.shopRequestModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<ShopRequestDocument> {
    const request = await this.shopRequestModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException('Shop request not found');
    }
    return request;
  }

  async approve(
    id: string,
    adminId: string,
  ): Promise<{ message: string; accessCode: string | null }> {
    const request = await this.findOne(id);
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException('Request is not pending');
    }

    console.log(`[Approve] Processing Shop Request ${id}. Username: ${request.username}, Password present: ${!!request.password}`);

    // Check if request has credentials (USA Flow)
    if (request.username && request.password) {
      try {
        await this.usersService.create({
          firstName: request.contactName.split(' ')[0] || 'Shop',
          lastName: request.contactName.split(' ').slice(1).join(' ') || 'User',
          email: request.email,
          username: request.username,
          password: request.password,
          role: UserRole.CERTIFIED_SHOP,
          status: UserStatus.ACTIVE,
          country: request.country,
          phoneNumber: request.phoneNumber,
          companyName: request.shopName,
        });
      } catch (error) {
        console.error(`[Approve] Failed to create user: ${error.message}`);
        throw new BadRequestException(`Failed to create user: ${error.message}`);
      }

      request.status = RequestStatus.APPROVED;
      await request.save();

      console.log(`[Approve] Created User for Shop Request ${id}`);

      return {
        message: 'Shop request approved and new user account created successfully.',
        accessCode: null,
      };
    }

    // International Flow: Generate Access Code
    const accessCode = await this.accessCodesService.generateCode(
      UserRole.CERTIFIED_SHOP,
      adminId,
      30, // 30 days validity
      request.email,
    );

    request.status = RequestStatus.APPROVED;
    await request.save();

    return {
      message: 'Shop request approved and access code generated.',
      accessCode: accessCode.code,
    };
  }

  async reject(id: string): Promise<{ message: string }> {
    const request = await this.findOne(id);
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException('Request is not pending');
    }

    // Delete the record as per requirement
    await this.shopRequestModel.findByIdAndDelete(id);

    return { message: 'Shop request rejected and record deleted.' };
  }
}
