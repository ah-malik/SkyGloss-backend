import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CERTIFICATION_KIT_STATUS_SAVED,
  CertificationKit,
  CertificationKitDocument,
} from './entities/certification-kit.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/entities/user.entity';
import { RegistrationFeesService } from '../registration-fees/registration-fees.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { buildRegistrationFeeQuote } from '../common/registration-pricing';
import { roundMoney, SavedCertificationKitConfig } from '../common/certification-kit';
import { normalizeCurrencyCode } from '../common/currency-codes';

/** Roles that build a Certification Kit for the shops on their Parent Link. */
export const CERTIFICATION_KIT_OWNER_ROLES = [
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
] as const;

export type CertificationKitFee = { amount: number; currency: string };

@Injectable()
export class CertificationKitsService {
  private readonly logger = new Logger(CertificationKitsService.name);

  constructor(
    @InjectModel(CertificationKit.name)
    private readonly kitModel: Model<CertificationKitDocument>,
    private readonly usersService: UsersService,
    private readonly registrationFeesService: RegistrationFeesService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  async findByOwner(ownerId: string): Promise<CertificationKitDocument | null> {
    if (!Types.ObjectId.isValid(ownerId)) return null;
    return this.kitModel.findOne({ owner: new Types.ObjectId(ownerId) }).exec();
  }

  async saveForOwner(
    owner: { _id: unknown; partnerCode?: string },
    data: Pick<
      CertificationKit,
      'items' | 'freeShipping' | 'trainingIncluded' | 'trainingPrice' | 'discountPercent'
    >,
  ): Promise<CertificationKitDocument> {
    const ownerId = new Types.ObjectId(String(owner._id));
    return this.kitModel
      .findOneAndUpdate(
        { owner: ownerId },
        {
          $set: {
            ...data,
            trainingPrice: data.trainingIncluded ? data.trainingPrice : 0,
            ownerPartnerCode: String(owner.partnerCode || '').toUpperCase(),
            status: CERTIFICATION_KIT_STATUS_SAVED,
            savedAt: new Date(),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** The viewer's assigned certification fee (same fee group as activation checkout). */
  async getCertificationFeeForCountry(country?: string | null): Promise<CertificationKitFee> {
    const group = await this.registrationFeesService.findByCountry(country || '');
    const quote = buildRegistrationFeeQuote(group, country);
    return { amount: quote.feeAmount, currency: quote.currency };
  }

  /** Fee in the catalog currency (fee groups and Pricing Groups are configured separately). */
  async getCertificationFeeInCurrency(
    country: string | null | undefined,
    currency: string,
  ): Promise<number> {
    const fee = await this.getCertificationFeeForCountry(country);
    const from = normalizeCurrencyCode(fee.currency);
    const to = normalizeCurrencyCode(currency || fee.currency);
    if (from === to) return fee.amount;
    const fromRate = await this.exchangeRatesService.getRateToBase(from);
    const toRate = await this.exchangeRatesService.getRateToBase(to);
    return roundMoney((fee.amount * fromRate) / toRate);
  }

  /**
   * Saved kit of the shop's current Parent Link (Hub or Distributor), or null.
   * The fee is filled in later, once the shop's catalog currency is known.
   */
  async findSavedKitForShop(shop: {
    hubPartnerCode?: string | null;
    country?: string | null;
  }): Promise<Omit<SavedCertificationKitConfig, 'certificationFee'> | null> {
    try {
      const parentCode = await this.usersService.resolveActingParentPartnerCodeForShop(shop);
      if (!parentCode) return null;
      const parent = await this.usersService.findByPartnerCode(parentCode);
      if (
        !parent ||
        !(CERTIFICATION_KIT_OWNER_ROLES as readonly string[]).includes(parent.role)
      ) {
        return null;
      }
      const kit = await this.kitModel
        .findOne({ owner: parent._id, status: CERTIFICATION_KIT_STATUS_SAVED })
        .lean()
        .exec();
      if (!kit || !kit.items?.length) return null;
      return {
        items: kit.items.map((it) => ({
          productId: String(it.productId),
          size: it.size,
          quantity: it.quantity,
          name: it.name,
        })),
        discountPercent: Number(kit.discountPercent) || 0,
        freeShipping: kit.freeShipping !== false,
        trainingIncluded: !!kit.trainingIncluded,
        trainingPrice: Number(kit.trainingPrice) || 0,
      };
    } catch (err) {
      this.logger.warn(
        `Could not resolve Certification Kit for shop: ${(err as Error)?.message || err}`,
      );
      return null;
    }
  }
}
