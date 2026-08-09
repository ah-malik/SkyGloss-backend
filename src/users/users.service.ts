import { Injectable, BadRequestException, OnModuleInit, Logger, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import axios from 'axios';
import { ProductGroup, ProductGroupDocument } from '../product-groups/entities/product-group.entity';
import {
  getNetworkIdLabel,
  HUB_ID_LABEL,
  isPartnerNetworkRole,
  PARTNER_NETWORK_ROLES,
} from '../common/role-labels';
import {
  normalizePartnerCode,
  validatePartnerCode,
} from '../common/partner-code';
import {
  canTraverseNetwork,
  canCertifyShops,
  getParentLinkLabel,
  requiresParentLink,
  validateParentRole,
} from '../common/user-hierarchy';
import {
  getDefaultFirstOrderCommissionRates,
  isCommissionEligibleRole,
  normalizeFirstOrderCommissionRates,
  normalizePartnerDevelopmentRatePercent,
  normalizeShopIntroductionFirstOrderRatePercent,
  resolveCommissionRatePercent,
  resolveShopCommissionChain,
  resolveShopEarningAssignments,
} from '../common/commission-distribution';
import {
  GLOBAL_HUB_PARTNER_CODE,
  isGlobalHubAccount,
  isGlobalHubPartnerCode,
} from '../common/global-hub';
import { emailEqualsQuery, normalizeEmail } from '../common/email';
import { RedisCacheService } from '../redis/redis-cache.service';
import { CacheKeys, CacheTtl } from '../redis/redis.constants';
import { UserActivityService } from '../user-activity/user-activity.service';
import { UserActivityAction } from '../user-activity/entities/user-activity-log.entity';

export interface NetworkUsersResult {
  shops: UserDocument[];
  promoters: UserDocument[];
  /** @deprecated Sub-Promoter role removed — always empty; kept for API shape compatibility. */
  subPromoters: UserDocument[];
  representatives: UserDocument[];
  /** @deprecated use representatives */
  represented: UserDocument[];
  distributors: UserDocument[];
  partners: UserDocument[];
  viewerRole: string;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(ProductGroup.name) private productGroupModel: Model<ProductGroupDocument>,
    private readonly cache: RedisCacheService,
    private readonly userActivityService: UserActivityService,
  ) { }

  async onModuleInit() {
    // One-time cleanup to remove null emails that cause duplicate key errors with sparse index
    try {
      // Drop legacy global unique email index so the same email can exist once
      // per portal (shop vs partner). Compound unique is email + role.
      await this.migrateEmailIndexes();

      // Sync indexes to ensure schema indexes (incl. email+role) are applied
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

      // Ensure Global Hub partner exists for unassigned shop registrations
      const existingGlobalHub = await this.userModel.findOne({
        partnerCode: GLOBAL_HUB_PARTNER_CODE,
      });
      if (!existingGlobalHub) {
        console.log(`[UsersService] Creating Global Hub (${GLOBAL_HUB_PARTNER_CODE})...`);
        const hashedPass = await bcrypt.hash('123456', 10);
        await this.userModel.create({
          firstName: 'GLOBALHUB',
          lastName: 'Hub',
          email: 'globalhub@skygloss.com',
          password: hashedPass,
          role: UserRole.PARTNER,
          status: 'active',
          country: 'United States',
          address: 'Main Office',
          city: 'Global',
          partnerCode: GLOBAL_HUB_PARTNER_CODE,
          isSelfRegistered: false,
        });
        console.log('[UsersService] Global Hub partner created successfully.');
      }

      const backfillResult = await this.userModel.updateMany(
        {
          role: UserRole.CERTIFIED_SHOP,
          $or: [
            { referredByPartnerCode: { $exists: false } },
            { referredByPartnerCode: null },
            { referredByPartnerCode: '' },
          ],
        },
        { $set: { referredByPartnerCode: GLOBAL_HUB_PARTNER_CODE } },
      );
      if (backfillResult.modifiedCount > 0) {
        console.log(
          `[UsersService] Assigned ${backfillResult.modifiedCount} shops without a parent link to ${GLOBAL_HUB_PARTNER_CODE}.`,
        );
      }

      // Convert remaining Sub-Promoters → Promoters + operational Promoter Network links
      const migratedSubs = await this.migrateSubPromotersToPromoters();
      if (migratedSubs > 0) {
        console.log(
          `[UsersService] Migrated ${migratedSubs} Sub-Promoter(s) to Promoter (regional_partner).`,
        );
      }

      // Lowercase any emails still stored with capital letters
      const lowercased = await this.migrateEmailsToLowercase();
      if (lowercased > 0) {
        console.log(
          `[UsersService] Normalized ${lowercased} user email(s) to lowercase.`,
        );
      }
    } catch (err) {
      console.error('[UsersService] Database initialization failed:', err);
    }
  }

  /**
   * One-time style backfill: store every user email in lowercase.
   */
  private async migrateEmailsToLowercase(): Promise<number> {
    const result = await this.userModel.collection.updateMany(
      { email: { $type: 'string' } },
      [{ $set: { email: { $toLower: '$email' } } }],
    );
    return result.modifiedCount;
  }

  /**
   * Converts every sub_promoter to regional_partner, re-parents under the
   * former Main Promoter's Representative, and adds an operational Promoter
   * Network link under the former Main (mirrors Representative Network).
   */
  async migrateSubPromotersToPromoters(): Promise<number> {
    const subs = await this.userModel.find({ role: UserRole.SUB_PROMOTER }).exec();
    if (!subs.length) return 0;

    let converted = 0;
    for (const sub of subs) {
      const subCode = normalizePartnerCode(sub.partnerCode);
      const mainCode = normalizePartnerCode(sub.referredByPartnerCode);
      let newParentCode = mainCode || undefined;

      if (mainCode) {
        const main = await this.findByPartnerCode(mainCode);
        if (main?.role === UserRole.REGIONAL_PARTNER) {
          let walkCode = normalizePartnerCode(main.referredByPartnerCode);
          for (let depth = 0; depth < 10 && walkCode; depth += 1) {
            const ancestor = await this.findByPartnerCode(walkCode);
            if (!ancestor) break;
            if (ancestor.role === UserRole.MASTER_PARTNER) {
              newParentCode = walkCode;
              break;
            }
            walkCode = normalizePartnerCode(ancestor.referredByPartnerCode);
          }

          if (subCode) {
            await this.userModel.findByIdAndUpdate(main._id, {
              $addToSet: { operationalPromoterCodes: subCode },
            });
            // Ensure structured FO link exists (defaults 10% / 5%, linkedAt=now)
            const mainFresh = await this.findOne(main._id.toString());
            if (mainFresh) {
              await this.ensureOperationalPromoterLinksMigrated(mainFresh);
            }
          }
        }
      }

      await this.userModel.findByIdAndUpdate(sub._id, {
        role: UserRole.REGIONAL_PARTNER,
        ...(newParentCode ? { referredByPartnerCode: newParentCode } : {}),
      });
      converted += 1;
    }

    return converted;
  }

  private async fetchCoordinates(address: string, city: string, country: string): Promise<{ latitude: number, longitude: number } | null> {
    const fetchWithQuery = async (query: string) => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
        const res = await axios.get(url, {
          headers: {
            'User-Agent': 'SkyGloss-Backend',
          },
        });
        const data = res.data;
        if (data && data[0]) {
          return {
            latitude: parseFloat(data[0].lat),
            longitude: parseFloat(data[0].lon),
          };
        }
      } catch (err) {
        console.error(`[Geocoding] Failed for query "${query}":`, err);
      }
      return null;
    };

    // Try 1: Full Address
    let coords = await fetchWithQuery(`${address}, ${city}, ${country}`);

    // Try 2: City and Country fallback (if address search fails)
    if (!coords && (city || country)) {
      coords = await fetchWithQuery(`${city}, ${country}`);
    }

    return coords;
  }

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    console.log(
      '[UsersService] Creating user with DTO:',
      JSON.stringify(createUserDto, null, 2),
    );

    // Sub-Promoter role removed — use Promoter + Promoter Network linking instead
    if (createUserDto.role === UserRole.SUB_PROMOTER) {
      throw new BadRequestException(
        'Sub-Promoter role has been removed. Create a Promoter and link them via Promoter Network (Add to Network).',
      );
    }

    if (createUserDto.email) {
      createUserDto.email = normalizeEmail(createUserDto.email);
      await this.assertEmailAvailableForRole(
        createUserDto.email,
        createUserDto.role as UserRole,
      );
    }

    if (createUserDto.username) {
      const existingUser = await this.userModel.findOne({
        username: createUserDto.username,
      });
      if (existingUser) {
        throw new BadRequestException('User already exists (username)');
      }
    }

    const hashedPassword = createUserDto.password
      ? await bcrypt.hash(createUserDto.password, 10)
      : undefined;

    const partnerIntroCode = normalizePartnerCode(
      createUserDto.partnerIntroCode,
    );

    const userData: any = {
      ...createUserDto,
      password: hashedPassword,
      role: createUserDto.role,
    };
    // Map legacy FO aliases → current rate fields, then strip helpers.
    if (
      userData.customCommissionRate == null &&
      createUserDto.firstOrderShopIntroductionRate != null
    ) {
      userData.customCommissionRate =
        createUserDto.firstOrderShopIntroductionRate;
    }
    if (
      userData.partnerIntroRatePercent == null &&
      createUserDto.firstOrderPartnerDevelopmentRate != null
    ) {
      userData.partnerIntroRatePercent =
        createUserDto.firstOrderPartnerDevelopmentRate;
    }
    delete userData.firstOrderShopIntroductionRate;
    delete userData.firstOrderPartnerDevelopmentRate;
    delete userData.partnerIntroCode;
    delete userData.operationalSupportRepresentativeCode;
    // Shop-only rate fields are not set on create for non-shops.
    if (userData.role !== UserRole.CERTIFIED_SHOP) {
      delete userData.shopIntroductionFirstOrderRatePercent;
      delete userData.partnerDevelopmentRatePercent;
      delete userData.operationalSupportRatePercent;
    }

    if (userData.role === UserRole.PARTNER) {
      delete userData.referredByPartnerCode;
    } else {
      if (requiresParentLink(userData.role) && !userData.referredByPartnerCode?.trim()) {
        userData.referredByPartnerCode = GLOBAL_HUB_PARTNER_CODE;
      }
      await this.validateHierarchyLink(
        userData.role,
        userData.referredByPartnerCode,
      );
    }

    // Validate partner network code for network role users
    const partnerRoles = [
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      // UserRole.SUB_PROMOTER, // removed
      UserRole.DISTRIBUTOR,
      UserRole.PARTNER,
    ];

    if (partnerRoles.includes(userData.role)) {
      // Auto-activate partners created by Admin
      userData.status = UserStatus.ACTIVE;

      const codeError = validatePartnerCode(userData.partnerCode, userData.role);
      if (codeError) {
        throw new BadRequestException(codeError);
      }

      userData.partnerCode = normalizePartnerCode(userData.partnerCode);

      const existingCode = await this.userModel.findOne({
        partnerCode: userData.partnerCode,
      });
      if (existingCode) {
        throw new BadRequestException(
          `${getNetworkIdLabel(userData.role)} already exists — choose a unique ID`,
        );
      }
    } else {
      // Clear partnerCode if NOT a partner role (optional but consistency is good)
      delete userData.partnerCode;
    }

    this.normalizeCustomCommissionRate(userData.role, userData);
    this.normalizePartnerIntroRatePercent(userData.role, userData);

    // Auto-geocode if coordinates are missing
    if (!userData.latitude || !userData.longitude) {
      if (userData.address && userData.city && userData.country) {
        const coords = await this.fetchCoordinates(userData.address, userData.city, userData.country);
        if (coords) {
          userData.latitude = coords.latitude;
          userData.longitude = coords.longitude;
          console.log(`[Geocoding] Automatically detected coordinates for ${userData.email}:`, coords);
        }
      }
    }

    // Remove email if it's null/undefined to avoid duplicate key errors with sparse index
    if (!userData.email) {
      delete userData.email;
    }

    if (!userData.productGroup || userData.productGroup === '') {
      const defaultGroup = await this.productGroupModel.findOne({ isDefault: true }).exec();
      if (defaultGroup) {
        userData.productGroup = defaultGroup._id;
        console.log(`[UsersService] Assigned default product group ${defaultGroup.name} to new user.`);
      } else {
        delete userData.productGroup;
      }
    }

    let savedUser: UserDocument;
    try {
      const createdUser = new this.userModel(userData);
      savedUser = await createdUser.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || '';
        if (key === 'email' || key.includes('email')) {
          throw new BadRequestException(
            'An account with this email already exists for this portal. Use a different email, or create the other portal role only if one does not already exist.',
          );
        }
        if (key === 'partnerCode') {
          throw new BadRequestException(
            `${getNetworkIdLabel(userData.role)} already exists — choose a unique ID`,
          );
        }
        if (key === 'username') {
          throw new BadRequestException('User already exists (username)');
        }
        throw new BadRequestException('Duplicate value — please use a unique email or ID');
      }
      throw err;
    }

    if (savedUser.role === UserRole.CERTIFIED_SHOP) {
      // Promoter Network FO first (identical stamp model to Rep FO).
      let shop = await this.assignShopPromoterNetworkEarnings(savedUser);
      const promoterFoReady =
        shop.partnerDevelopmentPromoterEligible === true &&
        normalizePartnerCode(shop.shopIntroductionRepresentativeCode) ===
          normalizePartnerCode(shop.referredByPartnerCode);
      if (!promoterFoReady) {
        shop = await this.assignShopEarningRepresentatives(shop);
        shop = await this.assignShopPromoterNetworkEarnings(shop);
      }
      return shop;
    }

    if (
      savedUser.role === UserRole.MASTER_PARTNER ||
      savedUser.role === UserRole.REGIONAL_PARTNER
    ) {
      return this.applyPartnerIntroOnCreate(savedUser, partnerIntroCode);
    }

    return savedUser;
  }

  /**
   * Apply Partner Intro when Admin creates a REP or Promoter.
   *
   * REP: optional Partner Intro = another REP (never self).
   * Promoter + Hub parent: optional Partner Intro = Promoter under same Hub.
   * Promoter + REP/Promoter parent: that parent becomes Partner Intro automatically.
   */
  private async applyPartnerIntroOnCreate(
    user: UserDocument,
    partnerIntroCode?: string,
  ): Promise<UserDocument> {
    const defaults = getDefaultFirstOrderCommissionRates(user.role);
    const parentCode = normalizePartnerCode(user.referredByPartnerCode);
    const parent = parentCode
      ? await this.findByPartnerCode(parentCode)
      : null;

    if (user.role === UserRole.MASTER_PARTNER) {
      const introCode = normalizePartnerCode(partnerIntroCode);
      if (!introCode) return user;
      if (introCode === normalizePartnerCode(user.partnerCode)) {
        throw new BadRequestException(
          'Partner Intro cannot be the same Representative being created.',
        );
      }
      const intro = await this.findByPartnerCode(introCode);
      if (!intro || intro.role !== UserRole.MASTER_PARTNER) {
        throw new BadRequestException(
          'Partner Intro must be a Representative.',
        );
      }
      const updated = await this.userModel
        .findByIdAndUpdate(
          user._id,
          {
            partnerDevelopmentRepresentativeCode: introCode,
            partnerDevelopmentRepresentativeId: intro._id,
          },
          { new: true },
        )
        .exec();
      return updated || user;
    }

    if (user.role !== UserRole.REGIONAL_PARTNER) return user;

    // Case 2: parent is REP or Promoter → that parent is Partner Intro.
    if (
      parent &&
      (parent.role === UserRole.MASTER_PARTNER ||
        parent.role === UserRole.REGIONAL_PARTNER)
    ) {
      const updatePayload: Record<string, unknown> = {};
      if (parent.role === UserRole.MASTER_PARTNER) {
        updatePayload.partnerDevelopmentRepresentativeCode = parentCode;
        updatePayload.partnerDevelopmentRepresentativeId = parent._id;
      } else {
        updatePayload.partnerDevelopmentPromoterCode = parentCode;
        updatePayload.partnerDevelopmentPromoterId = parent._id;
        // Keep shop PD stamp field aligned for commission engine.
        updatePayload.partnerDevelopmentRepresentativeCode = parentCode;
        updatePayload.partnerDevelopmentRepresentativeId = parent._id;
      }
      const updated = await this.userModel
        .findByIdAndUpdate(user._id, updatePayload, { new: true })
        .exec();

      // Optional: keep operational Promoter link for network visibility.
      if (parent.role === UserRole.REGIONAL_PARTNER) {
        await this.ensureOperationalFoLinkOnCreate(
          updated || user,
          defaults.shopIntroductionRate,
          defaults.partnerDevelopmentRate,
        );
      }
      return updated || user;
    }

    // Case 1: Hub parent + optional Partner Intro Promoter (same Hub).
    const introCode = normalizePartnerCode(partnerIntroCode);
    if (!introCode) return user;
    if (introCode === normalizePartnerCode(user.partnerCode)) {
      throw new BadRequestException(
        'Partner Intro cannot be the same Promoter being created.',
      );
    }
    const intro = await this.findByPartnerCode(introCode);
    if (!intro || intro.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Partner Intro must be a Promoter.');
    }
    const introHub = normalizePartnerCode(intro.referredByPartnerCode);
    if (parentCode && introHub && introHub !== parentCode) {
      // Allow if intro's parent is under same hub tree (intro under another promoter/rep of hub).
      // Strict rule from spec: list is same-Hub Promoters — match referred Hub when parent is Hub.
      if (parent?.role === UserRole.PARTNER && introHub !== parentCode) {
        const introParent = await this.findByPartnerCode(introHub);
        const introRootHub =
          introParent?.role === UserRole.PARTNER
            ? introHub
            : normalizePartnerCode(introParent?.referredByPartnerCode);
        if (introRootHub !== parentCode) {
          throw new BadRequestException(
            'Partner Intro must be a Promoter under the same Hub.',
          );
        }
      }
    }

    // Case 1: Hub parent — Partner Intro is a field only (no operational FO link).
    const updated = await this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          partnerDevelopmentPromoterCode: introCode,
          partnerDevelopmentPromoterId: intro._id,
          partnerDevelopmentRepresentativeCode: introCode,
          partnerDevelopmentRepresentativeId: intro._id,
        },
        { new: true },
      )
      .exec();
    return updated || user;
  }

  /** Clear Partner Intro fields on a REP or Promoter. */
  private async clearPartnerIntroOnUser(
    user: UserDocument,
  ): Promise<UserDocument> {
    const updated = await this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          $unset: {
            partnerDevelopmentRepresentativeCode: 1,
            partnerDevelopmentRepresentativeId: 1,
            partnerDevelopmentPromoterCode: 1,
            partnerDevelopmentPromoterId: 1,
          },
        },
        { new: true },
      )
      .exec();
    return updated || user;
  }

  /**
   * When admin creates/edits a Rep under another Rep (or Promoter under Promoter)
   * via Add Network, upsert the operational FO link — same model as
   * Add to Network page. Updates rates if the link already exists and syncs
   * unpaid FO-eligible shops.
   */
  private buildOperationalLinkEntry(
    partnerCode: string,
    rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    },
    linkedAt?: Date,
  ) {
    return {
      partnerCode: normalizePartnerCode(partnerCode),
      linkedAt: linkedAt || new Date(),
      firstOrderShopIntroductionRate: rates.shopIntroductionRate,
      firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
    };
  }

  private mergeOperationalLinks(
    links: Array<{
      partnerCode?: string;
      linkedAt?: Date;
      firstOrderShopIntroductionRate?: number;
      firstOrderPartnerDevelopmentRate?: number;
    }>,
    childCode: string,
    rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    },
    linkedAt: Date,
    role: 'master_partner' | 'regional_partner' = 'master_partner',
  ) {
    const defaults = getDefaultFirstOrderCommissionRates(role);
    const normalizedChild = normalizePartnerCode(childCode);
    const mapped = (links || []).map((entry) =>
      this.buildOperationalLinkEntry(
        entry.partnerCode || '',
        {
          shopIntroductionRate:
            entry.firstOrderShopIntroductionRate ??
            defaults.shopIntroductionRate,
          partnerDevelopmentRate:
            entry.firstOrderPartnerDevelopmentRate ??
            defaults.partnerDevelopmentRate,
        },
        entry.linkedAt,
      ),
    );

    const linkIndex = mapped.findIndex(
      (entry) => entry.partnerCode === normalizedChild,
    );
    const nextEntry = this.buildOperationalLinkEntry(
      normalizedChild,
      rates,
      linkIndex >= 0 ? mapped[linkIndex].linkedAt : linkedAt,
    );

    if (linkIndex >= 0) {
      mapped[linkIndex] = nextEntry;
    } else {
      mapped.push(nextEntry);
    }

    const byCode = new Map<
      string,
      ReturnType<UsersService['buildOperationalLinkEntry']>
    >();
    for (const entry of mapped) {
      if (entry.partnerCode) {
        byCode.set(entry.partnerCode, entry);
      }
    }
    return Array.from(byCode.values());
  }

  private async persistOperationalRepresentativeFoLink(
    parent: UserDocument,
    childCode: string,
    rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    },
  ): Promise<void> {
    const normalizedChild = normalizePartnerCode(childCode);
    const linkedAt = new Date();

    await this.ensureOperationalRepresentativeLinksMigrated(parent);
    const refreshed = await this.findOne(parent._id.toString());
    if (!refreshed) return;

    const nextLinks = this.mergeOperationalLinks(
      refreshed.operationalRepresentativeLinks || [],
      normalizedChild,
      rates,
      linkedAt,
      'master_partner',
    );
    const nextCodes = new Set(
      (refreshed.operationalRepresentativeCodes || []).map((code) =>
        normalizePartnerCode(code),
      ),
    );
    nextCodes.add(normalizedChild);

    await this.userModel.updateOne(
      { _id: refreshed._id },
      {
        $set: {
          operationalRepresentativeLinks: nextLinks,
          operationalRepresentativeCodes: Array.from(nextCodes),
        },
      },
    );

    console.log(
      `[UsersService] Updated Rep FO link ${normalizePartnerCode(refreshed.partnerCode)} → ${normalizedChild}: child ${rates.shopIntroductionRate}% · parent ${rates.partnerDevelopmentRate}%`,
    );
  }

  private async persistOperationalPromoterFoLink(
    parent: UserDocument,
    childCode: string,
    rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    },
  ): Promise<void> {
    const normalizedChild = normalizePartnerCode(childCode);
    const linkedAt = new Date();

    await this.ensureOperationalPromoterLinksMigrated(parent);
    const refreshed = await this.findOne(parent._id.toString());
    if (!refreshed) return;

    const nextLinks = this.mergeOperationalLinks(
      refreshed.operationalPromoterLinks || [],
      normalizedChild,
      rates,
      linkedAt,
      'regional_partner',
    );
    const nextCodes = new Set(
      (refreshed.operationalPromoterCodes || []).map((code) =>
        normalizePartnerCode(code),
      ),
    );
    nextCodes.add(normalizedChild);

    await this.userModel.updateOne(
      { _id: refreshed._id },
      {
        $set: {
          operationalPromoterLinks: nextLinks,
          operationalPromoterCodes: Array.from(nextCodes),
        },
      },
    );

    console.log(
      `[UsersService] Updated Promoter FO link ${normalizePartnerCode(refreshed.partnerCode)} → ${normalizedChild}: child ${rates.shopIntroductionRate}% · parent ${rates.partnerDevelopmentRate}%`,
    );
  }

  private async ensureOperationalFoLinkOnCreate(
    child: UserDocument,
    firstOrderShopIntroductionRate?: number,
    firstOrderPartnerDevelopmentRate?: number,
  ): Promise<void> {
    const childCode = normalizePartnerCode(child.partnerCode);
    const parentCode = normalizePartnerCode(child.referredByPartnerCode);
    const foRatesRequested =
      firstOrderShopIntroductionRate !== undefined ||
      firstOrderPartnerDevelopmentRate !== undefined;

    if (!childCode || !parentCode) {
      if (foRatesRequested) {
        throw new BadRequestException(
          'First Order rates require a valid Add Network parent link.',
        );
      }
      return;
    }

    // Never create an operational FO self-link (owner === child).
    if (childCode === parentCode) {
      if (foRatesRequested) {
        throw new BadRequestException(
          'A user cannot be linked to their own Add Network parent.',
        );
      }
      return;
    }

    const parent = await this.findByPartnerCode(parentCode);
    if (!parent) {
      if (foRatesRequested) {
        throw new BadRequestException('Add Network parent user not found.');
      }
      return;
    }

    const isRepUnderRep =
      child.role === UserRole.MASTER_PARTNER &&
      parent.role === UserRole.MASTER_PARTNER;
    const isPromoterUnderPromoter =
      child.role === UserRole.REGIONAL_PARTNER &&
      parent.role === UserRole.REGIONAL_PARTNER;
    if (!isRepUnderRep && !isPromoterUnderPromoter) {
      if (foRatesRequested) {
        throw new BadRequestException(
          child.role === UserRole.MASTER_PARTNER
            ? 'First Order rates apply only when a Representative is linked under another Representative in Add Network.'
            : 'First Order rates apply only when a Promoter is linked under another Promoter in Add Network.',
        );
      }
      return;
    }

    let rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    };
    try {
      rates = normalizeFirstOrderCommissionRates({
        shopIntroductionRate: firstOrderShopIntroductionRate,
        partnerDevelopmentRate: firstOrderPartnerDevelopmentRate,
        role: child.role,
      });
    } catch (error: any) {
      throw new BadRequestException(
        error?.message ||
          'Parent First Order Commission cannot exceed Child First Order Commission.',
      );
    }

    if (isRepUnderRep) {
      await this.persistOperationalRepresentativeFoLink(parent, childCode, rates);

      if (!normalizePartnerCode(child.partnerDevelopmentRepresentativeCode)) {
        await this.userModel.findByIdAndUpdate(child._id, {
          partnerDevelopmentRepresentativeCode: parentCode,
        });
      }

      await this.syncFirstOrderRatesToEligibleShops(childCode, rates);
      return;
    }

    await this.persistOperationalPromoterFoLink(parent, childCode, rates);

    if (!normalizePartnerCode(child.partnerDevelopmentPromoterCode)) {
      await this.userModel.findByIdAndUpdate(child._id, {
        partnerDevelopmentPromoterCode: parentCode,
        partnerDevelopmentPromoterId: parent._id,
      });
    }

    await this.syncPromoterFirstOrderRatesToEligibleShops(childCode, rates);
  }

  /** Assign Shop Introduction / Partner Development / Operational Support reps (one-time, immutable per earning type). */
  async assignShopEarningRepresentatives(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;

    const assignments = await resolveShopEarningAssignments(
      shop,
      async (code) => {
        const user = await this.findByPartnerCode(code);
        if (!user) return null;
        return {
          _id: user._id,
          partnerCode: user.partnerCode,
          role: user.role as string,
          referredByPartnerCode: user.referredByPartnerCode,
          partnerDevelopmentRepresentativeCode:
            user.partnerDevelopmentRepresentativeCode,
          partnerDevelopmentPromoterCode: user.partnerDevelopmentPromoterCode,
        };
      },
    );

    const updatePayload: Record<string, unknown> = {};
    const defaults = getDefaultFirstOrderCommissionRates(
      UserRole.MASTER_PARTNER,
    );

    const referredCode = normalizePartnerCode(shop.referredByPartnerCode);
    const referredUser = referredCode
      ? await this.findByPartnerCode(referredCode)
      : null;
    const currentSi = normalizePartnerCode(
      shop.shopIntroductionRepresentativeCode,
    );

    // Shop Intro = referral user (REP or Promoter).
    if (
      referredUser &&
      (referredUser.role === UserRole.MASTER_PARTNER ||
        referredUser.role === UserRole.REGIONAL_PARTNER) &&
      referredCode &&
      currentSi !== referredCode
    ) {
      updatePayload.shopIntroductionRepresentativeCode = referredCode;
      updatePayload.shopIntroductionRepresentativeId = referredUser._id;
    } else if (
      !shop.shopIntroductionRepresentativeCode &&
      assignments.shopIntroductionRepresentativeCode
    ) {
      updatePayload.shopIntroductionRepresentativeId =
        assignments.shopIntroductionRepresentativeId;
      updatePayload.shopIntroductionRepresentativeCode =
        assignments.shopIntroductionRepresentativeCode;
    }

    const shopIntroCode =
      (updatePayload.shopIntroductionRepresentativeCode as string) ||
      shop.shopIntroductionRepresentativeCode ||
      assignments.shopIntroductionRepresentativeCode;

    const shopIntroUser = shopIntroCode
      ? await this.findByPartnerCode(shopIntroCode)
      : null;

    // Partner Intro from Shop Intro user's Partner Intro assignment.
    let pdCode = normalizePartnerCode(
      shop.partnerDevelopmentRepresentativeCode ||
        assignments.partnerDevelopmentRepresentativeCode,
    );
    let pdId: string | undefined =
      shop.partnerDevelopmentRepresentativeId?.toString() ||
      assignments.partnerDevelopmentRepresentativeId;

    if (!pdCode && shopIntroUser) {
      pdCode =
        normalizePartnerCode(shopIntroUser.partnerDevelopmentRepresentativeCode) ||
        normalizePartnerCode(shopIntroUser.partnerDevelopmentPromoterCode);
      if (pdCode) {
        const pdUser = await this.findByPartnerCode(pdCode);
        pdId = pdUser?._id?.toString();
      }
    }

    // Promoter under REP without explicit Partner Intro → parent REP is Partner Intro.
    if (
      !pdCode &&
      shopIntroUser?.role === UserRole.REGIONAL_PARTNER
    ) {
      const parentCode = normalizePartnerCode(
        shopIntroUser.referredByPartnerCode,
      );
      const parent = parentCode
        ? await this.findByPartnerCode(parentCode)
        : null;
      if (parent?.role === UserRole.MASTER_PARTNER && parentCode) {
        pdCode = parentCode;
        pdId = parent._id?.toString();
      }
    }

    // Prefer Admin overrides on the Shop Intro user; else role defaults.
    const siRate =
      shopIntroUser != null
        ? resolveCommissionRatePercent(
            shopIntroUser.role,
            shopIntroUser.customCommissionRate,
          )
        : defaults.shopIntroductionRate;
    const piRate =
      shopIntroUser?.partnerIntroRatePercent != null &&
      !Number.isNaN(Number(shopIntroUser.partnerIntroRatePercent))
        ? Math.max(0, Math.min(100, Number(shopIntroUser.partnerIntroRatePercent)))
        : defaults.partnerDevelopmentRate;

    if (
      pdCode &&
      pdCode !== normalizePartnerCode(shopIntroCode) &&
      !shop.partnerDevelopmentRepresentativeCode
    ) {
      updatePayload.partnerDevelopmentRepresentativeCode = pdCode;
      if (pdId) updatePayload.partnerDevelopmentRepresentativeId = pdId;
      updatePayload.partnerDevelopmentEligible = true;
      if (shop.partnerDevelopmentRatePercent == null) {
        updatePayload.partnerDevelopmentRatePercent = piRate;
      }
      if (shop.shopIntroductionFirstOrderRatePercent == null) {
        updatePayload.shopIntroductionFirstOrderRatePercent = siRate;
      }
    } else if (
      shop.partnerDevelopmentRepresentativeCode &&
      shop.partnerDevelopmentEligible !== true
    ) {
      updatePayload.partnerDevelopmentEligible = true;
      updatePayload.partnerDevelopmentRatePercent =
        shop.partnerDevelopmentRatePercent ?? piRate;
      updatePayload.shopIntroductionFirstOrderRatePercent =
        shop.shopIntroductionFirstOrderRatePercent ?? siRate;
    } else if (!shop.shopIntroductionFirstOrderRatePercent) {
      updatePayload.shopIntroductionFirstOrderRatePercent = siRate;
    }

    // Operational Support stays Unassigned unless Admin already set it.
    // Never auto-stamp OS from hierarchy / operational links.

    if (!Object.keys(updatePayload).length) {
      return shop;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(shop._id, { $set: updatePayload }, { new: true })
      .exec();

    return updated || shop;
  }

  /**
   * First Order Partner Development applies only when the shop was created
   * after Rep2 was Add-to-Network linked under Rep1. Pre-link shops keep
   * full Shop Introduction on first order (no PD split).
   */
  async resolveShopPartnerDevelopmentEligibility(
    shop: {
      createdAt?: Date | string;
      partnerDevelopmentEligible?: boolean;
      partnerDevelopmentRatePercent?: number;
      shopIntroductionFirstOrderRatePercent?: number;
    },
    shopIntroductionCode?: string,
    partnerDevelopmentCode?: string,
  ): Promise<{
    eligible: boolean;
    ratePercent: number;
    shopIntroductionRatePercent: number;
  }> {
    const defaults = normalizeFirstOrderCommissionRates({
      role: UserRole.MASTER_PARTNER,
    });

    // Already confirmed eligible (frozen at shop assignment).
    if (shop.partnerDevelopmentEligible === true) {
      let shopIntroductionRatePercent =
        normalizeShopIntroductionFirstOrderRatePercent(
          shop.shopIntroductionFirstOrderRatePercent,
          UserRole.MASTER_PARTNER,
        );
      const ratePercent = normalizePartnerDevelopmentRatePercent(
        shop.partnerDevelopmentRatePercent,
        UserRole.MASTER_PARTNER,
      );
      return {
        eligible: true,
        ratePercent,
        shopIntroductionRatePercent,
      };
    }

    const introCode = normalizePartnerCode(shopIntroductionCode);
    const pdCode = normalizePartnerCode(partnerDevelopmentCode);
    if (!introCode || !pdCode || introCode === pdCode) {
      return {
        eligible: false,
        ratePercent: defaults.partnerDevelopmentRate,
        shopIntroductionRatePercent: defaults.shopIntroductionRate,
      };
    }

    const parent = await this.findByPartnerCode(pdCode);
    if (!parent || parent.role !== UserRole.MASTER_PARTNER) {
      return {
        eligible: false,
        ratePercent: defaults.partnerDevelopmentRate,
        shopIntroductionRatePercent: defaults.shopIntroductionRate,
      };
    }

    await this.ensureOperationalRepresentativeLinksMigrated(parent);

    const refreshedParent = await this.findOne(parent._id.toString());
    const links = refreshedParent?.operationalRepresentativeLinks || [];
    const link = links.find(
      (entry) => normalizePartnerCode(entry.partnerCode) === introCode,
    );

    if (!link?.linkedAt) {
      return {
        eligible: false,
        ratePercent: defaults.partnerDevelopmentRate,
        shopIntroductionRatePercent: defaults.shopIntroductionRate,
      };
    }

    const rates = (() => {
      try {
        return normalizeFirstOrderCommissionRates({
          shopIntroductionRate: link.firstOrderShopIntroductionRate,
          partnerDevelopmentRate: link.firstOrderPartnerDevelopmentRate,
          role: UserRole.MASTER_PARTNER,
        });
      } catch {
        return {
          shopIntroductionRate: normalizeShopIntroductionFirstOrderRatePercent(
            link.firstOrderShopIntroductionRate,
            UserRole.MASTER_PARTNER,
          ),
          partnerDevelopmentRate: normalizePartnerDevelopmentRatePercent(
            link.firstOrderPartnerDevelopmentRate,
            UserRole.MASTER_PARTNER,
          ),
        };
      }
    })();

    const shopCreatedAt = shop.createdAt
      ? new Date(shop.createdAt).getTime()
      : Date.now();
    const linkedAt = new Date(link.linkedAt).getTime();
    const eligible = shopCreatedAt >= linkedAt - 5000;
    return {
      eligible,
      ratePercent: rates.partnerDevelopmentRate,
      shopIntroductionRatePercent: rates.shopIntroductionRate,
    };
  }

  /** Migrate legacy string codes into structured links (linkedAt = now for unknown history). */
  async ensureOperationalRepresentativeLinksMigrated(
    owner: UserDocument,
  ): Promise<UserDocument> {
    if (owner.role !== UserRole.MASTER_PARTNER) return owner;

    const ownerCode = normalizePartnerCode(owner.partnerCode);
    const codes = (owner.operationalRepresentativeCodes || [])
      .map((code) => normalizePartnerCode(code))
      .filter((code): code is string => Boolean(code) && code !== ownerCode);
    const existingLinks = (owner.operationalRepresentativeLinks || []).filter(
      (link) => normalizePartnerCode(link.partnerCode) !== ownerCode,
    );
    const linkedCodes = new Set(
      existingLinks
        .map((link) => normalizePartnerCode(link.partnerCode))
        .filter(Boolean),
    );

    const hadSelfLink =
      (owner.operationalRepresentativeCodes || []).some(
        (code) => normalizePartnerCode(code) === ownerCode,
      ) ||
      (owner.operationalRepresentativeLinks || []).some(
        (link) => normalizePartnerCode(link.partnerCode) === ownerCode,
      );

    const missing = codes.filter((code) => !linkedCodes.has(code));
    if (missing.length === 0 && !hadSelfLink) return owner;

    // Legacy links without a known linkedAt: stamp "now" so only shops
    // created after this migration (and future links) get FO Partner Development.
    const legacyLinkedAt = new Date();
    const repDefaults = getDefaultFirstOrderCommissionRates(
      UserRole.MASTER_PARTNER,
    );
    const additions = missing.map((partnerCode) => ({
      partnerCode,
      linkedAt: legacyLinkedAt,
      firstOrderShopIntroductionRate: repDefaults.shopIntroductionRate,
      firstOrderPartnerDevelopmentRate: repDefaults.partnerDevelopmentRate,
    }));

    const nextLinks = [...existingLinks, ...additions];
    const updated = await this.userModel
      .findByIdAndUpdate(
        owner._id,
        {
          $set: {
            operationalRepresentativeCodes: codes,
            operationalRepresentativeLinks: nextLinks,
          },
        },
        { new: true },
      )
      .exec();

    return updated || owner;
  }

  /** Migrate operationalPromoterCodes into structured Promoter FO links. */
  async ensureOperationalPromoterLinksMigrated(
    owner: UserDocument,
  ): Promise<UserDocument> {
    if (owner.role !== UserRole.REGIONAL_PARTNER) return owner;

    const ownerCode = normalizePartnerCode(owner.partnerCode);
    const codes = (owner.operationalPromoterCodes || [])
      .map((code) => normalizePartnerCode(code))
      .filter((code): code is string => Boolean(code) && code !== ownerCode);
    const existingLinks = (owner.operationalPromoterLinks || []).filter(
      (link) => normalizePartnerCode(link.partnerCode) !== ownerCode,
    );
    const linkedCodes = new Set(
      existingLinks
        .map((link) => normalizePartnerCode(link.partnerCode))
        .filter(Boolean),
    );

    const hadSelfLink =
      (owner.operationalPromoterCodes || []).some(
        (code) => normalizePartnerCode(code) === ownerCode,
      ) ||
      (owner.operationalPromoterLinks || []).some(
        (link) => normalizePartnerCode(link.partnerCode) === ownerCode,
      );

    const missing = codes.filter((code) => !linkedCodes.has(code));
    if (missing.length === 0 && !hadSelfLink) return owner;

    const legacyLinkedAt = new Date();
    const promoterDefaults = getDefaultFirstOrderCommissionRates(
      UserRole.REGIONAL_PARTNER,
    );
    const additions = missing.map((partnerCode) => ({
      partnerCode,
      linkedAt: legacyLinkedAt,
      firstOrderShopIntroductionRate: promoterDefaults.shopIntroductionRate,
      firstOrderPartnerDevelopmentRate:
        promoterDefaults.partnerDevelopmentRate,
    }));

    const nextLinks = [...existingLinks, ...additions];
    const updated = await this.userModel
      .findByIdAndUpdate(
        owner._id,
        {
          $set: {
            operationalPromoterCodes: codes,
            operationalPromoterLinks: nextLinks,
          },
        },
        { new: true },
      )
      .exec();

    return updated || owner;
  }

  /**
   * Promoter-Network FO — EXACT same stamp model as Representative FO:
   *   shopIntroductionRepresentativeCode = child Promoter (P2)
   *   partnerDevelopmentRepresentativeCode = parent Promoter (P1)
   *   partnerDevelopmentEligible = true (when shop created after link)
   *   FO rates from operationalPromoterLinks
   *
   * Main applyOrderCommissions path then pays P2/P1 identically to R5/R4.
   */
  /**
   * Clear unpaid Promoter/Rep FO network stamps so a shop can be reassigned
   * after unlink / certifier transfer. Does NOT touch plain Rep SI stamps on
   * unlinked-promoter shops. Paid FO shops stay locked.
   */
  private async clearUnpaidFirstOrderNetworkStamps(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;
    if (shop.partnerDevelopmentCommissionPaid === true) return shop;

    // Only clear Promoter-Network FO stamps here.
    // Representative FO stamps (SI/PD on master_partner) must NOT be wiped when
    // assignShopPromoterNetworkEarnings runs on a Rep-referred shop.
    const isPromoterFoStamp =
      shop.partnerDevelopmentPromoterEligible === true ||
      !!normalizePartnerCode(shop.shopIntroductionPromoterCode) ||
      !!normalizePartnerCode(shop.partnerDevelopmentPromoterCode);

    if (!isPromoterFoStamp) return shop;

    const updated = await this.userModel
      .findByIdAndUpdate(
        shop._id,
        {
          $unset: {
            shopIntroductionRepresentativeCode: 1,
            shopIntroductionRepresentativeId: 1,
            partnerDevelopmentRepresentativeCode: 1,
            partnerDevelopmentRepresentativeId: 1,
            shopIntroductionPromoterCode: 1,
            shopIntroductionPromoterId: 1,
            partnerDevelopmentPromoterCode: 1,
            partnerDevelopmentPromoterId: 1,
            partnerDevelopmentRatePercent: 1,
            shopIntroductionFirstOrderRatePercent: 1,
            partnerDevelopmentPromoterRatePercent: 1,
            shopIntroductionPromoterFirstOrderRatePercent: 1,
          },
          $set: {
            partnerDevelopmentEligible: false,
            partnerDevelopmentPromoterEligible: false,
          },
        },
        { new: true },
      )
      .exec();
    return updated || shop;
  }

  async assignShopPromoterNetworkEarnings(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;

    const childCode = normalizePartnerCode(shop.referredByPartnerCode);
    if (!childCode) {
      return this.clearUnpaidFirstOrderNetworkStamps(shop);
    }

    const childPromoter = await this.findByPartnerCode(childCode);
    if (!childPromoter || childPromoter.role !== UserRole.REGIONAL_PARTNER) {
      return shop;
    }

    const defaultRates = getDefaultFirstOrderCommissionRates(
      UserRole.REGIONAL_PARTNER,
    );
    const siRate = resolveCommissionRatePercent(
      childPromoter.role,
      childPromoter.customCommissionRate,
    );
    const piRate =
      childPromoter.partnerIntroRatePercent != null &&
      !Number.isNaN(Number(childPromoter.partnerIntroRatePercent))
        ? Math.max(0, Math.min(100, Number(childPromoter.partnerIntroRatePercent)))
        : defaultRates.partnerDevelopmentRate;

    // Partner Intro: Promoter's Partner Intro (Promoter or REP), else operational parent Promoter.
    let partnerIntroCode =
      normalizePartnerCode(childPromoter.partnerDevelopmentRepresentativeCode) ||
      normalizePartnerCode(childPromoter.partnerDevelopmentPromoterCode);

    let partnerIntro: UserDocument | null = partnerIntroCode
      ? await this.findByPartnerCode(partnerIntroCode)
      : null;

    if (!partnerIntro) {
      const operationalParent = await this.userModel
        .findOne({
          role: UserRole.REGIONAL_PARTNER,
          operationalPromoterCodes: childCode,
        })
        .exec();
      if (operationalParent?.partnerCode) {
        partnerIntro = operationalParent;
        partnerIntroCode = normalizePartnerCode(operationalParent.partnerCode);
      }
    }

    // Promoter under REP with no explicit Partner Intro → parent REP.
    if (!partnerIntro) {
      const parentCode = normalizePartnerCode(
        childPromoter.referredByPartnerCode,
      );
      const parent = parentCode
        ? await this.findByPartnerCode(parentCode)
        : null;
      if (parent?.role === UserRole.MASTER_PARTNER) {
        partnerIntro = parent;
        partnerIntroCode = parentCode;
      }
    }

    const updatePayload: Record<string, unknown> = {
      shopIntroductionRepresentativeCode: childCode,
      shopIntroductionRepresentativeId: childPromoter._id,
      shopIntroductionPromoterCode: childCode,
      shopIntroductionPromoterId: childPromoter._id,
      shopIntroductionPromoterFirstOrderRatePercent: siRate,
    };
    // Do not overwrite Admin shop-level rate overrides.
    if (shop.shopIntroductionFirstOrderRatePercent == null) {
      updatePayload.shopIntroductionFirstOrderRatePercent = siRate;
    }

    if (
      partnerIntro &&
      partnerIntroCode &&
      partnerIntroCode !== childCode
    ) {
      updatePayload.partnerDevelopmentRepresentativeCode = partnerIntroCode;
      updatePayload.partnerDevelopmentRepresentativeId = partnerIntro._id;
      updatePayload.partnerDevelopmentEligible = true;
      updatePayload.partnerDevelopmentPromoterEligible = true;
      updatePayload.partnerDevelopmentPromoterRatePercent = piRate;
      if (shop.partnerDevelopmentRatePercent == null) {
        updatePayload.partnerDevelopmentRatePercent = piRate;
      }
      if (partnerIntro.role === UserRole.REGIONAL_PARTNER) {
        updatePayload.partnerDevelopmentPromoterCode = partnerIntroCode;
        updatePayload.partnerDevelopmentPromoterId = partnerIntro._id;
      }
    }

    // Operational Support stays Unassigned — Admin assigns REPs only.

    const updated = await this.userModel
      .findByIdAndUpdate(shop._id, { $set: updatePayload }, { new: true })
      .exec();
    return updated || shop;
  }

  async syncPromoterFirstOrderRatesToEligibleShops(
    childPromoterCode: string,
    rates: { shopIntroductionRate: number; partnerDevelopmentRate: number },
  ): Promise<number> {
    const childCode = normalizePartnerCode(childPromoterCode);
    if (!childCode) return 0;

    const baseFilter = {
      role: UserRole.CERTIFIED_SHOP,
      shopIntroductionRepresentativeCode: childCode,
      partnerDevelopmentEligible: true,
    };

    // Child FO % applies after first order too — always keep SI stamp live.
    const siResult = await this.userModel.updateMany(baseFilter, {
      $set: {
        shopIntroductionFirstOrderRatePercent: rates.shopIntroductionRate,
        shopIntroductionPromoterFirstOrderRatePercent:
          rates.shopIntroductionRate,
        shopIntroductionPromoterCode: childCode,
        partnerDevelopmentPromoterEligible: true,
      },
    });

    // Parent FO % is one-time — only update shops that have not locked PD yet.
    const pdResult = await this.userModel.updateMany(
      {
        ...baseFilter,
        partnerDevelopmentCommissionPaid: { $ne: true },
      },
      {
        $set: {
          partnerDevelopmentRatePercent: rates.partnerDevelopmentRate,
          partnerDevelopmentPromoterRatePercent: rates.partnerDevelopmentRate,
        },
      },
    );

    return Math.max(siResult.modifiedCount || 0, pdResult.modifiedCount || 0);
  }

  async markPartnerDevelopmentPromoterCommissionPaid(
    shopId: string,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(shopId, {
      partnerDevelopmentPromoterCommissionPaid: true,
    });
  }

  /** Lazily backfill a shop's Partner Development Representative if missing. */
  async ensureShopPartnerDevelopmentAssignment(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;
    if (shop.partnerDevelopmentRepresentativeCode) return shop;

    return this.assignShopEarningRepresentatives(shop);
  }

  /** When Rep 1 invites/adds Rep 2, Rep 1 becomes Rep 2's Partner Development Representative. */
  async assignRepresentativePartnerDevelopment(
    rep: UserDocument,
  ): Promise<UserDocument> {
    if (rep.role !== UserRole.MASTER_PARTNER) return rep;
    if (rep.partnerDevelopmentRepresentativeCode) return rep;

    const parentCode = normalizePartnerCode(rep.referredByPartnerCode);
    if (!parentCode) return rep;

    const parent = await this.findByPartnerCode(parentCode);
    if (!parent || parent.role !== UserRole.MASTER_PARTNER) return rep;

    const updated = await this.userModel
      .findByIdAndUpdate(
        rep._id,
        {
          partnerDevelopmentRepresentativeCode: normalizePartnerCode(
            parent.partnerCode,
          ),
        },
        { new: true },
      )
      .exec();

    return updated || rep;
  }

  /**
   * Backfill Shop Introduction / Operational Support on shops under a linked
   * Representative. Does NOT copy Partner Development onto pre-existing shops —
   * FO PD is only assigned at shop create time after Add-to-Network.
   */
  async backfillShopEarningAssignmentsForRepresentative(
    representative: UserDocument,
  ): Promise<void> {
    if (representative.role !== UserRole.MASTER_PARTNER) return;

    const network = await this.findNetworkUsersForViewer(representative);

    for (const shop of network.shops) {
      const fullShop = await this.findOne(shop._id.toString());
      if (!fullShop) continue;
      await this.assignShopEarningRepresentatives(fullShop);
    }
  }

  /**
   * Ensure Rep↔shop Partner Development links are set so first-order repair can
   * find shops. Covers:
   * - Parent Rep: operationally linked children inherit this parent as PD
   * - Child Rep: their shops inherit their partnerDevelopmentRepresentativeCode
   */
  async ensurePartnerDevelopmentNetworkForRepresentative(
    representativeCode: string,
  ): Promise<void> {
    const code = normalizePartnerCode(representativeCode);
    if (!code) return;

    const rep = await this.findByPartnerCode(code);
    if (!rep || rep.role !== UserRole.MASTER_PARTNER) return;

    // Ensure this Rep's PD parent is set from referredBy when missing.
    let refreshed = await this.assignRepresentativePartnerDevelopment(rep);

    // As parent: link operational children → this Rep as PD parent, then backfill shops.
    const childCodes = (refreshed.operationalRepresentativeCodes || [])
      .map((c) => normalizePartnerCode(c))
      .filter(Boolean);

    for (const childCode of childCodes) {
      const child = await this.findByPartnerCode(childCode);
      if (!child || child.role !== UserRole.MASTER_PARTNER) continue;

      if (!normalizePartnerCode(child.partnerDevelopmentRepresentativeCode)) {
        await this.userModel.findByIdAndUpdate(child._id, {
          partnerDevelopmentRepresentativeCode: code,
        });
      }

      const childFresh = await this.findOne(child._id.toString());
      if (childFresh) {
        await this.backfillShopEarningAssignmentsForRepresentative(childFresh);
      }
    }

    // As shop-intro Rep (or after refresh): backfill this Rep's own shops with PD parent.
    refreshed = (await this.findOne(refreshed._id.toString())) || refreshed;
    await this.backfillShopEarningAssignmentsForRepresentative(refreshed);

    // Any other Rep already pointing at this parent as PD — backfill their shops too.
    const otherChildren = await this.userModel
      .find({
        role: UserRole.MASTER_PARTNER,
        partnerDevelopmentRepresentativeCode: code,
        partnerCode: { $nin: childCodes.length ? childCodes : ['__none__'] },
      })
      .exec();

    for (const child of otherChildren) {
      await this.backfillShopEarningAssignmentsForRepresentative(child);
    }
  }

  /**
   * Ensure Promoter↔shop FO Partner Development links are set so first-order
   * repair can find shops (mirror of ensurePartnerDevelopmentNetworkForRepresentative).
   */
  async ensurePartnerDevelopmentNetworkForPromoter(
    promoterCode: string,
  ): Promise<void> {
    const code = normalizePartnerCode(promoterCode);
    if (!code) return;

    const promoter = await this.findByPartnerCode(code);
    if (!promoter || promoter.role !== UserRole.REGIONAL_PARTNER) return;

    await this.ensureOperationalPromoterLinksMigrated(promoter);
    let refreshed =
      (await this.findOne(promoter._id.toString())) || promoter;

    const childCodes = (refreshed.operationalPromoterCodes || [])
      .map((c) => normalizePartnerCode(c))
      .filter(Boolean);

    for (const childCode of childCodes) {
      const child = await this.findByPartnerCode(childCode);
      if (!child || child.role !== UserRole.REGIONAL_PARTNER) continue;

      if (!normalizePartnerCode(child.partnerDevelopmentPromoterCode)) {
        await this.userModel.findByIdAndUpdate(child._id, {
          partnerDevelopmentPromoterCode: code,
          partnerDevelopmentPromoterId: refreshed._id,
        });
      }

      const childFresh = await this.findOne(child._id.toString());
      if (!childFresh) continue;

      const network = await this.findNetworkUsersForViewer(childFresh);
      for (const shop of network.shops) {
        const fullShop = await this.findOne(shop._id.toString());
        if (fullShop) {
          await this.assignShopPromoterNetworkEarnings(fullShop);
        }
      }
    }

    refreshed = (await this.findOne(refreshed._id.toString())) || refreshed;
    const ownNetwork = await this.findNetworkUsersForViewer(refreshed);
    for (const shop of ownNetwork.shops) {
      const fullShop = await this.findOne(shop._id.toString());
      if (fullShop) {
        await this.assignShopPromoterNetworkEarnings(fullShop);
      }
    }

    const otherChildren = await this.userModel
      .find({
        role: UserRole.REGIONAL_PARTNER,
        partnerDevelopmentPromoterCode: code,
        partnerCode: { $nin: childCodes.length ? childCodes : ['__none__'] },
      })
      .exec();

    for (const child of otherChildren) {
      const network = await this.findNetworkUsersForViewer(child);
      for (const shop of network.shops) {
        const fullShop = await this.findOne(shop._id.toString());
        if (fullShop) {
          await this.assignShopPromoterNetworkEarnings(fullShop);
        }
      }
    }
  }

  /**
   * Read current FO rates from the parent→child operational link.
   * Used so admin rate edits apply to shops before first-order PD is paid.
   */
  async getLiveFirstOrderRatesForChildRep(
    childRepCode?: string,
    parentRepCode?: string,
  ): Promise<{
    shopIntroductionRate: number;
    partnerDevelopmentRate: number;
  } | null> {
    const introCode = normalizePartnerCode(childRepCode);
    const pdCode = normalizePartnerCode(parentRepCode);
    if (!introCode) return null;

    // Promoter Network FO rates (child SI code is a Promoter)
    const childUser = await this.findByPartnerCode(introCode);
    if (childUser?.role === UserRole.REGIONAL_PARTNER) {
      let parent = pdCode ? await this.findByPartnerCode(pdCode) : null;
      if (!parent || parent.role !== UserRole.REGIONAL_PARTNER) {
        parent = await this.userModel
          .findOne({
            role: UserRole.REGIONAL_PARTNER,
            operationalPromoterCodes: introCode,
          })
          .exec();
      }
      if (parent?.role === UserRole.REGIONAL_PARTNER) {
        await this.ensureOperationalPromoterLinksMigrated(parent);
        const refreshed = await this.findOne(parent._id.toString());
        const link = (refreshed?.operationalPromoterLinks || []).find(
          (entry) => normalizePartnerCode(entry.partnerCode) === introCode,
        );
        if (link) {
          try {
            return normalizeFirstOrderCommissionRates({
              shopIntroductionRate: link.firstOrderShopIntroductionRate,
              partnerDevelopmentRate: link.firstOrderPartnerDevelopmentRate,
              role: UserRole.REGIONAL_PARTNER,
            });
          } catch {
            return {
              shopIntroductionRate:
                normalizeShopIntroductionFirstOrderRatePercent(
                  link.firstOrderShopIntroductionRate,
                  UserRole.REGIONAL_PARTNER,
                ),
              partnerDevelopmentRate: normalizePartnerDevelopmentRatePercent(
                link.firstOrderPartnerDevelopmentRate,
                UserRole.REGIONAL_PARTNER,
              ),
            };
          }
        }
      }
    }

    let parent = pdCode ? await this.findByPartnerCode(pdCode) : null;
    if (!parent || parent.role !== UserRole.MASTER_PARTNER) {
      parent = await this.userModel
        .findOne({
          role: UserRole.MASTER_PARTNER,
          operationalRepresentativeCodes: introCode,
        })
        .exec();
    }
    if (!parent) return null;

    await this.ensureOperationalRepresentativeLinksMigrated(parent);
    const refreshed = await this.findOne(parent._id.toString());
    const link = (refreshed?.operationalRepresentativeLinks || []).find(
      (entry) => normalizePartnerCode(entry.partnerCode) === introCode,
    );
    if (!link) return null;

    try {
      return normalizeFirstOrderCommissionRates({
        shopIntroductionRate: link.firstOrderShopIntroductionRate,
        role: UserRole.MASTER_PARTNER,
        partnerDevelopmentRate: link.firstOrderPartnerDevelopmentRate,
      });
    } catch {
      return {
        shopIntroductionRate: normalizeShopIntroductionFirstOrderRatePercent(
          link.firstOrderShopIntroductionRate,
          UserRole.MASTER_PARTNER,
        ),
        partnerDevelopmentRate: normalizePartnerDevelopmentRatePercent(
          link.firstOrderPartnerDevelopmentRate,
          UserRole.MASTER_PARTNER,
        ),
      };
    }
  }

  /**
   * Push latest link FO rates onto FO-eligible shops under the child Rep.
   * Child SI % always syncs (used on first + later orders).
   * Parent PD % syncs only while first-order Partner Development is unpaid.
   */
  async syncFirstOrderRatesToEligibleShops(
    childRepCode: string,
    rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    },
  ): Promise<number> {
    const code = normalizePartnerCode(childRepCode);
    if (!code) return 0;

    const baseFilter = {
      role: UserRole.CERTIFIED_SHOP,
      shopIntroductionRepresentativeCode: code,
      partnerDevelopmentEligible: true,
    };

    // Child FO % applies after first order too — always keep SI stamp live.
    const siResult = await this.userModel.updateMany(baseFilter, {
      $set: {
        shopIntroductionFirstOrderRatePercent: rates.shopIntroductionRate,
      },
    });

    // Parent FO % is one-time — only update shops that have not locked PD yet.
    const pdResult = await this.userModel.updateMany(
      {
        ...baseFilter,
        partnerDevelopmentCommissionPaid: { $ne: true },
      },
      {
        $set: {
          partnerDevelopmentRatePercent: rates.partnerDevelopmentRate,
        },
      },
    );

    return Math.max(siResult.modifiedCount || 0, pdResult.modifiedCount || 0);
  }

  /**
   * Refresh FO rates from the live Add-to-Network link.
   * Child SI % always refreshes (subsequent orders use it).
   * Parent PD % refreshes only until Partner Development is locked.
   */
  async refreshShopFirstOrderRatesIfUnpaid(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;
    if (shop.partnerDevelopmentEligible !== true) return shop;

    const live = await this.getLiveFirstOrderRatesForChildRep(
      shop.shopIntroductionRepresentativeCode,
      shop.partnerDevelopmentRepresentativeCode,
    );
    if (!live) return shop;

    const pdLocked = shop.partnerDevelopmentCommissionPaid === true;
    const currentSi = Number(shop.shopIntroductionFirstOrderRatePercent);
    const currentPd = Number(shop.partnerDevelopmentRatePercent);
    const siMatches = currentSi === live.shopIntroductionRate;
    const pdMatches =
      pdLocked || currentPd === live.partnerDevelopmentRate;
    if (siMatches && pdMatches) {
      return shop;
    }

    const updatePayload: Record<string, unknown> = {
      shopIntroductionFirstOrderRatePercent: live.shopIntroductionRate,
    };
    if (!pdLocked) {
      updatePayload.partnerDevelopmentRatePercent =
        live.partnerDevelopmentRate;
    }
    if (shop.partnerDevelopmentPromoterEligible === true) {
      updatePayload.shopIntroductionPromoterFirstOrderRatePercent =
        live.shopIntroductionRate;
      if (!pdLocked) {
        updatePayload.partnerDevelopmentPromoterRatePercent =
          live.partnerDevelopmentRate;
      }
    }

    const updated = await this.userModel
      .findByIdAndUpdate(shop._id, updatePayload, { new: true })
      .exec();

    return updated || shop;
  }

  /**
   * Shops whose Partner Development commission is still owed to `parentCode`
   * (i.e. `partnerDevelopmentRepresentativeCode` matches and the shop-level
   * `partnerDevelopmentCommissionPaid` flag is not yet true). Partner
   * Development is paid once per SHOP's first successful order, not once
   * per child Representative.
   */
  async findShopsPendingPartnerDevelopment(
    parentCode: string,
  ): Promise<UserDocument[]> {
    const code = normalizePartnerCode(parentCode);
    if (!code) return [];
    return this.userModel
      .find({
        role: UserRole.CERTIFIED_SHOP,
        partnerDevelopmentRepresentativeCode: code,
        partnerDevelopmentEligible: true,
        partnerDevelopmentCommissionPaid: { $ne: true },
      })
      .exec();
  }

  /** Lock Partner Development after it is paid on a shop's first order. */
  async markPartnerDevelopmentCommissionPaid(shopId: string): Promise<void> {
    if (!shopId) return;
    await this.userModel.findByIdAndUpdate(shopId, {
      partnerDevelopmentCommissionPaid: true,
    });
  }

  /** Shops whose Shop Introduction Representative is `repCode`. */
  async findShopsByIntroductionRep(repCode: string): Promise<UserDocument[]> {
    const code = normalizePartnerCode(repCode);
    if (!code) return [];
    return this.userModel
      .find({
        role: UserRole.CERTIFIED_SHOP,
        shopIntroductionRepresentativeCode: code,
      })
      .exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel
      .find()
      .select('-password -refreshTokenHash -resetPasswordToken -resetPasswordExpires')
      .populate('productGroup')
      .populate('blockedBy', 'firstName lastName role')
      .lean()
      .exec() as Promise<UserDocument[]>;
  }

  async findOne(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findAdminUsers(): Promise<UserDocument[]> {
    return this.userModel
      .find({ role: UserRole.ADMIN })
      .select('_id firstName lastName email role')
      .exec();
  }

  /** Lightweight lookup for JWT validation (excludes secrets). */
  async findOneForAuth(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findById(id)
      .select('-password -refreshTokenHash -resetPasswordToken -resetPasswordExpires')
      .exec();
  }

  async setRefreshTokenHash(
    userId: string,
    refreshTokenHash: string | null,
  ): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { refreshTokenHash: refreshTokenHash ?? null },
    });
  }

  async getRefreshTokenRecord(
    userId: string,
  ): Promise<{ refreshTokenHash?: string; status?: string } | null> {
    return this.userModel
      .findById(userId)
      .select('refreshTokenHash status')
      .lean()
      .exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: emailEqualsQuery(email) })
      .exec();
  }

  async findByUsernameOrEmail(
    identifier: string,
  ): Promise<UserDocument | null> {
    const trimmed = identifier.trim();
    return this.userModel
      .findOne({
        $or: [
          { email: emailEqualsQuery(trimmed) },
          { username: trimmed },
        ],
      })
      .exec();
  }

  /** Find a user by email/username whose role is in the given set (portal-scoped login). */
  async findByUsernameOrEmailForRoles(
    identifier: string,
    roles: UserRole[],
  ): Promise<UserDocument | null> {
    if (!roles.length) return null;
    const trimmed = identifier.trim();
    return this.userModel
      .findOne({
        role: { $in: roles },
        $or: [
          { email: emailEqualsQuery(trimmed) },
          { username: trimmed },
        ],
      })
      .exec();
  }

  async findByEmailForRoles(
    email: string,
    roles: UserRole[],
  ): Promise<UserDocument | null> {
    if (!roles.length) return null;
    return this.userModel
      .findOne({ email: emailEqualsQuery(email), role: { $in: roles } })
      .exec();
  }

  /**
   * Email may be reused across portals (shop vs partner network), but not
   * within the same portal group (e.g. two partner roles, or two shops).
   */
  async assertEmailAvailableForRole(
    email: string,
    role: UserRole,
    excludeUserId?: string,
  ): Promise<void> {
    const conflictingRoles = this.getEmailConflictRoles(role);
    const query: Record<string, unknown> = {
      email: emailEqualsQuery(email),
      role: { $in: conflictingRoles },
    };
    if (excludeUserId) {
      query._id = { $ne: excludeUserId };
    }
    const existing = await this.userModel.findOne(query).exec();
    if (!existing) return;

    if (role === UserRole.CERTIFIED_SHOP) {
      throw new BadRequestException(
        'A shop account with this email already exists',
      );
    }
    if (isPartnerNetworkRole(role)) {
      throw new BadRequestException(
        'A partner network account with this email already exists',
      );
    }
    throw new BadRequestException('User already exists (email)');
  }

  private getEmailConflictRoles(role: UserRole): UserRole[] {
    if (role === UserRole.CERTIFIED_SHOP) {
      return [UserRole.CERTIFIED_SHOP];
    }
    if (isPartnerNetworkRole(role) || role === UserRole.SUB_PROMOTER) {
      return [
        ...PARTNER_NETWORK_ROLES,
        UserRole.SUB_PROMOTER,
      ] as UserRole[];
    }
    return [role];
  }

  /**
   * Drop the old globally-unique email index so shop + partner can share an email.
   * Ensures compound unique (email + role). Safe to re-run.
   */
  private async migrateEmailIndexes(): Promise<void> {
    const collection = this.userModel.collection;
    let indexes: Array<{ name?: string; key?: Record<string, unknown> }> = [];
    try {
      indexes = (await collection.indexes()) as typeof indexes;
    } catch (err) {
      this.logger.warn(
        `[UsersService] Could not list indexes for email migration: ${err}`,
      );
      return;
    }

    for (const idx of indexes) {
      if (!idx.name || idx.name === '_id_') continue;
      const keys = Object.keys(idx.key || {});
      // Legacy: unique on email alone (email_1) — blocks same email across portals
      const isLegacyEmailOnly =
        keys.length === 1 &&
        keys[0] === 'email' &&
        idx.name !== 'email_1_role_1';
      if (isLegacyEmailOnly) {
        try {
          await collection.dropIndex(idx.name);
          this.logger.log(
            `Dropped legacy email index "${idx.name}" (email is now unique per role).`,
          );
        } catch (err: any) {
          this.logger.warn(
            `Could not drop index "${idx.name}": ${err?.message || err}`,
          );
        }
      }
    }

    // Ensure compound unique exists even if syncIndexes is skipped/fails
    try {
      await collection.createIndex(
        { email: 1, role: 1 },
        { unique: true, sparse: true, name: 'email_1_role_1' },
      );
      this.logger.log('Ensured compound unique index email_1_role_1');
    } catch (err: any) {
      // Already exists with same options — fine
      if (err?.code !== 85 && err?.code !== 86) {
        this.logger.warn(
          `Could not ensure email_1_role_1 index: ${err?.message || err}`,
        );
      }
    }
  }

  async findByAccessCode(accessCode: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ accessCode }).exec();
  }

  async findByPartnerCode(partnerCode: string): Promise<UserDocument | null> {
    const normalized = normalizePartnerCode(partnerCode);
    if (!normalized) return null;
    // Case-insensitive match for legacy rows that differ only by casing.
    return this.userModel
      .findOne({
        partnerCode: {
          $regex: `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
          $options: 'i',
        },
      })
      .exec();
  }

  /** Resolve the shop's assigned Representative (local point of contact). */
  async getLocalRepresentativeForShop(user: UserDocument) {
    if (user.role !== UserRole.CERTIFIED_SHOP) {
      return null;
    }

    const lookup = async (partnerCode: string) => {
      const match = await this.findByPartnerCode(partnerCode?.trim());
      if (!match) return null;
      return {
        _id: match._id,
        partnerCode: match.partnerCode,
        role: match.role,
        referredByPartnerCode: match.referredByPartnerCode,
        customCommissionRate: match.customCommissionRate,
      };
    };

    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: user.referredByPartnerCode },
      lookup,
    );

    const repCode = chain.represented?.partnerCode;
    if (!repCode) return null;

    const rep = await this.findByPartnerCode(repCode);
    if (!rep) return null;

    const fullName = [rep.firstName, rep.lastName].filter(Boolean).join(' ').trim();

    return {
      firstName: rep.firstName,
      lastName: rep.lastName,
      fullName: fullName || rep.partnerCode,
      email: rep.email || null,
      phoneNumber: rep.phoneNumber || null,
      partnerCode: rep.partnerCode,
      profileImage: rep.profileImage || null,
    };
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    currentUser: UserDocument,
  ): Promise<UserDocument | null> {
    console.log(
      `[UsersService] Updating user ${id} by ${currentUser.email} with DTO:`,
      JSON.stringify(updateUserDto, null, 2),
    );

    // Sub-Promoter role removed — use Promoter + Promoter Network linking instead
    if (updateUserDto.role === UserRole.SUB_PROMOTER) {
      throw new BadRequestException(
        'Sub-Promoter role has been removed. Use Promoter and link via Promoter Network (Add to Network).',
      );
    }

    // Permission check: Non-admins can only update themselves or shops they referred
    if (currentUser.role !== UserRole.ADMIN) {
      const targetUser = await this.userModel.findById(id);
      if (!targetUser) throw new BadRequestException('User not found');

      // Allow self-update (e.g., training-complete)
      const isSelfUpdate = currentUser._id.toString() === targetUser._id.toString();

      const isGlobalPartner = isGlobalHubPartnerCode(currentUser.partnerCode);
      const inNetwork = await this.isUserInViewerNetwork(
        currentUser,
        targetUser._id.toString(),
      );

      if (!isSelfUpdate && !isGlobalPartner && !inNetwork) {
        throw new ForbiddenException('You do not have permission to update this user');
      }

      if (
        updateUserDto.isCertified === true &&
        !canCertifyShops(currentUser.role, currentUser.partnerCode)
      ) {
        throw new ForbiddenException(
          'You do not have permission to certify this shop.',
        );
      }

      // Optional: Restrict what fields a Partner can update
      // For now, let's just proceed since we trust the DTO validation for other roles
    }

    const updatePayload: any = { ...updateUserDto };
    const partnerIntroProvided = updateUserDto.partnerIntroCode !== undefined;
    const partnerIntroCode = normalizePartnerCode(updateUserDto.partnerIntroCode);
    const operationalSupportCodeRaw =
      updateUserDto.operationalSupportRepresentativeCode;
    delete updatePayload.firstOrderShopIntroductionRate;
    delete updatePayload.firstOrderPartnerDevelopmentRate;
    delete updatePayload.partnerIntroCode;
    delete updatePayload.operationalSupportRepresentativeCode;

    const targetUserForHierarchy = await this.userModel.findById(id);
    if (!targetUserForHierarchy) {
      throw new BadRequestException('User not found');
    }

    // Handle Blocking/Unblocking Logic and Overrides
    if (updatePayload.status) {
      if (updatePayload.status === UserStatus.BLOCKED) {
        updatePayload.blockedBy = currentUser._id;
        // Always hide from map when blocked
        updatePayload.isVisibleOnMap = false;
      } else if (updatePayload.status === UserStatus.ACTIVE) {
        const targetUser = await this.userModel.findById(id);
        if (targetUser && targetUser.status === UserStatus.BLOCKED) {
           // If Admin is unblocking, it overrides anything
           if (currentUser.role === UserRole.ADMIN) {
             updatePayload.blockedBy = null;
             updatePayload.blockedReason = 'Unblocked by Admin';
           } else {
             // If Partner is unblocking, check if they were the one who blocked it
             // Actually, the request says Partner should be able to block/unblock their own shops
             // but Admin can override. 
             // If Admin blocked it, maybe Partner shouldn't be able to unblock?
             if (targetUser.blockedBy && targetUser.blockedBy.toString() !== currentUser._id.toString()) {
                const blocker = await this.userModel.findById(targetUser.blockedBy);
                if (blocker && (blocker.role as any) === UserRole.ADMIN && (currentUser.role as any) !== UserRole.ADMIN) {
                  throw new ForbiddenException('This user was blocked by an Admin and cannot be unblocked by a Partner.');
                }
             }
             updatePayload.blockedBy = null;
           }
        }
      }
    }

    const partnerRoles = [
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      // UserRole.SUB_PROMOTER, // removed
      UserRole.DISTRIBUTOR,
      UserRole.PARTNER,
    ];

    // partnerCode cleanup to avoid duplicate key errors on empty strings (sparse index only allows one "")
    if (updatePayload.partnerCode) {
      updatePayload.partnerCode = updatePayload.partnerCode.toString().trim();
      if (updatePayload.partnerCode === '') delete updatePayload.partnerCode;
    } else if (updatePayload.partnerCode === '') {
      delete updatePayload.partnerCode;
    }

    const roleAfterUpdate =
      (updatePayload.role ?? targetUserForHierarchy.role) as UserRole;

    if (
      updatePayload.partnerCode !== undefined &&
      partnerRoles.includes(roleAfterUpdate)
    ) {
      const codeError = validatePartnerCode(
        updatePayload.partnerCode,
        roleAfterUpdate,
      );
      if (codeError) {
        throw new BadRequestException(codeError);
      }

      updatePayload.partnerCode = normalizePartnerCode(updatePayload.partnerCode);

      const duplicateCode = await this.userModel.findOne({
        partnerCode: updatePayload.partnerCode,
        _id: { $ne: id },
      });
      if (duplicateCode) {
        throw new BadRequestException(
          `${getNetworkIdLabel(roleAfterUpdate)} already exists — choose a unique ID`,
        );
      }
    }

    // Clean up other unique fields if they are empty strings
    if (updatePayload.email === '') delete updatePayload.email;
    if (updatePayload.username === '') delete updatePayload.username;

    if (updatePayload.email) {
      updatePayload.email = normalizeEmail(updatePayload.email);
    }

    if (
      updatePayload.email &&
      updatePayload.email !== targetUserForHierarchy.email
    ) {
      await this.assertEmailAvailableForRole(
        updatePayload.email,
        roleAfterUpdate,
        id,
      );
    }

    if (updatePayload.password) {
      updatePayload.password = await bcrypt.hash(updatePayload.password, 10);
    }
    if (updatePayload.productGroup === '') {
      updatePayload.productGroup = null;
    }
    if (updatePayload.referredByPartnerCode === '') {
      updatePayload.referredByPartnerCode = null;
    }

    if (updatePayload.customCommissionRate !== undefined) {
      if (currentUser.role !== UserRole.ADMIN) {
        delete updatePayload.customCommissionRate;
      } else {
        this.normalizeCustomCommissionRate(roleAfterUpdate, updatePayload);
      }
    }

    if (updatePayload.partnerIntroRatePercent !== undefined) {
      if (currentUser.role !== UserRole.ADMIN) {
        delete updatePayload.partnerIntroRatePercent;
      } else {
        this.normalizePartnerIntroRatePercent(roleAfterUpdate, updatePayload);
      }
    }

    // Shop-only commission rate overrides (Admin).
    if (targetUserForHierarchy.role !== UserRole.CERTIFIED_SHOP) {
      delete updatePayload.shopIntroductionFirstOrderRatePercent;
      delete updatePayload.partnerDevelopmentRatePercent;
      delete updatePayload.operationalSupportRatePercent;
    } else if (currentUser.role === UserRole.ADMIN) {
      this.normalizeShopCommissionRateField(
        updatePayload,
        'shopIntroductionFirstOrderRatePercent',
      );
      this.normalizeShopCommissionRateField(
        updatePayload,
        'partnerDevelopmentRatePercent',
      );
      this.normalizeShopCommissionRateField(
        updatePayload,
        'operationalSupportRatePercent',
      );
    } else {
      delete updatePayload.shopIntroductionFirstOrderRatePercent;
      delete updatePayload.partnerDevelopmentRatePercent;
      delete updatePayload.operationalSupportRatePercent;
    }

    if (
      updatePayload.role !== undefined &&
      updatePayload.role !== targetUserForHierarchy.role &&
      (updatePayload.email || targetUserForHierarchy.email)
    ) {
      await this.assertEmailAvailableForRole(
        updatePayload.email || targetUserForHierarchy.email!,
        updatePayload.role as UserRole,
        id,
      );
    }

    const hierarchyFieldsTouched =
      updatePayload.role !== undefined ||
      updatePayload.referredByPartnerCode !== undefined;

    if (hierarchyFieldsTouched) {
      const finalRole = (updatePayload.role ?? targetUserForHierarchy.role) as UserRole;
      const finalReferral =
        updatePayload.referredByPartnerCode !== undefined
          ? updatePayload.referredByPartnerCode
          : targetUserForHierarchy.referredByPartnerCode;

      if (finalRole === UserRole.PARTNER) {
        updatePayload.referredByPartnerCode = null;
      } else if (requiresParentLink(finalRole)) {
        await this.validateHierarchyLink(finalRole, finalReferral, id);
      }
    }

    // Auto-enable map visibility when a shop is certified
    if (updatePayload.isCertified === true) {
      updatePayload.isVisibleOnMap = true;
      
      // Assign certificate number if not already present
      const targetUser = await this.userModel.findById(id);
      if (targetUser && !targetUser.certificateNumber) {
        updatePayload.certificateNumber = await this.getNextCertificateNumber();
      }
    }

    // Explicitly sync isPartnerPaid to its DB name isDistributorPaid to ensure persistence during raw updates
    if (updatePayload.isPartnerPaid !== undefined) {
      updatePayload.isDistributorPaid = updatePayload.isPartnerPaid;
    }

    console.log(`[UsersService] Final Update Payload for ${id}:`, JSON.stringify(updatePayload, null, 2));

    // Capture location related fields to see if geocoding is needed
    const { address, city, country, latitude, longitude } = updatePayload;

    // If address changed and coordinates are NOT manually provided in this update, re-geocode
    if ((address || city || country) && (!latitude && !longitude)) {
      // Get current user data to merge with update for geocoding query
      const currentUser = await this.userModel.findById(id);
      if (currentUser) {
        const qAddress = address || currentUser.address;
        const qCity = city || currentUser.city;
        const qCountry = country || currentUser.country;

        if (qAddress && qCity && qCountry) {
          const coords = await this.fetchCoordinates(qAddress, qCity, qCountry);
          if (coords) {
            updatePayload.latitude = coords.latitude;
            updatePayload.longitude = coords.longitude;
            console.log(`[Geocoding] Updated coordinates for ${currentUser.email}:`, coords);
          }
        }
      }
    }

    // Shop Network: Admin may assign / clear Operational Support (REP only).
    if (
      targetUserForHierarchy.role === UserRole.CERTIFIED_SHOP &&
      operationalSupportCodeRaw !== undefined
    ) {
      const osCode = normalizePartnerCode(operationalSupportCodeRaw || '');
      if (!osCode) {
        updatePayload.operationalSupportRepresentativeCode = null;
        updatePayload.operationalSupportRepresentativeId = null;
      } else {
        const osRep = await this.findByPartnerCode(osCode);
        if (!osRep || osRep.role !== UserRole.MASTER_PARTNER) {
          throw new BadRequestException(
            'Operational Support must be a Representative.',
          );
        }
        updatePayload.operationalSupportRepresentativeCode = osCode;
        updatePayload.operationalSupportRepresentativeId = osRep._id;
      }
    }

    const previousStatus = targetUserForHierarchy.status;

    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .exec();

    if (
      updatedUser &&
      updatePayload.status &&
      updatePayload.status !== previousStatus
    ) {
      let action = UserActivityAction.STATUS_CHANGE;
      if (updatePayload.status === UserStatus.BLOCKED) {
        action = UserActivityAction.USER_BLOCKED;
      } else if (
        updatePayload.status === UserStatus.ACTIVE &&
        previousStatus === UserStatus.BLOCKED
      ) {
        action = UserActivityAction.USER_UNBLOCKED;
      }

      await this.userActivityService.log({
        userId: id,
        action,
        actorId: currentUser._id?.toString(),
        portal: currentUser.role === UserRole.ADMIN ? 'admin' : 'partner',
        country: updatedUser.country,
        metadata: {
          method: 'status_update',
          previousStatus,
          newStatus: updatePayload.status,
          blockedReason: updatePayload.blockedReason || updateUserDto.blockedReason,
          targetEmail: updatedUser.email,
          targetRole: updatedUser.role,
          country: updatedUser.country,
          partnerCode: updatedUser.partnerCode,
          actorEmail: currentUser.email,
          actorRole: currentUser.role,
        },
      });
    }

    if (
      updatedUser &&
      (updatedUser.role === UserRole.MASTER_PARTNER ||
        updatedUser.role === UserRole.REGIONAL_PARTNER)
    ) {
      // Explicit clear of optional Partner Intro (Hub-parent REP / Promoter).
      if (partnerIntroProvided && !partnerIntroCode && !hierarchyFieldsTouched) {
        const parentCode = normalizePartnerCode(updatedUser.referredByPartnerCode);
        const parent = parentCode
          ? await this.findByPartnerCode(parentCode)
          : null;
        const autoPartnerIntroParent =
          updatedUser.role === UserRole.REGIONAL_PARTNER &&
          parent &&
          (parent.role === UserRole.MASTER_PARTNER ||
            parent.role === UserRole.REGIONAL_PARTNER);
        if (!autoPartnerIntroParent) {
          return this.clearPartnerIntroOnUser(updatedUser);
        }
      }

      if (partnerIntroCode || hierarchyFieldsTouched) {
        return this.applyPartnerIntroOnCreate(updatedUser, partnerIntroCode);
      }
    }

    return updatedUser;
  }

  async remove(id: string): Promise<UserDocument | null> {
    const user = await this.userModel.findById(id);
    // Role-based deletion blocks removed per user request to allow full management of all accounts
    return this.userModel.findByIdAndDelete(id).exec();
    return this.userModel.findByIdAndDelete(id).exec();
  }

  async migratePartnerRolesToRepresented(): Promise<{
    partner: number;
    regional: number;
  }> {
    const hubResult = await this.userModel.updateMany(
      { role: UserRole.PARTNER },
      { $set: { role: UserRole.MASTER_PARTNER } },
    );
    const promoterResult = await this.userModel.updateMany(
      { role: UserRole.REGIONAL_PARTNER },
      { $set: { role: UserRole.MASTER_PARTNER } },
    );
    return {
      partner: hubResult.modifiedCount,
      regional: promoterResult.modifiedCount,
    };
  }

  async getStats() {
    return this.cache.wrap(CacheKeys.usersStats, CacheTtl.usersStats, async () => {
      // Parallel counts — same results as sequential, faster under load
      const [
        total,
        admin,
        master_partner,
        distributor,
        regional_partner,
        partner,
        certified_shop,
        recentUsers,
      ] = await Promise.all([
        this.userModel.countDocuments(),
        this.userModel.countDocuments({ role: UserRole.ADMIN }),
        this.userModel.countDocuments({ role: UserRole.MASTER_PARTNER }),
        this.userModel.countDocuments({ role: UserRole.DISTRIBUTOR }),
        this.userModel.countDocuments({ role: UserRole.REGIONAL_PARTNER }),
        this.userModel.countDocuments({ role: UserRole.PARTNER }),
        this.userModel.countDocuments({ role: UserRole.CERTIFIED_SHOP }),
        this.userModel
          .find({ role: { $ne: UserRole.ADMIN } })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('firstName lastName email role partnerCode shopName createdAt')
          .lean()
          .exec(),
      ]);

      // Sub-Promoter role removed — keep key for admin dashboard shape compatibility
      const sub_promoter = 0;

      return {
        total,
        admin,
        master_partner,
        distributor,
        regional_partner,
        partner,
        certified_shop,
        sub_promoter,
        recentUsers,
      };
    });
  }

  async completeCourse(
    userId: string,
    courseName: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $addToSet: { completedCourses: courseName } },
        { new: true },
      )
      .exec();
  }
  async updateCourseProgress(
    userId: string,
    courseName: string,
    stepId: string,
  ): Promise<UserDocument | null> {
    const update: any = {};
    update[`courseProgress.${courseName}`] = stepId;

    return this.userModel
      .findByIdAndUpdate(userId, { $addToSet: update }, { new: true })
      .exec();
  }

  async updateCertificationVideoUrl(
    userId: string,
    videoUrl: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { certificationVideoUrl: videoUrl },
        { new: true },
      )
      .exec();
  }

  async updateProfileImage(
    userId: string,
    imageUrl: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { profileImage: imageUrl }, { new: true })
      .exec();
  }

  /**
   * Returns users visible to the viewer based on hierarchy:
   * Hub → Distributor, Representative, Promoter, Shop (full subtree)
   * Distributor → Representative, Promoter, Shop (subtree)
   * Representative → Promoter, Shop (subtree) + operational linked Reps
   * Promoter → Shop (direct) + operational linked Promoters' networks
   */
  // Sub-Promoter role removed — hierarchical sub lookup disabled
  // async findSubPromoterByMain(mainPartnerCode: string): Promise<UserDocument | null> {
  //   const code = mainPartnerCode?.trim();
  //   if (!code) return null;
  //   return this.userModel
  //     .findOne({
  //       role: UserRole.SUB_PROMOTER,
  //       referredByPartnerCode: code,
  //     })
  //     .exec();
  // }

  async findNetworkUsersForViewer(
    viewer: UserDocument,
  ): Promise<NetworkUsersResult> {
    const empty: NetworkUsersResult = {
      shops: [],
      promoters: [],
      subPromoters: [],
      representatives: [],
      represented: [],
      distributors: [],
      partners: [],
      viewerRole: viewer.role,
    };

    const partnerCode = viewer.partnerCode;
    if (!partnerCode) return empty;

    const isGlobal = isGlobalHubPartnerCode(partnerCode);

    if (isGlobal) {
      const shops = await this.userModel
        .find({ role: UserRole.CERTIFIED_SHOP })
        .select(
          '-password -refreshTokenHash -resetPasswordToken -resetPasswordExpires',
        )
        .lean()
        .exec();
      const partners = await this.findAllPartners();
      const distributors = partners.filter((p) => p.role === UserRole.DISTRIBUTOR);
      const representatives = partners.filter(
        (p) => p.role === UserRole.MASTER_PARTNER,
      );
      const promoters = partners.filter(
        (p) => p.role === UserRole.REGIONAL_PARTNER,
      );
      // const subPromoters = partners.filter(
      //   (p) => p.role === UserRole.SUB_PROMOTER,
      // );
      return {
        shops: shops as any,
        distributors,
        representatives,
        represented: representatives,
        promoters,
        subPromoters: [],
        partners,
        viewerRole: viewer.role,
      };
    }

    // // Sub-Promoter role removed — former Sub viewers are now Promoters
    // if (viewer.role === UserRole.SUB_PROMOTER) {
    //   const shops = await this.userModel
    //     .find({
    //       role: UserRole.CERTIFIED_SHOP,
    //       referredByPartnerCode: partnerCode,
    //     })
    //     .exec();
    //   return { ...empty, shops };
    // }

    if (viewer.role === UserRole.REGIONAL_PARTNER) {
      // Direct shops + operational Promoter Network (mirrors Representative Network)
      const shops = await this.userModel
        .find({
          role: UserRole.CERTIFIED_SHOP,
          referredByPartnerCode: partnerCode,
        })
        .exec();

      const collected: UserDocument[] = [];
      const seenIds = new Set<string>();
      const freshViewer = await this.userModel
        .findById(viewer._id)
        .select('operationalPromoterCodes partnerCode')
        .lean();
      const operationalPromoterCodes = (freshViewer?.operationalPromoterCodes || [])
        .map((code) => normalizePartnerCode(code))
        .filter(
          (code) => code && code !== normalizePartnerCode(partnerCode),
        );

      const linkedPromoters: UserDocument[] = [];
      if (operationalPromoterCodes.length > 0) {
        const foundPromoters = await this.userModel
          .find({
            partnerCode: { $in: operationalPromoterCodes },
            role: UserRole.REGIONAL_PARTNER,
          })
          .exec();
        for (const linkedPromoter of foundPromoters) {
          if (!seenIds.has(linkedPromoter._id.toString())) {
            seenIds.add(linkedPromoter._id.toString());
            linkedPromoters.push(linkedPromoter);
            collected.push(linkedPromoter);
          }
        }
        await this.collectNetworkDescendants(
          operationalPromoterCodes,
          collected,
          seenIds,
        );
      }

      const linkedShops = collected.filter(
        (u) => u.role === UserRole.CERTIFIED_SHOP,
      );
      const linkedPromoterMembers = collected.filter(
        (u) => u.role === UserRole.REGIONAL_PARTNER,
      );

      const shopIds = new Set(shops.map((s) => s._id.toString()));
      const mergedShops = [
        ...shops,
        ...linkedShops.filter((s) => !shopIds.has(s._id.toString())),
      ];

      const uniqueLinkedPromoters = [...linkedPromoters];
      for (const promoter of linkedPromoterMembers) {
        if (!uniqueLinkedPromoters.some((p) => p._id.toString() === promoter._id.toString())) {
          uniqueLinkedPromoters.push(promoter);
        }
      }

      return {
        ...empty,
        shops: mergedShops,
        subPromoters: [],
        promoters: uniqueLinkedPromoters,
        partners: uniqueLinkedPromoters,
      };
    }

    const collected: UserDocument[] = [];
    const seenIds = new Set<string>();
    await this.collectNetworkDescendants([partnerCode], collected, seenIds);

    if (viewer.role === UserRole.MASTER_PARTNER) {
      const freshViewer = await this.userModel
        .findById(viewer._id)
        .select('operationalRepresentativeCodes partnerCode')
        .lean();
      const operationalCodes = (freshViewer?.operationalRepresentativeCodes || [])
        .map((code) => normalizePartnerCode(code))
        .filter(
          (code) => code && code !== normalizePartnerCode(partnerCode),
        );

      if (operationalCodes.length > 0) {
        const linkedReps = await this.userModel
          .find({
            partnerCode: { $in: operationalCodes },
            role: UserRole.MASTER_PARTNER,
          })
          .exec();
        for (const linkedRep of linkedReps) {
          if (!seenIds.has(linkedRep._id.toString())) {
            seenIds.add(linkedRep._id.toString());
            collected.push(linkedRep);
          }
        }
        await this.collectNetworkDescendants(
          operationalCodes,
          collected,
          seenIds,
        );
      }
    }

    const distributors = collected.filter((u) => u.role === UserRole.DISTRIBUTOR);
    const representatives = collected.filter(
      (u) => u.role === UserRole.MASTER_PARTNER,
    );
    const promoters = collected.filter((u) => u.role === UserRole.REGIONAL_PARTNER);
    // const subPromoters = collected.filter((u) => u.role === UserRole.SUB_PROMOTER);
    const subPromoters: UserDocument[] = [];
    const shops = collected.filter((u) => u.role === UserRole.CERTIFIED_SHOP);

    if (viewer.role === UserRole.PARTNER) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors,
        representatives,
        represented: representatives,
        partners: [...distributors, ...representatives, ...promoters],
        viewerRole: viewer.role,
      };
    }

    if (viewer.role === UserRole.DISTRIBUTOR) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors: [],
        representatives,
        represented: representatives,
        partners: [...representatives, ...promoters],
        viewerRole: viewer.role,
      };
    }

    if (viewer.role === UserRole.MASTER_PARTNER) {
      // Direct network only: keep direct Promoters + their direct shops,
      // but exclude shops under Promoters that are operationally linked
      // under those direct Promoters (Scenario 3: R4 must not see P2 shops).
      const directPromoterCodes = new Set(
        promoters
          .filter(
            (p) =>
              normalizePartnerCode(p.referredByPartnerCode) ===
              normalizePartnerCode(partnerCode),
          )
          .map((p) => normalizePartnerCode(p.partnerCode))
          .filter(Boolean),
      );

      const excludedCertifierCodes = new Set<string>();
      if (directPromoterCodes.size > 0) {
        const directPromoters = await this.userModel
          .find({ partnerCode: { $in: Array.from(directPromoterCodes) } })
          .select('partnerCode operationalPromoterCodes')
          .lean()
          .exec();
        for (const directPromoter of directPromoters) {
          for (const linkedCode of directPromoter.operationalPromoterCodes || []) {
            const code = normalizePartnerCode(linkedCode);
            if (code) excludedCertifierCodes.add(code);
          }
        }
      }

      const visibleShops =
        excludedCertifierCodes.size === 0
          ? shops
          : shops.filter((shop) => {
              const certifier = normalizePartnerCode(shop.referredByPartnerCode);
              return !certifier || !excludedCertifierCodes.has(certifier);
            });

      const visiblePromoters =
        excludedCertifierCodes.size === 0
          ? promoters
          : promoters.filter((p) => {
              const code = normalizePartnerCode(p.partnerCode);
              return !code || !excludedCertifierCodes.has(code);
            });

      return {
        shops: visibleShops,
        promoters: visiblePromoters,
        subPromoters,
        distributors: [],
        representatives,
        represented: representatives,
        partners: [...representatives, ...visiblePromoters],
        viewerRole: viewer.role,
      };
    }

    return empty;
  }

  async isUserInViewerNetwork(
    viewer: UserDocument,
    targetUserId: string,
  ): Promise<boolean> {
    if (viewer._id.toString() === targetUserId) return true;
    if (isGlobalHubPartnerCode(viewer.partnerCode)) return true;

    const network = await this.findNetworkUsersForViewer(viewer);
    const all = [
      ...network.shops,
      ...network.promoters,
      ...network.subPromoters,
      ...network.representatives,
      ...network.represented,
      ...network.distributors,
    ];
    return all.some((u) => u._id.toString() === targetUserId);
  }

  /** Walk upline to the owning Hub (PARTNER), with network-membership fallback. */
  async findOwningHubPartners(userId: string): Promise<UserDocument[]> {
    const user = await this.findOne(userId);
    if (!user || user.role === UserRole.PARTNER) return [];

    const hubs: UserDocument[] = [];
    const visited = new Set<string>();
    let current: UserDocument | null = user;

    while (current?.referredByPartnerCode) {
      const code = normalizePartnerCode(current.referredByPartnerCode);
      if (!code || visited.has(code)) break;
      visited.add(code);

      const parent = await this.findByPartnerCode(code);
      if (!parent) break;

      // Skip invalid self-referrals (e.g. referredByPartnerCode = own partnerCode)
      if (
        parent._id.toString() === current._id.toString() ||
        normalizePartnerCode(parent.partnerCode) === normalizePartnerCode(current.partnerCode)
      ) {
        break;
      }

      if (parent.role === UserRole.PARTNER) {
        hubs.push(parent);
        break;
      }
      current = parent;
    }

    if (hubs.length === 0) {
      const partners = await this.userModel
        .find({ role: UserRole.PARTNER })
        .select('-password -refreshTokenHash -resetPasswordToken -resetPasswordExpires')
        .exec();
      for (const partner of partners) {
        if (await this.isUserInViewerNetwork(partner, userId)) {
          hubs.push(partner);
        }
      }
    }

    if (hubs.length === 0) {
      const globalHub = await this.findByPartnerCode(GLOBAL_HUB_PARTNER_CODE);
      if (globalHub) hubs.push(globalHub);
    }

    const seen = new Set<string>();
    return hubs.filter((h) => {
      const id = h._id.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  /** @deprecated Use findNetworkUsersForViewer */
  async findReferredShops(partnerCode: string): Promise<{
    shops: UserDocument[];
    partners: any[];
  }> {
    const viewer = await this.findByPartnerCode(partnerCode);
    if (!viewer) return { shops: [], partners: [] };
    const network = await this.findNetworkUsersForViewer(viewer);
    return { shops: network.shops, partners: network.partners };
  }

  async updateShopVisibility(
    memberId: string,
    isVisibleOnMap: boolean,
    viewer: UserDocument,
  ): Promise<UserDocument | null> {
    const member = await this.userModel.findById(memberId);
    if (!member) return null;

    const isSelf = viewer._id.toString() === memberId;
    const isGlobalHubTarget = isGlobalHubPartnerCode(member.partnerCode);

    if (member.role === UserRole.PARTNER && !isGlobalHubTarget) {
      throw new BadRequestException('Hub accounts cannot be shown on the map.');
    }

    if (isGlobalHubTarget) {
      if (!isGlobalHubAccount(viewer)) {
        throw new ForbiddenException('Only the Global Hub account can update its map visibility.');
      }
    } else {
      const inNetwork = await this.isUserInViewerNetwork(viewer, memberId);
      if (!inNetwork && !isSelf) return null;
    }

    const updatePayload: any = { isVisibleOnMap };

    if (isVisibleOnMap && (!member.latitude || !member.longitude)) {
      if (member.address && member.city && member.country) {
        const coords = await this.fetchCoordinates(member.address, member.city, member.country);
        if (coords) {
          updatePayload.latitude = coords.latitude;
          updatePayload.longitude = coords.longitude;
        }
      }
    }

    return this.userModel.findByIdAndUpdate(
      memberId,
      updatePayload,
      { new: true },
    ).exec();
  }

  async findAllPartners() {
    this.logger.log('Fetching all partners for list...');
    const partners = await this.userModel.find({
      role: {
        $in: [
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.DISTRIBUTOR,
          UserRole.PARTNER,
        ],
      },
    }).select('firstName lastName partnerCode email status role isVisibleOnMap city country').sort({ firstName: 1 });
    this.logger.log(`Found ${partners.length} partners.`);
    return partners;
  }

  async getPartnerContactForShop(user: UserDocument | null | undefined) {
    if (!user?.referredByPartnerCode || user.role !== UserRole.CERTIFIED_SHOP) {
      return null;
    }
    if (isGlobalHubPartnerCode(user.referredByPartnerCode)) {
      return null;
    }
    const partner = await this.findByPartnerCode(user.referredByPartnerCode);
    if (!partner) return null;
    return {
      partnerCode: partner.partnerCode,
      email: partner.email,
      firstName: partner.firstName,
      lastName: partner.lastName,
    };
  }

  /**
   * Validates representative network linking:
   * - no self-assignment
   * - no circular parent/child relationships
   * - one parent only
   */
  private async assertRepresentativeNetworkLinkAllowed(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Representatives.');
    }

    if (
      target._id.toString() === owner._id.toString() ||
      targetCode === ownerCode
    ) {
      throw new BadRequestException(
        'A Representative cannot add themselves to their own network.',
      );
    }

    await this.assertRepresentativeHasSingleParent(target, owner);
    await this.assertNoCircularRepresentativeLink(target, owner);
  }

  /**
   * A Representative may only sit under one parent Representative network.
   * Checks both operational links and an existing Partner Development parent.
   */
  private async assertRepresentativeHasSingleParent(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Representatives.');
    }

    const operationalParents = await this.userModel
      .find({
        role: UserRole.MASTER_PARTNER,
        operationalRepresentativeCodes: targetCode,
        _id: { $ne: owner._id },
      })
      .select('firstName lastName partnerCode')
      .exec();

    if (operationalParents.length > 0) {
      const parent = operationalParents[0];
      const parentLabel = `${parent.firstName} ${parent.lastName}`.trim();
      throw new BadRequestException(
        `This Representative is already linked under ${parentLabel} (${parent.partnerCode}). A Representative can only belong to one parent Representative's network.`,
      );
    }

    const existingPdParent = normalizePartnerCode(
      target.partnerDevelopmentRepresentativeCode,
    );
    if (existingPdParent && existingPdParent !== ownerCode) {
      throw new BadRequestException(
        `This Representative is already assigned to parent ${existingPdParent}. A Representative can only belong to one parent Representative's network.`,
      );
    }
  }

  /**
   * Blocks cycles such as Rep1 → Rep2 then Rep2 → Rep1 (or longer chains).
   * Walks upward from the prospective parent (owner); if the target appears
   * as an ancestor, linking target under owner would create a circle.
   */
  private async assertNoCircularRepresentativeLink(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) return;

    // Quick check: target already lists owner as an operational child
    const targetOperationalChildren = (target.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetOperationalChildren.includes(ownerCode)) {
      throw new BadRequestException(
        `Circular link not allowed. ${ownerCode} is already under ${targetCode}'s network, so ${targetCode} cannot be added under ${ownerCode}.`,
      );
    }

    const visited = new Set<string>();
    let currentCode: string | null = ownerCode;
    let depth = 0;
    const maxDepth = 50;

    while (currentCode && depth < maxDepth) {
      if (visited.has(currentCode)) break;
      visited.add(currentCode);

      if (currentCode === targetCode) {
        throw new BadRequestException(
          `Circular link not allowed. ${targetCode} is already an ancestor of ${ownerCode}, so ${ownerCode} cannot add ${targetCode} to their network.`,
        );
      }

      const currentUser = await this.userModel
        .findOne({
          role: UserRole.MASTER_PARTNER,
          partnerCode: currentCode,
        })
        .select('partnerCode partnerDevelopmentRepresentativeCode')
        .exec();

      if (!currentUser) break;

      const pdParent = normalizePartnerCode(
        currentUser.partnerDevelopmentRepresentativeCode,
      );
      if (pdParent) {
        currentCode = pdParent;
        depth += 1;
        continue;
      }

      const operationalParent = await this.userModel
        .findOne({
          role: UserRole.MASTER_PARTNER,
          operationalRepresentativeCodes: currentCode,
        })
        .select('partnerCode')
        .exec();

      currentCode = normalizePartnerCode(operationalParent?.partnerCode) || null;
      depth += 1;
    }

    // Also block if owner already appears in target's linked descendant network
    const targetSubtree = await this.findNetworkUsersForViewer(target);
    const descendantIds = new Set(
      targetSubtree.representatives.map((member) => member._id.toString()),
    );
    if (descendantIds.has(owner._id.toString())) {
      throw new BadRequestException(
        `Circular link not allowed. ${ownerCode} is already in ${targetCode}'s network, so ${targetCode} cannot be added under ${ownerCode}.`,
      );
    }
  }

  async searchRepresentativeForLinking(
    query: string,
    viewer: UserDocument,
    options?: { allowAdmin?: boolean },
  ) {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new BadRequestException('Please enter a Partner ID or email address.');
    }
    if (
      !options?.allowAdmin &&
      (viewer.role !== UserRole.MASTER_PARTNER || !viewer.partnerCode)
    ) {
      throw new ForbiddenException('Only Representatives can search for other Representatives.');
    }
    if (viewer.role !== UserRole.MASTER_PARTNER) {
      throw new BadRequestException('Owner must be a Representative.');
    }

    const normalizedQuery = trimmed.toUpperCase();
    const isEmailQuery = trimmed.includes('@');

    const target = await this.userModel.findOne(
      isEmailQuery
        ? { email: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, role: UserRole.MASTER_PARTNER }
        : { partnerCode: normalizedQuery, role: UserRole.MASTER_PARTNER },
    );

    if (!target) {
      throw new BadRequestException('No active Representative found with that Partner ID or email.');
    }
    if (target.status === UserStatus.BLOCKED) {
      throw new BadRequestException('This Representative account is blocked.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(viewer.partnerCode);
    if (
      target._id.toString() === viewer._id.toString() ||
      (targetCode && ownerCode && targetCode === ownerCode)
    ) {
      throw new BadRequestException(
        'A Representative cannot add themselves to their own network.',
      );
    }

    if (
      normalizePartnerCode(target.referredByPartnerCode) === ownerCode
    ) {
      throw new BadRequestException('This Representative is already linked to your network.');
    }

    const existingOperational = (viewer.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetCode && existingOperational.includes(targetCode)) {
      throw new BadRequestException(
        'This Representative is already linked for operational support.',
      );
    }

    await this.assertRepresentativeNetworkLinkAllowed(target, viewer);

    return {
      _id: target._id,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      partnerCode: target.partnerCode,
      referredByPartnerCode: target.referredByPartnerCode,
      city: target.city,
      country: target.country,
      status: target.status,
    };
  }

  async linkRepresentativeToViewer(query: string, viewer: UserDocument) {
    return this.linkRepresentativeToOwner(viewer._id.toString(), query, viewer);
  }

  async adminGetNetworkLinks(ownerId: string) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }

    const migratedReps = await this.ensureOperationalRepresentativeLinksMigrated(owner);
    const migrated =
      owner.role === UserRole.REGIONAL_PARTNER
        ? await this.ensureOperationalPromoterLinksMigrated(migratedReps)
        : migratedReps;

    const repCodes = (migrated.operationalRepresentativeCodes || [])
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean) as string[];
    const promoterCodes = (migrated.operationalPromoterCodes || [])
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean) as string[];

    const repLinkByCode = new Map(
      (migrated.operationalRepresentativeLinks || []).map((link) => [
        normalizePartnerCode(link.partnerCode),
        link,
      ]),
    );
    const promoterLinkByCode = new Map(
      (migrated.operationalPromoterLinks || []).map((link) => [
        normalizePartnerCode(link.partnerCode),
        link,
      ]),
    );

    const resolveFoRates = (
      link?: {
        firstOrderShopIntroductionRate?: number;
        firstOrderPartnerDevelopmentRate?: number;
      },
      role: 'master_partner' | 'regional_partner' = 'master_partner',
    ) => {
      try {
        return normalizeFirstOrderCommissionRates({
          shopIntroductionRate: link?.firstOrderShopIntroductionRate,
          partnerDevelopmentRate: link?.firstOrderPartnerDevelopmentRate,
          role,
        });
      } catch {
        return {
          shopIntroductionRate: normalizeShopIntroductionFirstOrderRatePercent(
            link?.firstOrderShopIntroductionRate,
            role,
          ),
          partnerDevelopmentRate: normalizePartnerDevelopmentRatePercent(
            link?.firstOrderPartnerDevelopmentRate,
            role,
          ),
        };
      }
    };

    const linkedRepresentativesRaw = repCodes.length
      ? await this.userModel
          .find({ partnerCode: { $in: repCodes }, role: UserRole.MASTER_PARTNER })
          .select('firstName lastName email partnerCode city country status role')
          .lean()
      : [];

    const linkedRepresentatives = linkedRepresentativesRaw.map((rep) => {
      const code = normalizePartnerCode(rep.partnerCode);
      const link = code ? repLinkByCode.get(code) : undefined;
      const rates = resolveFoRates(link, 'master_partner');
      return {
        ...rep,
        linkedAt: link?.linkedAt || null,
        firstOrderShopIntroductionRate: rates.shopIntroductionRate,
        firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
      };
    });

    const linkedPromotersRaw = promoterCodes.length
      ? await this.userModel
          .find({ partnerCode: { $in: promoterCodes }, role: UserRole.REGIONAL_PARTNER })
          .select('firstName lastName email partnerCode city country status role')
          .lean()
      : [];

    const linkedPromoters = linkedPromotersRaw.map((promoter) => {
      const code = normalizePartnerCode(promoter.partnerCode);
      const link = code ? promoterLinkByCode.get(code) : undefined;
      const rates = resolveFoRates(link, 'regional_partner');
      return {
        ...promoter,
        linkedAt: link?.linkedAt || null,
        firstOrderShopIntroductionRate: rates.shopIntroductionRate,
        firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
      };
    });

    return {
      owner: {
        _id: migrated._id,
        firstName: migrated.firstName,
        lastName: migrated.lastName,
        email: migrated.email,
        partnerCode: migrated.partnerCode,
        role: migrated.role,
      },
      linkedRepresentatives,
      linkedPromoters,
      operationalRepresentativeCodes: repCodes,
      operationalPromoterCodes: promoterCodes,
    };
  }

  async adminSearchNetworkMember(
    ownerId: string,
    role: 'master_partner' | 'regional_partner',
    query: string,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    if (role === 'master_partner') {
      if (owner.role !== UserRole.MASTER_PARTNER) {
        throw new BadRequestException('Owner must be a Representative.');
      }
      return this.searchRepresentativeForLinking(query, owner, { allowAdmin: true });
    }
    if (owner.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Owner must be a Promoter.');
    }
    return this.searchPromoterForLinking(query, owner, { allowAdmin: true });
  }

  async adminLinkNetworkMember(
    ownerId: string,
    role: 'master_partner' | 'regional_partner',
    query: string,
    firstOrderPartnerDevelopmentRate?: number,
    firstOrderShopIntroductionRate?: number,
  ) {
    if (role === 'master_partner') {
      return this.linkRepresentativeToOwner(
        ownerId,
        query,
        undefined,
        firstOrderPartnerDevelopmentRate,
        firstOrderShopIntroductionRate,
      );
    }
    return this.linkPromoterToOwner(
      ownerId,
      query,
      undefined,
      firstOrderPartnerDevelopmentRate,
      firstOrderShopIntroductionRate,
    );
  }

  async adminUpdateLinkedRepresentativeRate(
    ownerId: string,
    partnerCode: string,
    firstOrderPartnerDevelopmentRate: number,
    firstOrderShopIntroductionRate?: number,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }

    const normalizedCode = normalizePartnerCode(partnerCode);
    if (!normalizedCode) {
      throw new BadRequestException('Partner ID is required.');
    }

    let rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    };
    try {
      rates = normalizeFirstOrderCommissionRates({
        shopIntroductionRate: firstOrderShopIntroductionRate,
        partnerDevelopmentRate: firstOrderPartnerDevelopmentRate,
        role:
          owner.role === UserRole.REGIONAL_PARTNER
            ? UserRole.REGIONAL_PARTNER
            : UserRole.MASTER_PARTNER,
      });
    } catch (error: any) {
      throw new BadRequestException(
        error?.message ||
          'Parent First Order Commission cannot exceed child First Order Commission.',
      );
    }

    // Promoter Network FO rates (same model as Representatives)
    if (owner.role === UserRole.REGIONAL_PARTNER) {
      await this.ensureOperationalPromoterLinksMigrated(owner);
      const refreshed = await this.findOne(owner._id.toString());
      if (!refreshed) {
        throw new BadRequestException('Network owner not found.');
      }

      const codes = (refreshed.operationalPromoterCodes || []).map((c) =>
        normalizePartnerCode(c),
      );
      if (!codes.includes(normalizedCode)) {
        throw new BadRequestException(
          'Promoter is not linked in this network.',
        );
      }

      const existingLinks = [...(refreshed.operationalPromoterLinks || [])];
      const linkIndex = existingLinks.findIndex(
        (entry) => normalizePartnerCode(entry.partnerCode) === normalizedCode,
      );

      if (linkIndex >= 0) {
        const previous = existingLinks[linkIndex] as any;
        existingLinks[linkIndex] = {
          ...previous,
          partnerCode: normalizedCode,
          linkedAt: previous.linkedAt || new Date(),
          firstOrderShopIntroductionRate: rates.shopIntroductionRate,
          firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
        };
      } else {
        existingLinks.push({
          partnerCode: normalizedCode,
          linkedAt: new Date(),
          firstOrderShopIntroductionRate: rates.shopIntroductionRate,
          firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
        } as any);
      }

      await this.userModel.findByIdAndUpdate(owner._id, {
        operationalPromoterLinks: existingLinks,
      });

      const shopsUpdated = await this.syncPromoterFirstOrderRatesToEligibleShops(
        normalizedCode,
        rates,
      );

      return {
        message: `First Order Commission updated for ${normalizedCode}: child Promoter ${rates.shopIntroductionRate}% · parent ${rates.partnerDevelopmentRate}%${
          shopsUpdated
            ? ` · synced to ${shopsUpdated} unpaid FO shop(s)`
            : ''
        }.`,
        partnerCode: normalizedCode,
        firstOrderShopIntroductionRate: rates.shopIntroductionRate,
        firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
        shopsSynced: shopsUpdated,
      };
    }

    if (owner.role !== UserRole.MASTER_PARTNER) {
      throw new BadRequestException(
        'Owner must be a Representative or Promoter.',
      );
    }

    await this.ensureOperationalRepresentativeLinksMigrated(owner);

    const refreshed = await this.findOne(owner._id.toString());
    if (!refreshed) {
      throw new BadRequestException('Network owner not found.');
    }

    const codes = (refreshed.operationalRepresentativeCodes || []).map((c) =>
      normalizePartnerCode(c),
    );
    if (!codes.includes(normalizedCode)) {
      throw new BadRequestException(
        'Representative is not linked in this network.',
      );
    }

    const existingLinks = [
      ...(refreshed.operationalRepresentativeLinks || []),
    ];
    const linkIndex = existingLinks.findIndex(
      (entry) => normalizePartnerCode(entry.partnerCode) === normalizedCode,
    );

    if (linkIndex >= 0) {
      const previous = existingLinks[linkIndex] as any;
      existingLinks[linkIndex] = {
        ...previous,
        partnerCode: normalizedCode,
        linkedAt: previous.linkedAt || new Date(),
        firstOrderShopIntroductionRate: rates.shopIntroductionRate,
        firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
      };
    } else {
      existingLinks.push({
        partnerCode: normalizedCode,
        linkedAt: new Date(),
        firstOrderShopIntroductionRate: rates.shopIntroductionRate,
        firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
      } as any);
    }

    await this.userModel.findByIdAndUpdate(owner._id, {
      operationalRepresentativeLinks: existingLinks,
    });

    // Push new rates onto FO-eligible shops that have not locked first-order PD yet.
    const shopsUpdated = await this.syncFirstOrderRatesToEligibleShops(
      normalizedCode,
      rates,
    );

    return {
      message: `First Order Commission updated for ${normalizedCode}: child Rep ${rates.shopIntroductionRate}% · parent ${rates.partnerDevelopmentRate}%${
        shopsUpdated
          ? ` · synced to ${shopsUpdated} unpaid FO shop(s)`
          : ''
      }.`,
      partnerCode: normalizedCode,
      firstOrderShopIntroductionRate: rates.shopIntroductionRate,
      firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
      shopsSynced: shopsUpdated,
    };
  }

  async adminUnlinkNetworkMember(
    ownerId: string,
    role: 'master_partner' | 'regional_partner',
    partnerCode: string,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    const normalizedCode = normalizePartnerCode(partnerCode);
    if (!normalizedCode) {
      throw new BadRequestException('Partner ID is required.');
    }

    if (role === 'master_partner') {
      if (owner.role !== UserRole.MASTER_PARTNER) {
        throw new BadRequestException('Owner must be a Representative.');
      }
      await this.userModel.findByIdAndUpdate(owner._id, {
        $pull: {
          operationalRepresentativeCodes: normalizedCode,
          operationalRepresentativeLinks: { partnerCode: normalizedCode },
        },
      });
      return {
        message: `Representative ${normalizedCode} removed from ${owner.firstName} ${owner.lastName}'s linked network.`,
      };
    }

    if (owner.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Owner must be a Promoter.');
    }
    await this.userModel.findByIdAndUpdate(owner._id, {
      $pull: {
        operationalPromoterCodes: normalizedCode,
        operationalPromoterLinks: { partnerCode: normalizedCode },
      },
    });

    // Clear stale PD parent on child so a later re-link can bind a new parent.
    const child = await this.findByPartnerCode(normalizedCode);
    if (
      child?.role === UserRole.REGIONAL_PARTNER &&
      normalizePartnerCode(child.partnerDevelopmentPromoterCode) ===
        normalizePartnerCode(owner.partnerCode)
    ) {
      await this.userModel.findByIdAndUpdate(child._id, {
        $unset: {
          partnerDevelopmentPromoterCode: 1,
          partnerDevelopmentPromoterId: 1,
        },
      });
    }

    // Invalidate unpaid FO stamps on shops under the unlinked child.
    if (child) {
      const childShops = await this.userModel
        .find({
          role: UserRole.CERTIFIED_SHOP,
          referredByPartnerCode: normalizedCode,
          partnerDevelopmentCommissionPaid: { $ne: true },
        })
        .exec();
      for (const shop of childShops) {
        await this.clearUnpaidFirstOrderNetworkStamps(shop);
      }
    }

    return {
      message: `Promoter ${normalizedCode} removed from ${owner.firstName} ${owner.lastName}'s linked network.`,
    };
  }

  async linkRepresentativeToOwner(
    ownerId: string,
    query: string,
    actingViewer?: UserDocument,
    firstOrderPartnerDevelopmentRate?: number,
    firstOrderShopIntroductionRate?: number,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    if (owner.role !== UserRole.MASTER_PARTNER) {
      throw new BadRequestException('Only Representatives can own representative network links.');
    }
    if (
      actingViewer &&
      actingViewer.role === UserRole.MASTER_PARTNER &&
      actingViewer._id.toString() !== owner._id.toString()
    ) {
      throw new ForbiddenException('You can only manage your own representative links.');
    }

    const targetPreview = await this.searchRepresentativeForLinking(
      query,
      owner,
      { allowAdmin: !actingViewer },
    );
    const target = await this.userModel.findById(targetPreview._id);
    if (!target) {
      throw new BadRequestException('Representative not found.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (
      target._id.toString() === owner._id.toString() ||
      (targetCode && ownerCode && targetCode === ownerCode)
    ) {
      throw new BadRequestException(
        'A Representative cannot add themselves to their own network.',
      );
    }

    const ownerSubtree = await this.findNetworkUsersForViewer(owner);
    const subtreeIds = new Set(
      [
        ...ownerSubtree.representatives,
        ...ownerSubtree.promoters,
        ...ownerSubtree.subPromoters,
        ...ownerSubtree.shops,
      ].map((member) => member._id.toString()),
    );
    if (subtreeIds.has(target._id.toString())) {
      throw new BadRequestException('This Representative is already in the network.');
    }

    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Representatives.');
    }

    const existingOperational = (owner.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (existingOperational.includes(targetCode)) {
      throw new BadRequestException('This Representative is already linked for operational support.');
    }

    await this.assertRepresentativeNetworkLinkAllowed(target, owner);

    let rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    };
    try {
      rates = normalizeFirstOrderCommissionRates({
        shopIntroductionRate: firstOrderShopIntroductionRate,
        partnerDevelopmentRate: firstOrderPartnerDevelopmentRate,
        role: UserRole.MASTER_PARTNER,
      });
    } catch (error: any) {
      throw new BadRequestException(
        error?.message ||
          'Parent First Order Commission cannot exceed child Representative First Order Commission.',
      );
    }
    const linkedAt = new Date();

    await this.ensureOperationalRepresentativeLinksMigrated(owner);

    await this.userModel.findByIdAndUpdate(owner._id, {
      $addToSet: { operationalRepresentativeCodes: targetCode },
      $push: {
        operationalRepresentativeLinks: {
          partnerCode: targetCode,
          linkedAt,
          firstOrderShopIntroductionRate: rates.shopIntroductionRate,
          firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
        },
      },
    });

    // Rep1 becomes Rep2's Partner Development parent (immutable once set).
    // Only shops created AFTER this link get FO Partner Development.
    if (!target.partnerDevelopmentRepresentativeCode) {
      await this.userModel.findByIdAndUpdate(target._id, {
        partnerDevelopmentRepresentativeCode: ownerCode,
      });
    }

    // Backfill Shop Intro / Operational Support only — do NOT stamp PD on
    // pre-existing shops under Rep2.
    const refreshedTarget = await this.userModel.findById(target._id);
    if (refreshedTarget) {
      await this.backfillShopEarningAssignmentsForRepresentative(refreshedTarget);
    }

    return {
      message: `${target.firstName} ${target.lastName} linked to ${owner.firstName} ${owner.lastName}'s network. Shops already under the linked Representative keep their current commission. New shops after this link: first order → child Rep ${rates.shopIntroductionRate}% Shop Introduction + parent ${rates.partnerDevelopmentRate}% Partner Development.`,
      linkType: 'operational',
      linkedAt,
      firstOrderShopIntroductionRate: rates.shopIntroductionRate,
      firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
      representative: targetPreview,
    };
  }

  /**
   * Validates Promoter Network linking (mirrors Representative Network):
   * - no self-assignment
   * - no circular parent/child relationships
   * - one parent only
   */
  private async assertPromoterNetworkLinkAllowed(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Promoters.');
    }

    if (
      target._id.toString() === owner._id.toString() ||
      targetCode === ownerCode
    ) {
      throw new BadRequestException(
        'A Promoter cannot add themselves to their own network.',
      );
    }

    await this.assertPromoterHasSingleParent(target, owner);
    await this.assertNoCircularPromoterLink(target, owner);
  }

  private async assertPromoterHasSingleParent(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    if (!targetCode) {
      throw new BadRequestException('Partner ID is required to link Promoters.');
    }

    const operationalParents = await this.userModel
      .find({
        role: UserRole.REGIONAL_PARTNER,
        operationalPromoterCodes: targetCode,
        _id: { $ne: owner._id },
      })
      .select('firstName lastName partnerCode')
      .exec();

    if (operationalParents.length > 0) {
      const parent = operationalParents[0];
      const parentLabel = `${parent.firstName} ${parent.lastName}`.trim();
      throw new BadRequestException(
        `This Promoter is already linked under ${parentLabel} (${parent.partnerCode}). A Promoter can only belong to one parent Promoter's network.`,
      );
    }
  }

  private async assertNoCircularPromoterLink(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) return;

    const targetOperationalChildren = (target.operationalPromoterCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetOperationalChildren.includes(ownerCode)) {
      throw new BadRequestException(
        `Circular link not allowed. ${ownerCode} is already under ${targetCode}'s network, so ${targetCode} cannot be added under ${ownerCode}.`,
      );
    }

    const visited = new Set<string>();
    let currentCode: string | null = ownerCode;
    let depth = 0;
    const maxDepth = 50;

    while (currentCode && depth < maxDepth) {
      if (visited.has(currentCode)) break;
      visited.add(currentCode);

      if (currentCode === targetCode) {
        throw new BadRequestException(
          `Circular link not allowed. ${targetCode} is already an ancestor of ${ownerCode}, so ${ownerCode} cannot add ${targetCode} to their network.`,
        );
      }

      const operationalParent = await this.userModel
        .findOne({
          role: UserRole.REGIONAL_PARTNER,
          operationalPromoterCodes: currentCode,
        })
        .select('partnerCode')
        .exec();

      currentCode = normalizePartnerCode(operationalParent?.partnerCode) || null;
      depth += 1;
    }

    const targetSubtree = await this.findNetworkUsersForViewer(target);
    const descendantIds = new Set(
      targetSubtree.promoters.map((member) => member._id.toString()),
    );
    if (descendantIds.has(owner._id.toString())) {
      throw new BadRequestException(
        `Circular link not allowed. ${ownerCode} is already in ${targetCode}'s network, so ${targetCode} cannot be added under ${ownerCode}.`,
      );
    }
  }

  async searchPromoterForLinking(
    query: string,
    viewer: UserDocument,
    options?: { allowAdmin?: boolean },
  ) {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new BadRequestException('Please enter a Partner ID or email address.');
    }
    if (
      !options?.allowAdmin &&
      (viewer.role !== UserRole.REGIONAL_PARTNER || !viewer.partnerCode)
    ) {
      throw new ForbiddenException('Only Promoters can search for other Promoters.');
    }
    if (viewer.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Owner must be a Promoter.');
    }

    const normalizedQuery = trimmed.toUpperCase();
    const isEmailQuery = trimmed.includes('@');
    const target = await this.userModel.findOne(
      isEmailQuery
        ? {
            email: {
              $regex: new RegExp(
                `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
                'i',
              ),
            },
            role: UserRole.REGIONAL_PARTNER,
          }
        : { partnerCode: normalizedQuery, role: UserRole.REGIONAL_PARTNER },
    );

    if (!target) {
      throw new BadRequestException('No active Promoter found with that Partner ID or email.');
    }
    if (target.status === UserStatus.BLOCKED) {
      throw new BadRequestException('This Promoter account is blocked.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(viewer.partnerCode);
    if (
      target._id.toString() === viewer._id.toString() ||
      (targetCode && ownerCode && targetCode === ownerCode)
    ) {
      throw new BadRequestException(
        'A Promoter cannot add themselves to their own network.',
      );
    }

    const existingOperational = (viewer.operationalPromoterCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetCode && existingOperational.includes(targetCode)) {
      throw new BadRequestException(
        'This Promoter is already linked for operational support.',
      );
    }

    await this.assertPromoterNetworkLinkAllowed(target, viewer);

    return {
      _id: target._id,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      partnerCode: target.partnerCode,
      referredByPartnerCode: target.referredByPartnerCode,
      city: target.city,
      country: target.country,
      status: target.status,
    };
  }

  async linkPromoterToViewer(query: string, viewer: UserDocument) {
    return this.linkPromoterToOwner(viewer._id.toString(), query, viewer);
  }

  async linkPromoterToOwner(
    ownerId: string,
    query: string,
    actingViewer?: UserDocument,
    firstOrderPartnerDevelopmentRate?: number,
    firstOrderShopIntroductionRate?: number,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    if (owner.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Only Promoters can own promoter network links.');
    }
    if (
      actingViewer &&
      actingViewer.role === UserRole.REGIONAL_PARTNER &&
      actingViewer._id.toString() !== owner._id.toString()
    ) {
      throw new ForbiddenException('You can only manage your own promoter links.');
    }

    const targetPreview = await this.searchPromoterForLinking(query, owner, {
      allowAdmin: !actingViewer,
    });
    const target = await this.userModel.findById(targetPreview._id);
    if (!target) {
      throw new BadRequestException('Promoter not found.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (
      target._id.toString() === owner._id.toString() ||
      (targetCode && ownerCode && targetCode === ownerCode)
    ) {
      throw new BadRequestException(
        'A Promoter cannot add themselves to their own network.',
      );
    }

    const ownerSubtree = await this.findNetworkUsersForViewer(owner);
    const subtreeIds = new Set(
      [
        ...ownerSubtree.promoters,
        ...ownerSubtree.shops,
      ].map((member) => member._id.toString()),
    );
    if (subtreeIds.has(target._id.toString())) {
      throw new BadRequestException('This Promoter is already in the network.');
    }

    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Promoters.');
    }

    const existingOperational = (owner.operationalPromoterCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (existingOperational.includes(targetCode)) {
      throw new BadRequestException(
        'This Promoter is already linked for operational support.',
      );
    }

    await this.assertPromoterNetworkLinkAllowed(target, owner);

    let rates: {
      shopIntroductionRate: number;
      partnerDevelopmentRate: number;
    };
    try {
      rates = normalizeFirstOrderCommissionRates({
        shopIntroductionRate: firstOrderShopIntroductionRate,
        partnerDevelopmentRate: firstOrderPartnerDevelopmentRate,
        role: UserRole.REGIONAL_PARTNER,
      });
    } catch (error: any) {
      throw new BadRequestException(
        error?.message ||
          'Parent First Order Commission cannot exceed child Promoter First Order Commission.',
      );
    }
    const linkedAt = new Date();

    await this.ensureOperationalPromoterLinksMigrated(owner);

    await this.userModel.findByIdAndUpdate(owner._id, {
      $addToSet: { operationalPromoterCodes: targetCode },
      $push: {
        operationalPromoterLinks: {
          partnerCode: targetCode,
          linkedAt,
          firstOrderShopIntroductionRate: rates.shopIntroductionRate,
          firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
        },
      },
    });

    // Parent Promoter becomes child Promoter's Partner Development parent.
    // Always sync to the current operational owner (supports unlink → re-link).
    await this.userModel.findByIdAndUpdate(target._id, {
      partnerDevelopmentPromoterCode: ownerCode,
      partnerDevelopmentPromoterId: owner._id,
    });

    // Backfill shop FO stamps for shops under child (pre-link shops stay ineligible).
    const refreshedTarget = await this.userModel.findById(target._id);
    if (refreshedTarget) {
      const childShops = await this.userModel
        .find({
          role: UserRole.CERTIFIED_SHOP,
          referredByPartnerCode: targetCode,
        })
        .exec();
      for (const shop of childShops) {
        await this.assignShopPromoterNetworkEarnings(shop);
      }
    }

    return {
      message: `${target.firstName} ${target.lastName} linked to ${owner.firstName} ${owner.lastName}'s network. Shops already under the linked Promoter keep their current commission. New shops after this link: first order → child Promoter ${rates.shopIntroductionRate}% Shop Introduction + parent ${rates.partnerDevelopmentRate}% Partner Development.`,
      linkType: 'operational',
      linkedAt,
      firstOrderShopIntroductionRate: rates.shopIntroductionRate,
      firstOrderPartnerDevelopmentRate: rates.partnerDevelopmentRate,
      promoter: targetPreview,
    };
  }

  async assignPartner(shopId: string, partnerCode: string) {
    const normalizedCode = normalizePartnerCode(partnerCode);
    // 1. Verify Partner exists
    const partner = await this.findByPartnerCode(normalizedCode);
    if (
      !partner ||
      ![
        UserRole.MASTER_PARTNER,
        UserRole.REGIONAL_PARTNER,
        UserRole.DISTRIBUTOR,
        UserRole.PARTNER,
      ].includes(partner.role as UserRole)
    ) {
      throw new BadRequestException('Invalid Partner Code');
    }

    const existing = await this.userModel.findById(shopId);
    if (!existing || existing.role !== UserRole.CERTIFIED_SHOP) {
      throw new BadRequestException('Shop not found');
    }

    const previousCertifier = normalizePartnerCode(existing.referredByPartnerCode);
    // Certifier changed → drop unpaid earning stamps so they rebuild for the new parent.
    // (assignShopEarningRepresentatives will not overwrite existing SI/PD codes.)
    if (
      previousCertifier &&
      previousCertifier !== normalizedCode &&
      existing.partnerDevelopmentCommissionPaid !== true
    ) {
      await this.userModel.findByIdAndUpdate(existing._id, {
        $unset: {
          shopIntroductionRepresentativeCode: 1,
          shopIntroductionRepresentativeId: 1,
          partnerDevelopmentRepresentativeCode: 1,
          partnerDevelopmentRepresentativeId: 1,
          shopIntroductionPromoterCode: 1,
          shopIntroductionPromoterId: 1,
          partnerDevelopmentPromoterCode: 1,
          partnerDevelopmentPromoterId: 1,
          partnerDevelopmentRatePercent: 1,
          shopIntroductionFirstOrderRatePercent: 1,
          partnerDevelopmentPromoterRatePercent: 1,
          shopIntroductionPromoterFirstOrderRatePercent: 1,
        },
        $set: {
          partnerDevelopmentEligible: false,
          partnerDevelopmentPromoterEligible: false,
        },
      });
    }

    // 2. Update Shop with partner's code
    let shop: UserDocument | null = await this.userModel.findByIdAndUpdate(
      shopId,
      {
        referredByPartnerCode: normalizedCode,
      },
      { new: true },
    );
    if (!shop) throw new BadRequestException('Shop not found');

    // Same order as shop create / applyOrderCommissions: Promoter FO first.
    shop = await this.assignShopPromoterNetworkEarnings(shop);
    const promoterFoReady =
      shop.partnerDevelopmentPromoterEligible === true &&
      normalizePartnerCode(shop.shopIntroductionRepresentativeCode) ===
        normalizePartnerCode(shop.referredByPartnerCode);
    if (!promoterFoReady) {
      shop = await this.assignShopEarningRepresentatives(shop);
      shop = await this.assignShopPromoterNetworkEarnings(shop);
    }
    return shop;
  }

  private normalizeCustomCommissionRate(
    role: UserRole,
    payload: { customCommissionRate?: number | null },
  ): void {
    if (payload.customCommissionRate === undefined) return;

    if (!isCommissionEligibleRole(role)) {
      payload.customCommissionRate = null;
      return;
    }

    if (payload.customCommissionRate === null) return;

    const rate = Number(payload.customCommissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException(
        'Shop Intro rate must be a number between 0 and 100',
      );
    }
    payload.customCommissionRate = rate;
  }

  private normalizePartnerIntroRatePercent(
    role: UserRole,
    payload: { partnerIntroRatePercent?: number | null },
  ): void {
    if (payload.partnerIntroRatePercent === undefined) return;

    if (!isCommissionEligibleRole(role)) {
      payload.partnerIntroRatePercent = null;
      return;
    }

    if (payload.partnerIntroRatePercent === null) return;

    const rate = Number(payload.partnerIntroRatePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException(
        'Partner Intro rate must be a number between 0 and 100',
      );
    }
    payload.partnerIntroRatePercent = rate;
  }

  private normalizeShopCommissionRateField(
    payload: Record<string, unknown>,
    field:
      | 'shopIntroductionFirstOrderRatePercent'
      | 'partnerDevelopmentRatePercent'
      | 'operationalSupportRatePercent',
  ): void {
    if (payload[field] === undefined) return;
    if (payload[field] === null || payload[field] === '') {
      payload[field] = null;
      return;
    }
    const rate = Number(payload[field]);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException(
        'Commission rate must be a number between 0 and 100',
      );
    }
    payload[field] = rate;
  }

  /** Walk parent links upward and return true if partnerCode appears in viewer's upline. */
  private async isPartnerCodeInViewerAncestry(
    viewer: UserDocument,
    partnerCode: string,
  ): Promise<boolean> {
    const targetCode = normalizePartnerCode(partnerCode);
    if (!targetCode) return false;

    let current: UserDocument | null = viewer;
    const visited = new Set<string>();

    for (let depth = 0; depth < 25 && current; depth++) {
      const parentCode = current.referredByPartnerCode?.trim();
      if (!parentCode) return false;

      const normalizedParent = normalizePartnerCode(parentCode);
      if (!normalizedParent || visited.has(normalizedParent)) return false;
      visited.add(normalizedParent);

      if (normalizedParent === targetCode) return true;

      const parent = await this.findByPartnerCode(normalizedParent);
      if (!parent) return false;
      if (parent._id.toString() === current._id.toString()) return false;
      current = parent;
    }

    return false;
  }

  private async collectNetworkDescendants(
    rootCodes: string[],
    collected: UserDocument[],
    seenIds: Set<string>,
  ): Promise<void> {
    let frontier = rootCodes
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean);

    for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
      const batch = await this.userModel
        .find({ referredByPartnerCode: { $in: frontier } })
        .exec();

      const nextFrontier: string[] = [];
      for (const user of batch) {
        const id = user._id.toString();
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(user);

        if (user.partnerCode && canTraverseNetwork(user.role)) {
          nextFrontier.push(normalizePartnerCode(user.partnerCode));
        }
      }
      frontier = nextFrontier;
    }
  }

  private async validateHierarchyLink(
    role: UserRole,
    referredByPartnerCode?: string | null,
    excludeUserId?: string,
  ): Promise<void> {
    if (!requiresParentLink(role)) {
      return;
    }

    const code = referredByPartnerCode?.trim();
    if (!code) {
      throw new BadRequestException(`${getParentLinkLabel(role)} is required`);
    }

    const parent = await this.findByPartnerCode(code);
    if (!parent) {
      throw new BadRequestException(
        `${getParentLinkLabel(role)} is invalid: partner code not found`,
      );
    }

    const roleError = validateParentRole(role, parent.role);
    if (roleError) {
      throw new BadRequestException(roleError);
    }

    // Sub-Promoter role removed — one-sub-per-main validation disabled
    // if (role === UserRole.SUB_PROMOTER) {
    //   await this.assertMainPromoterCanAcceptSub(code, excludeUserId);
    // }
  }

  // private async assertMainPromoterCanAcceptSub(
  //   mainPartnerCode: string,
  //   excludeUserId?: string,
  // ): Promise<void> {
  //   const main = await this.findByPartnerCode(mainPartnerCode);
  //   if (!main || main.role !== UserRole.REGIONAL_PARTNER) {
  //     throw new BadRequestException(
  //       'Sub-Promoter must be linked to a Main Promoter (Promoter role)',
  //     );
  //   }
  //
  //   const existingSub = await this.userModel.findOne({
  //     role: UserRole.SUB_PROMOTER,
  //     referredByPartnerCode: mainPartnerCode,
  //     ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
  //   });
  //
  //   if (existingSub) {
  //     throw new BadRequestException(
  //       'This Main Promoter already has a Sub-Promoter assigned',
  //     );
  //   }
  // }

  private async getNextCertificateNumber(): Promise<number> {
    const lastUser = await this.userModel
      .findOne({ certificateNumber: { $exists: true } })
      .sort({ certificateNumber: -1 })
      .exec();
    
    if (lastUser && lastUser.certificateNumber) {
      return lastUser.certificateNumber + 1;
    }
    return 14943212; // Starting number
  }
}

