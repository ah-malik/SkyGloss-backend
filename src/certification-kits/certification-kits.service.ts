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
import { GLOBAL_HUB_PARTNER_CODE } from '../common/global-hub';

/** Only a HUB builds, edits and sends the Certification Kit for the shops under it. */
export const CERTIFICATION_KIT_OWNER_ROLES = [UserRole.PARTNER] as const;

/** Every partner role can open the kit page; non-HUB partners see their HUB's kit, view only. */
export const CERTIFICATION_KIT_VIEWER_ROLES = [
  UserRole.PARTNER,
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
] as const;

export type LiveCertificationKitRecipe = Omit<SavedCertificationKitConfig, 'certificationFee'>;

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
      | 'items'
      | 'freeShipping'
      | 'trainingIncluded'
      | 'trainingPrice'
      | 'discountPercent'
      | 'currency'
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
    const allowed = [
      CERTIFICATION_KIT_STATUS_PENDING,
      CERTIFICATION_KIT_STATUS_APPROVED,
      CERTIFICATION_KIT_STATUS_REJECTED,
    ];
    if (status && (typeof status !== 'string' || !allowed.includes(status))) {
      throw new BadRequestException('Unknown status.');
    }
    if (status === CERTIFICATION_KIT_STATUS_PENDING) {
      filter.status = {
        $in: [CERTIFICATION_KIT_STATUS_PENDING, CERTIFICATION_KIT_STATUS_LEGACY_SAVED],
      };
    } else if (status) {
      filter.status = status;
    }
    const kits = await this.kitModel
      .find(filter)
      .sort({ savedAt: -1, updatedAt: -1 })
      .populate('owner', 'firstName lastName email role country countries partnerCode companyName productGroup')
      .exec();
    // Only HUB kits are offered to shops, so only those are reviewed.
    return kits.filter((k) => (k.owner as any)?.role === UserRole.PARTNER);
  }

  private async findForReview(id: string): Promise<CertificationKitDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Certification Kit not found');
    const kit = await this.kitModel.findById(id).exec();
    if (!kit) throw new NotFoundException('Certification Kit not found');
    const owner = await this.usersService.findOne(String(kit.owner));
    if (owner?.role !== UserRole.PARTNER) {
      throw new BadRequestException('Only a HUB’s Certification Kit can be reviewed.');
    }
    return kit;
  }

  /** The version an Admin reviewed must still be the latest one the owner sent. */
  private assertSameVersion(kit: CertificationKitDocument, savedAt?: string) {
    if (!savedAt) return;
    const reviewed = new Date(savedAt).getTime();
    if (!Number.isFinite(reviewed)) {
      throw new BadRequestException('Invalid kit version.');
    }
    const latest = kit.savedAt ? new Date(kit.savedAt).getTime() : 0;
    if (reviewed !== latest) {
      throw new ConflictException(
        'This kit was changed after you opened it. Reload to review the latest version.',
      );
    }
  }

  /**
   * Write a review only if the owner has not sent a newer version meanwhile
   * (atomic: a send between reading and saving is never overwritten).
   */
  private async writeReview(
    kit: CertificationKitDocument,
    update: Record<string, unknown>,
  ): Promise<CertificationKitDocument> {
    const updated = await this.kitModel
      .findOneAndUpdate(
        { _id: kit._id, savedAt: kit.savedAt ?? null },
        update,
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'This kit was changed after you opened it. Reload to review the latest version.',
      );
    }
    return updated;
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
    return this.writeReview(kit, {
      $set: {
        live: {
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
          currency: kit.currency,
          approvedAt: now,
          approvedBy: admin,
        },
        status: CERTIFICATION_KIT_STATUS_APPROVED,
        reviewedAt: now,
        reviewedBy: admin,
      },
      $unset: { reviewNote: 1 },
    });
  }

  async reject(
    id: string,
    adminId: string,
    note: string,
    savedAt?: string,
  ): Promise<CertificationKitDocument> {
    const kit = await this.findForReview(id);
    this.assertSameVersion(kit, savedAt);
    return this.writeReview(kit, {
      $set: {
        status: CERTIFICATION_KIT_STATUS_REJECTED,
        reviewedAt: new Date(),
        reviewedBy: new Types.ObjectId(String(adminId)),
        reviewNote: String(note || '').trim(),
      },
    });
  }

  /** The viewer's assigned certification fee (same fee group as activation checkout). */
  async getCertificationFeeForCountry(country?: string | null): Promise<CertificationKitFee> {
    const group = await this.registrationFeesService.findByCountry(country || '');
    const quote = buildRegistrationFeeQuote(group, country);
    return { amount: quote.feeAmount, currency: quote.currency };
  }

  /** Convert an amount between currencies with the admin exchange rates (throws when a rate is missing). */
  async convertAmount(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
    const from = normalizeCurrencyCode(fromCurrency);
    const to = normalizeCurrencyCode(toCurrency || fromCurrency);
    if (!amount || from === to) return amount;
    const fromRate = await this.exchangeRatesService.getRateToBase(from);
    const toRate = await this.exchangeRatesService.getRateToBase(to);
    return roundMoney((amount * fromRate) / toRate);
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

  /** Approved (`live`) recipe of the first HUB in the list that has one. */
  private async findLiveKitOfHubs(
    hubs: Array<{ _id: unknown; role?: string } | null | undefined>,
  ): Promise<{ hubId: string; recipe: LiveCertificationKitRecipe } | null> {
    const seen = new Set<string>();
    for (const hub of hubs) {
      if (!hub || hub.role !== UserRole.PARTNER) continue;
      const id = String(hub._id);
      if (seen.has(id)) continue;
      seen.add(id);
      const doc = await this.kitModel
        .findOne({ owner: new Types.ObjectId(id), 'live.items.0': { $exists: true } })
        .select('live')
        .lean()
        .exec();
      const live = doc?.live;
      if (!live?.items?.length) continue;
      return {
        hubId: id,
        recipe: {
          items: live.items.map((it) => ({
            productId: String(it.productId),
            size: it.size,
            quantity: it.quantity,
            name: it.name,
          })),
          discountPercent: Number(live.discountPercent) || 0,
          freeShipping: live.freeShipping !== false,
          trainingIncluded: !!live.trainingIncluded,
          trainingPrice: Number(live.trainingPrice) || 0,
          trainingCurrency: live.currency,
        },
      };
    }
    return null;
  }

  /**
   * Approved kit for a shop, or null. The kit comes from the HUB the shop is
   * under: its Parent Link when that is a HUB, else the HUB of its country
   * (the HUB's Shops list includes those shops), else GLOBALHUB.
   * The fee is filled in later, once the shop's catalog currency is known.
   */
  async findSavedKitForShop(shop: {
    hubPartnerCode?: string | null;
    country?: string | null;
  }): Promise<LiveCertificationKitRecipe | null> {
    try {
      const parentCode = await this.usersService.resolveActingParentPartnerCodeForShop(shop);
      const parent = parentCode
        ? await this.usersService.findByPartnerCode(parentCode)
        : null;
      const territoryHub = await this.usersService.findHubByCountry(shop.country);
      const globalHub = await this.usersService.findByPartnerCode(GLOBAL_HUB_PARTNER_CODE);
      // GLOBALHUB is the fallback owner: a real HUB (Parent Link, then country) comes first.
      const parentIsGlobal =
        String(parent?.partnerCode || '').toUpperCase() === GLOBAL_HUB_PARTNER_CODE;
      const found = await this.findLiveKitOfHubs([
        parentIsGlobal ? null : parent,
        territoryHub,
        globalHub,
      ]);
      return found?.recipe || null;
    } catch (err) {
      this.logger.warn(
        `Could not resolve Certification Kit for shop: ${(err as Error)?.message || err}`,
      );
      return null;
    }
  }

  /** The HUB a non-HUB partner works under, and that HUB's approved kit (if any). */
  async findHubKitForPartner(partnerId: string): Promise<{
    hub: { _id: string; name: string; partnerCode?: string } | null;
    recipe: LiveCertificationKitRecipe | null;
  }> {
    const hubs = await this.usersService.findOwningHubPartners(partnerId);
    const hub = hubs.find((h) => h?.role === UserRole.PARTNER) || null;
    const found = hub ? await this.findLiveKitOfHubs([hub]) : null;
    return {
      hub: hub
        ? {
            _id: String(hub._id),
            name:
              [hub.firstName, hub.lastName].filter(Boolean).join(' ') ||
              (hub as any).companyName ||
              hub.email,
            partnerCode: hub.partnerCode,
          }
        : null,
      recipe: found?.recipe || null,
    };
  }
}
