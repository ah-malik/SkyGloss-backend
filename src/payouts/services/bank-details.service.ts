import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import {
  BankDetails,
  BankDetailsDocument,
  BankVerificationStatus,
} from '../entities/bank-details.entity';
import { CreateBankDetailsDto } from '../dto/create-bank-details.dto';
import { ApprovalAction, AuditService } from './audit.service';
import { WiseService } from './wise.service';
import { UsersService } from '../../users/users.service';
import { defaultCurrencyForCountry } from '../wise-country-iso';
import { ibanValidationError, normalizeIban } from '../iban-validate';

@Injectable()
export class BankDetailsService {
  constructor(
    @InjectModel(BankDetails.name)
    private bankDetailsModel: Model<BankDetailsDocument>,
    private auditService: AuditService,
    private wiseService: WiseService,
    private usersService: UsersService,
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
        : { ...doc };
    return {
      ...obj,
      accountNumber: this.maskAccountNumber(obj.accountNumber as string),
      iban: this.maskAccountNumber(obj.iban as string),
      routingNumber: obj.routingNumber ? this.maskAccountNumber(obj.routingNumber as string) : undefined,
      sortCode: obj.sortCode ? this.maskAccountNumber(obj.sortCode as string) : undefined,
      swiftBic: obj.swiftBic ? this.maskAccountNumber(obj.swiftBic as string) : undefined,
      extraDetails: undefined,
      detailsFingerprint: undefined,
      wiseVerificationOutcome: obj.wiseVerificationOutcome,
      wiseVerificationSummary: obj.wiseVerificationSummary,
    };
  }

