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
  ): Promise<{ message: string; accessCode: string }> {
    const request = await this.findOne(id);
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException('Request is not pending');
    }

    // Generate Access Code instead of creating User directly
    const accessCode = await this.accessCodesService.generateCode(
      UserRole.SHOP,
      adminId,
      30, // 30 days validity
      request.email,
    );

    // After approval, we can mark it as approved or delete it.
    // Given the "delete on reject" requirement, I'll mark as approved here but provide the code.
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
