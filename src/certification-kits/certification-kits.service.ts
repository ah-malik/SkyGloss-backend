import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CERTIFICATION_KIT_STATUS_APPROVED,
  CERTIFICATION_KIT_STATUS_LEGACY_SAVED,
  CERTIFICATION_KIT_STATUS_PENDING,
  CERTIFICATION_KIT_STATUS_REJECTED,
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

export function formatCertificationKitOwnerRole(role?: string): string {
  return role === UserRole.DISTRIBUTOR ? 'Distributor' : 'HUB';
}

/** Status as shown to people: legacy "saved" kits are still waiting for approval. */
export function normalizeCertificationKitStatus(status?: string | null): string {
  if (!status || status === CERTIFICATION_KIT_STATUS_LEGACY_SAVED) {
    return CERTIFICATION_KIT_STATUS_PENDING;
  }
  return status;
}

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
          // Every send goes to SkyGloss for approval; the approved `live` version stays as it is.
          $set: {
            ...data,
            trainingPrice: data.trainingIncluded ? data.trainingPrice : 0,
            ownerPartnerCode: String(owner.partnerCode || '').toUpperCase(),
            status: CERTIFICATION_KIT_STATUS_PENDING,
            savedAt: new Date(),
          },
          $unset: { reviewNote: 1, reviewedAt: 1, reviewedBy: 1 },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** Admin queue: newest first, optionally by status ("pending" includes legacy "saved"). */
  async listForAdmin(status?: string): Promise<CertificationKitDocument[]> {
    const filter: Record<string, unknown> = {};
    if (status === CERTIFICATION_KIT_STATUS_PENDING) {
      filter.status = {
        $in: [CERTIFICATION_KIT_STATUS_PENDING, CERTIFICATION_KIT_STATUS_LEGACY_SAVED],
      };
    } else if (status) {
      filter.status = status;
    }
    return this.kitModel
      .find(filter)
      .sort({ savedAt: -1, updatedAt: -1 })
      .populate('owner', 'firstName lastName email role country countries partnerCode companyName productGroup')
      .exec();
  }

  private async findForReview(id: string): Promise<CertificationKitDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Certification Kit not found');
    const kit = await this.kitModel.findById(id).exec();
    if (!kit) throw new NotFoundException('Certification Kit not found');
    return kit;
  }

  /** The version an Admin reviewed must still be the latest one the owner sent. */
  private assertSameVersion(kit: CertificationKitDocument, savedAt?: string) {
    if (!savedAt) return;
    const reviewed = new Date(savedAt).getTime();
    const latest = kit.savedAt ? new Date(kit.savedAt).getTime() : 0;
    if (Number.isFinite(reviewed) && reviewed !== latest) {
      throw new ConflictException(
        'This kit was changed after you opened it. Reload to review the latest version.',
      );
    }
  }

  async approve(
    id: string,
    adminId: string,
    savedAt?: string,
  ): Promise<CertificationKitDocument> {
    const kit = await this.findForReview(id);
    this.assertSameVersion(kit, savedAt);
    if (!kit.items?.length) {
      throw new BadRequestException('The kit has no products.');
    }
    const now = new Date();
    const admin = new Types.ObjectId(String(adminId));
    kit.live = {
      items: kit.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        size: it.size,
        quantity: it.quantity,
      })),
      freeShipping: kit.freeShipping !== false,
      trainingIncluded: !!kit.trainingIncluded,
      trainingPrice: kit.trainingIncluded ? Number(kit.trainingPrice) || 0 : 0,
      discountPercent: Number(kit.discountPercent) || 0,
      approvedAt: now,
      approvedBy: admin,
    };
    kit.status = CERTIFICATION_KIT_STATUS_APPROVED;
    kit.reviewedAt = now;
    kit.reviewedBy = admin;
    kit.reviewNote = undefined;
    return kit.save();
  }

  async reject(
    id: string,
    adminId: string,
    note: string,
    savedAt?: string,
  ): Promise<CertificationKitDocument> {
    const kit = await this.findForReview(id);
    this.assertSameVersion(kit, savedAt);
    kit.status = CERTIFICATION_KIT_STATUS_REJECTED;
    kit.reviewedAt = new Date();
    kit.reviewedBy = new Types.ObjectId(String(adminId));
    kit.reviewNote = String(note || '').trim();
    return kit.save();
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
   * Approved kit for a shop, or null: its current Parent Link (Hub or Distributor)
   * first, then the Hub that owns the shop's country (the Hub's Shops list
   * includes those shops even when their Parent Link points elsewhere).
   * The fee is filled in later, once the shop's catalog currency is known.
   */
  async findSavedKitForShop(shop: {
    hubPartnerCode?: string | null;
    country?: string | null;
  }): Promise<Omit<SavedCertificationKitConfig, 'certificationFee'> | null> {
    try {
      const owners: Array<{ _id: Types.ObjectId; role: string }> = [];
      const parentCode = await this.usersService.resolveActingParentPartnerCodeForShop(shop);
      const parent = parentCode
        ? await this.usersService.findByPartnerCode(parentCode)
        : null;
      if (parent) owners.push(parent);
      // A Distributor's shops only get the Distributor's own kit (it fulfils their orders).
      if (parent?.role !== UserRole.DISTRIBUTOR) {
        const territoryHub = await this.usersService.findHubByCountry(shop.country);
        if (territoryHub) owners.push(territoryHub);
      }

      // Shops only ever see the version an Admin approved (`live`).
      let kit: CertificationKit['live'] | null = null;
      for (const owner of owners) {
        if (!(CERTIFICATION_KIT_OWNER_ROLES as readonly string[]).includes(owner.role)) {
          continue;
        }
        const doc = await this.kitModel
          .findOne({ owner: owner._id, 'live.items.0': { $exists: true } })
          .select('live')
          .lean()
          .exec();
        kit = doc?.live || null;
        if (kit?.items?.length) break;
      }
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