  fingerprint(dto: {
    accountHolderName?: string;
    bankName?: string;
    iban?: string;
    accountNumber?: string;
    routingNumber?: string;
    sortCode?: string;
    swiftBic?: string;
    country?: string;
    currency?: string;
    extraDetails?: Record<string, string>;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          accountHolderName: dto.accountHolderName || '',
          bankName: dto.bankName || '',
          iban: dto.iban || '',
          accountNumber: dto.accountNumber || '',
          routingNumber: dto.routingNumber || '',
          sortCode: dto.sortCode || '',
          swiftBic: dto.swiftBic || '',
          country: dto.country || '',
          currency: dto.currency || '',
          extraDetails: dto.extraDetails || {},
        }),
      )
      .digest('hex');
  }

  async getPrimaryForUser(userId: string) {
    return this.bankDetailsModel.findOne({
      userId: new Types.ObjectId(userId),
      isPrimary: true,
      isDeleted: false,
    });
  }

  async getByIdForPayout(id: string) {
    const doc = await this.bankDetailsModel.findById(id);
    if (!doc || doc.isDeleted) throw new NotFoundException('Bank details not found');
    return doc.toObject();
  }

  async getByIdForAdminReview(id: string) {
    const doc = await this.bankDetailsModel.findById(id);
    if (!doc || doc.isDeleted) throw new NotFoundException('Bank details not found');
    return this.toSafeResponse(doc);
  }

  async getByIdSafe(id: string) {
    const doc = await this.bankDetailsModel.findById(id);
    if (!doc || doc.isDeleted) return null;
    return this.toSafeResponse(doc);
  }

  async getMyBankDetails(userId: string) {
    const docs = await this.bankDetailsModel
      .find({ userId: new Types.ObjectId(userId), isDeleted: false })
      .sort({ isPrimary: -1, createdAt: -1 });
    return docs.map((d) => this.toSafeResponse(d));
  }

  async getWiseRequirements(country: string, currency?: string) {
    return this.wiseService.getRecipientRequirements(country, currency);
  }

  async upsertPrimary(userId: string, dto: CreateBankDetailsDto) {
    if (!dto.accountNumber && !dto.iban && !Object.keys(dto.extraDetails || {}).length) {
      throw new BadRequestException('Account number, IBAN, or required bank fields are needed');
    }
    const ibanValue =
      dto.iban ||
      dto.extraDetails?.iban ||
      dto.extraDetails?.IBAN;
    const ibanError = ibanValidationError(ibanValue, dto.country);
    if (ibanError) throw new BadRequestException(ibanError);
    if (ibanValue) dto.iban = normalizeIban(ibanValue);

    const currency =
      (dto.currency || defaultCurrencyForCountry(dto.country) || 'USD').toUpperCase();
    const user = await this.usersService.findOne(userId);
    const hash = this.fingerprint({ ...dto, currency });
    const existing = await this.bankDetailsModel.findOne({
      userId: new Types.ObjectId(userId),
      isDeleted: false,
    }).sort({ isPrimary: -1, createdAt: -1 });

    let recipientId = existing?.wiseRecipientId;
    let recipientStatus = existing?.wiseRecipientStatus || 'creating';
    let verificationOutcome = existing?.wiseVerificationOutcome || '';
    let verificationSummary = existing?.wiseVerificationSummary || '';
    let accountVerified = false;
    try {
      const created = await this.wiseService.createOrUpdateRecipient({
        bank: {
          accountHolderName: dto.accountHolderName,
          bankName: dto.bankName,
          iban: dto.iban,
          accountNumber: dto.accountNumber,
          routingNumber: dto.routingNumber,
          sortCode: dto.sortCode,
          swiftBic: dto.swiftBic,
          country: dto.country,
          currency,
          extraDetails: dto.extraDetails,
        },
        recipient: {
          email: user?.email,
          firstName: user?.firstName,
          lastName: user?.lastName,
          address: user?.address,
          streetAddress: user?.streetAddress,
          city: user?.city,
          zipCode: user?.zipCode,
          country: user?.country || dto.country,
        },
        existingRecipientId: existing?.wiseRecipientId,
        fingerprint: hash,
        previousFingerprint: existing?.detailsFingerprint,
      });
      recipientId = created.recipientId;
      recipientStatus = created.status;
      verificationOutcome = created.outcome;
      verificationSummary = created.summary;
      accountVerified = created.accountVerified;
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Wise recipient failed';
      throw new BadRequestException(this.wiseService.toUserFacingError(raw));
    }

    await this.bankDetailsModel.updateMany(
      { userId: new Types.ObjectId(userId), isDeleted: false },
      { isPrimary: false },
    );

    const payload = {
      ...dto,
      currency,
      detailsFingerprint: hash,
      wiseRecipientId: recipientId,
      wiseRecipientStatus: recipientStatus,
      wiseVerificationOutcome: verificationOutcome,
      wiseVerificationSummary: verificationSummary,
      verificationStatus: accountVerified
        ? BankVerificationStatus.VERIFIED
        : BankVerificationStatus.PENDING,
      verifiedAt: accountVerified ? new Date() : undefined,
      isPrimary: true,
      isDeleted: false,
    };

    let saved: BankDetailsDocument;
    if (existing) {
      Object.assign(existing, payload);
      if (!accountVerified) {
        existing.set('verifiedAt', undefined);
        existing.set('verifiedBy', undefined);
      }
      saved = await existing.save();
    } else {
      saved = await this.bankDetailsModel.create({
        userId: new Types.ObjectId(userId),
        ...payload,
      });
    }

    await this.auditService.logApproval({
      action: ApprovalAction.BANK_DETAILS_ADDED,
      actorUserId: new Types.ObjectId(userId),
      metadata: { bankDetailsId: saved._id, wiseRecipientId: recipientId },
    });

    return this.toSafeResponse(saved);
  }

  async verifyWithWise(bankId: string, adminUserId: string) {
    const bank = await this.bankDetailsModel.findById(bankId);
    if (!bank || bank.isDeleted) {
      throw new NotFoundException('Bank details not found');
    }
    const user = await this.usersService.findOne(bank.userId.toString());
    if (!user) throw new NotFoundException('Requester not found');

    const ibanError = ibanValidationError(bank.iban, bank.country);
    if (ibanError) throw new BadRequestException(ibanError);

    try {
      const created = await this.wiseService.createOrUpdateRecipient({
        bank: {
          accountHolderName: bank.accountHolderName,
          bankName: bank.bankName,
          iban: bank.iban,
          accountNumber: bank.accountNumber,
          routingNumber: bank.routingNumber,
          sortCode: bank.sortCode,
          swiftBic: bank.swiftBic,
          country: bank.country,
          currency: bank.currency,
          extraDetails: bank.extraDetails,
        },
        recipient: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          address: user.address,
          streetAddress: user.streetAddress,
          city: user.city,
          zipCode: user.zipCode,
          country: user.country || bank.country,
        },
        existingRecipientId: bank.wiseRecipientId,
        force: true,
      });
      bank.wiseRecipientId = created.recipientId;
      bank.wiseRecipientStatus = created.status || 'ready';
      bank.wiseVerificationOutcome = created.outcome;
      bank.wiseVerificationSummary = created.summary;
      if (created.accountVerified) {
        bank.verificationStatus = BankVerificationStatus.VERIFIED;
        bank.verifiedAt = new Date();
        bank.verifiedBy = new Types.ObjectId(adminUserId);
      } else {
        bank.verificationStatus = BankVerificationStatus.PENDING;
      }
      await bank.save();
      return this.toSafeResponse(bank);
    } catch (err) {
      bank.verificationStatus = BankVerificationStatus.REJECTED;
      bank.wiseRecipientStatus = 'failed';
      await bank.save();
      const raw = err instanceof Error ? err.message : 'Wise recipient failed';
      throw new BadRequestException(this.wiseService.toUserFacingError(raw));
    }
  }

  async getVerifiedPrimaryOrThrow(userId: string) {
    const bank = await this.getPrimaryForUser(userId);
    if (!bank || bank.verificationStatus === BankVerificationStatus.REJECTED) {
      return null;
    }
    return bank;
  }
}
