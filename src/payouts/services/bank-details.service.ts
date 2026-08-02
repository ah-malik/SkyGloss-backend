import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BankDetails,
  BankDetailsDocument,
  BankVerificationStatus,
} from '../entities/bank-details.entity';
import { CreateBankDetailsDto } from '../dto/create-bank-details.dto';
import { ApprovalAction, AuditService } from './audit.service';

@Injectable()
export class BankDetailsService {
  constructor(
    @InjectModel(BankDetails.name)
    private bankDetailsModel: Model<BankDetailsDocument>,
    private auditService: AuditService,
  ) {}

  maskAccountNumber(value?: string): string | undefined {
    if (!value) return undefined;
    const trimmed = value.replace(/\s/g, '');
    if (trimmed.length <= 4) return '****';
    return `****${trimmed.slice(-4)}`;
  }

  toSafeResponse(doc: BankDetailsDocument | Record<string, unknown>) {
    const obj =
      typeof (doc as BankDetailsDocument).toObject === 'function'
        ? (doc as BankDetailsDocument).toObject()
        : doc;
    return {
      ...obj,
      accountNumber: this.maskAccountNumber(obj.accountNumber as string),
      iban: this.maskAccountNumber(obj.iban as string),
      routingNumber: obj.routingNumber ? '****' : undefined,
    };
  }

  async getPrimaryForUser(userId: string) {
    return this.bankDetailsModel.findOne({
      userId: new Types.ObjectId(userId),
      isPrimary: true,
      isDeleted: false,
    });
  }

  async getMyBankDetails(userId: string) {
    const docs = await this.bankDetailsModel
      .find({ userId: new Types.ObjectId(userId), isDeleted: false })
      .sort({ isPrimary: -1, createdAt: -1 });
    return docs.map((d) => this.toSafeResponse(d));
  }

  async upsertPrimary(userId: string, dto: CreateBankDetailsDto) {
    if (!dto.accountNumber && !dto.iban) {
      throw new BadRequestException('Account number or IBAN is required');
    }

    await this.bankDetailsModel.updateMany(
      { userId: new Types.ObjectId(userId), isDeleted: false },
      { isPrimary: false },
    );

    const existing = await this.bankDetailsModel.findOne({
      userId: new Types.ObjectId(userId),
      isPrimary: true,
      isDeleted: false,
    });

    let saved: BankDetailsDocument;
    if (existing) {
      Object.assign(existing, {
        ...dto,
        currency: dto.currency || 'USD',
        verificationStatus: BankVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
        isPrimary: true,
      });
      saved = await existing.save();
    } else {
      saved = await this.bankDetailsModel.create({
        userId: new Types.ObjectId(userId),
        ...dto,
        currency: dto.currency || 'USD',
        verificationStatus: BankVerificationStatus.VERIFIED,
        verifiedAt: new Date(),
        isPrimary: true,
      });
    }

    await this.auditService.logApproval({
      action: ApprovalAction.BANK_DETAILS_ADDED,
      actorUserId: new Types.ObjectId(userId),
      metadata: { bankDetailsId: saved._id },
    });

    return this.toSafeResponse(saved);
  }

  async getVerifiedPrimaryOrThrow(userId: string) {
    const bank = await this.getPrimaryForUser(userId);
    if (!bank || bank.verificationStatus !== BankVerificationStatus.VERIFIED) {
      return null;
    }
    return bank;
  }
}
