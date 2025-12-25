import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccessCode, AccessCodeDocument } from './entities/access-code.entity';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class AccessCodesService {
  constructor(
    @InjectModel(AccessCode.name)
    private accessCodeModel: Model<AccessCodeDocument>,
  ) { }

  async generateCode(
    targetRole: UserRole,
    generatedBy: string,
    expiresInDays: number = 7,
    generatedForEmail?: string,
  ): Promise<AccessCode> {
    const code = this.generateRandomCode(8);
    // Ensure uniqueness (simple retry logic)
    const existing = await this.accessCodeModel.findOne({ code });
    if (existing) {
      return this.generateCode(
        targetRole,
        generatedBy,
        expiresInDays,
        generatedForEmail,
      );
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const newCode = new this.accessCodeModel({
      code,
      targetRole,
      generatedBy: new Types.ObjectId(generatedBy),
      expiresAt,
      isUsed: false,
      generatedForEmail,
    });

    return newCode.save();
  }

  async validateCode(
    code: string,
    allowUsed: boolean = false,
  ): Promise<AccessCode> {
    const accessCode = await this.accessCodeModel.findOne({ code });
    if (!accessCode) {
      throw new NotFoundException('Invalid access code.');
    }
    if (accessCode.isUsed && !allowUsed) {
      throw new BadRequestException('Access code has already been used.');
    }
    if (accessCode.expiresAt < new Date()) {
      throw new BadRequestException('Access code has expired.');
    }
    return accessCode;
  }

  async markAsUsed(code: string): Promise<void> {
    await this.accessCodeModel.updateOne({ code }, { isUsed: true });
  }

  async findAll(): Promise<AccessCode[]> {
    return this.accessCodeModel
      .find()
      .populate('generatedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .exec();
  }

  private generateRandomCode(length: number): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
